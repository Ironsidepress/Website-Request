import type {
  Ai,
  D1Database,
  R2Bucket,
  ScheduledController,
  ExecutionContext,
  Workflow,
} from '@cloudflare/workers-types';
import { WorkflowEntrypoint, type WorkflowStep, type WorkflowEvent } from 'cloudflare:workers';
import {
  createDb,
  createPipelineRepository,
  createProjectsRepository,
  tenantContext,
} from '@website-factory/db';
import { createMaintenance } from '@website-factory/core/maintenance';
import {
  AGENT_SPECS,
  AgentDispatcher,
  ClaudeExecutor,
  createAgentInputLoader,
  FigmaDesignExecutor,
  FigmaMcpClient,
  GitHubPublishingExecutor,
  GitHubRestClient,
  logEvent,
  PreviewDeployExecutor,
  runPipeline,
  systemClock,
  SimulatedExecutor,
  WorkersAiExecutor,
  type AgentExecutor,
  type ExecutorRegistry,
  type StepRunner,
  type WaitResult,
  type PipelineParams,
} from '@website-factory/core/pipeline';

/**
 * Orchestrator worker.
 *
 * Hosts the `ProjectPipeline` Cloudflare Workflow — the authoritative project
 * driver (ADR-0001, docs/workflow-state-machine.md) — plus scheduled
 * maintenance. D1/R2/workflow bindings are optional until the environment is
 * provisioned (docs/environments.md); handlers no-op with a log line when
 * bindings are absent.
 */

export interface Env {
  APP_ENV: string;
  DB?: D1Database;
  ASSETS_BUCKET?: R2Bucket;
  PROJECT_PIPELINE?: Workflow;
  /** Figma auth secret (ADR-0017); design stage stays simulated without it. */
  FIGMA_MCP_TOKEN?: string;
  /** Team/organization that owns generated design files, e.g. "team::123". */
  FIGMA_PLAN_KEY?: string;
  /** Claude API key; preferred agent provider when present. */
  ANTHROPIC_API_KEY?: string;
  /** Optional model override for real agents (default claude-opus-5). */
  ANTHROPIC_MODEL?: string;
  /** Workers AI binding — the no-extra-vendor agent provider fallback. */
  AI?: Ai;
  /** Optional Workers AI model override (default Llama 3.3 70B). */
  WORKERS_AI_MODEL?: string;
  /** Public web-app base URL; enables real tokenized preview deployments. */
  PREVIEW_BASE_URL?: string;
  /** GitHub token for per-project repositories (ADR-0018). */
  GITHUB_TOKEN?: string;
  /** Account that owns generated project repositories. */
  GITHUB_OWNER?: string;
  /** "true" when GITHUB_OWNER is an organization rather than a user. */
  GITHUB_OWNER_IS_ORG?: string;
  /** Shared secret for the operator backfill endpoint; absent = endpoint 404s. */
  INTERNAL_TASK_SECRET?: string;
}

/** Real executors light up per agent type as their credentials are provisioned. */
function buildExecutors(env: Env): ExecutorRegistry {
  const executors: ExecutorRegistry = {};
  if (env.DB) {
    // One executor serves every spec-backed agent type; AGENT_SPECS routes
    // the prompt/contract and the input loader assembles per-type inputs.
    // Claude is preferred when a key exists; Workers AI (the in-account
    // provider, no separate key) is the fallback.
    const inputLoader = createAgentInputLoader(createDb(env.DB));
    let llm: AgentExecutor | undefined;
    if (env.ANTHROPIC_API_KEY) {
      llm = new ClaudeExecutor({
        apiKey: env.ANTHROPIC_API_KEY,
        ...(env.ANTHROPIC_MODEL ? { model: env.ANTHROPIC_MODEL } : {}),
        inputLoader,
      });
    } else if (env.AI) {
      llm = new WorkersAiExecutor({
        ai: env.AI,
        ...(env.WORKERS_AI_MODEL ? { model: env.WORKERS_AI_MODEL } : {}),
        inputLoader,
      });
    }
    if (llm) {
      for (const agentType of Object.keys(AGENT_SPECS)) {
        executors[agentType] = llm;
      }
      // The developer agent's output is code: publish it to the project's own
      // repository on a feature branch and open a pull request (ADR-0018).
      // Agents never push to a default branch and never merge.
      if (env.GITHUB_TOKEN && env.GITHUB_OWNER) {
        const db = createDb(env.DB);
        const projects = createProjectsRepository(db);
        executors.developer = new GitHubPublishingExecutor({
          inner: llm,
          github: new GitHubRestClient({
            token: env.GITHUB_TOKEN,
            owner: env.GITHUB_OWNER,
            ownerIsOrg: env.GITHUB_OWNER_IS_ORG === 'true',
          }),
          resolveProjectName: async (task) => {
            const project = await projects.findById(
              tenantContext(task.organizationId),
              task.projectId,
            );
            return project?.name;
          },
          recordRepo: async (task, repo) => {
            await projects.setRepo(
              tenantContext(task.organizationId),
              task.projectId,
              { fullName: repo.fullName, url: repo.htmlUrl },
              new Date().toISOString(),
            );
          },
        });
      }
    }
  }
  if (env.PREVIEW_BASE_URL) {
    // The platform serves previews itself; production_deploy tasks fall
    // through to the simulated executor until real deployments exist.
    executors.project_manager = new PreviewDeployExecutor({
      baseUrl: env.PREVIEW_BASE_URL.replace(/\/$/, ''),
      fallback: new SimulatedExecutor(),
    });
  }
  if (env.FIGMA_MCP_TOKEN && env.FIGMA_PLAN_KEY) {
    if (env.FIGMA_MCP_TOKEN.startsWith('figd_')) {
      // Verified (ADR-0017 amendment): the hosted MCP rejects personal access
      // tokens outright — enabling the executor with one would fail every
      // design stage. Stay simulated until an mcp:connect OAuth token exists.
      logEvent('warn', 'figma.executor_disabled', {
        reason: 'FIGMA_MCP_TOKEN is a personal access token; hosted MCP requires mcp:connect OAuth',
      });
    } else {
      executors.uiux_design = new FigmaDesignExecutor(
        new FigmaMcpClient({ token: env.FIGMA_MCP_TOKEN, planKey: env.FIGMA_PLAN_KEY }),
      );
    }
  }
  return executors;
}

/**
 * Adapts Cloudflare's durable WorkflowStep to the engine's StepRunner. Step
 * results are memoized by name and retried by the platform; the engine's
 * D1-level idempotency keys make re-execution after a partial failure safe.
 */
class WorkflowStepRunner implements StepRunner {
  constructor(private readonly step: WorkflowStep) {}

  async do<T>(name: string, fn: () => Promise<T>): Promise<T> {
    // Engine step results are void or plain JSON-shaped objects, so the
    // Serializable<T> constraint holds at runtime; the cast bridges the
    // generic signatures without weakening runtime types.
    const result = await this.step.do(
      name,
      { retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' } },
      fn as unknown as () => Promise<never>,
    );
    return result as T;
  }

  async sleep(name: string, ms: number): Promise<void> {
    if (ms <= 0) return;
    await this.step.sleep(name, ms);
  }

  async waitForEvent<T>(
    name: string,
    opts: { type: string; timeoutMs: number },
  ): Promise<WaitResult<T>> {
    // The engine treats the event purely as a wake-up signal (ADR-0010) and
    // re-reads D1 afterwards, so mapping any wait failure to a timeout is
    // safe — the worst case is one extra poll.
    try {
      const event = await this.step.waitForEvent(name, {
        type: opts.type,
        timeout: opts.timeoutMs,
      });
      return { outcome: 'event', payload: event.payload as T };
    } catch {
      return { outcome: 'timeout' };
    }
  }
}

export class ProjectPipeline extends WorkflowEntrypoint<Env, PipelineParams> {
  override async run(event: WorkflowEvent<PipelineParams>, step: WorkflowStep): Promise<void> {
    const env = this.env;
    if (!env.DB) throw new Error('ProjectPipeline requires a D1 binding');
    await runPipeline(
      new WorkflowStepRunner(step),
      {
        db: createDb(env.DB),
        clock: systemClock,
        executor: new SimulatedExecutor(),
        executors: buildExecutors(env),
        // Simulated stage pacing so the client timeline visibly progresses.
        stageDurationMs: 5_000,
      },
      {
        projectId: event.payload.projectId,
        organizationId: event.payload.organizationId,
        workflowInstanceId: event.instanceId,
      },
    );
  }
}

/**
 * Operator-only backfill: dispatch one bounded developer-agent task for an
 * existing project (docs/agent-contracts.md). Needed for projects whose
 * development stage ran before per-project repositories existed (ADR-0018) —
 * it re-runs generation and publishes to the project's own repository.
 *
 * This does NOT transition stages: the workflow remains the authoritative
 * driver. It goes through the same dispatcher as the pipeline, so the audit
 * record, idempotency and artifact persistence are identical.
 */
async function dispatchDeveloperTask(
  request: Request,
  env: Env,
  projectId: string,
): Promise<Response> {
  if (!env.DB) return new Response('D1 binding required', { status: 503 });
  if (!env.INTERNAL_TASK_SECRET) return new Response('Not found', { status: 404 });
  if (request.headers.get('authorization') !== `Bearer ${env.INTERNAL_TASK_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { organizationId?: unknown };
  if (typeof body.organizationId !== 'string') {
    return Response.json({ error: 'organizationId is required' }, { status: 400 });
  }
  const organizationId = body.organizationId;

  const db = createDb(env.DB);
  const pipeline = createPipelineRepository(db);
  const ctx = tenantContext(organizationId);
  const latest = await pipeline.latestArtifact(ctx, projectId, 'code_change');
  const attempt = (latest?.version ?? 0) + 1;

  const dispatcher = new AgentDispatcher(db, systemClock, new SimulatedExecutor(), {
    ...buildExecutors(env),
  });
  try {
    const result = await dispatcher.run({
      projectId,
      organizationId,
      agentType: 'developer',
      contractVersion: 1,
      promptVersion: 'v1-simulated',
      inputArtifacts: [],
      outputArtifactType: 'code_change',
      idempotencyKey: `operator:development:${projectId}:${attempt}`,
      attempt,
    });
    const artifact = await pipeline.getArtifact(ctx, result.artifactId, result.version);
    return Response.json({
      ...result,
      externalRef: artifact?.externalRef ? JSON.parse(artifact.externalRef) : null,
    });
  } catch (error) {
    logEvent('error', 'operator.develop_failed', {
      projectId,
      message: error instanceof Error ? error.message : 'unknown error',
    });
    return Response.json(
      { error: error instanceof Error ? error.message : 'unknown error' },
      { status: 500 },
    );
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const develop = /^\/internal\/projects\/([^/]+)\/develop$/.exec(url.pathname);
    if (develop && request.method === 'POST') {
      return dispatchDeveloperTask(request, env, decodeURIComponent(develop[1]!));
    }
    if (url.pathname === '/health') {
      return Response.json({ service: 'website-factory-orchestrator', env: env.APP_ENV });
    }
    return new Response('Not found', { status: 404 });
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (!env.DB || !env.ASSETS_BUCKET) {
      logEvent('info', 'maintenance.skipped', {
        reason: 'D1/R2 bindings not provisioned in this environment',
      });
      return;
    }
    const maintenance = createMaintenance({ d1: env.DB, r2: env.ASSETS_BUCKET });
    ctx.waitUntil(
      maintenance.cleanupOrphanUploads().then((cleaned) => {
        logEvent('info', 'maintenance.orphan_uploads_cleaned', { cleaned });
      }),
    );
  },
};
