import type {
  D1Database,
  R2Bucket,
  ScheduledController,
  ExecutionContext,
  Workflow,
} from '@cloudflare/workers-types';
import { WorkflowEntrypoint, type WorkflowStep, type WorkflowEvent } from 'cloudflare:workers';
import { createDb } from '@website-factory/db';
import { createMaintenance } from '@website-factory/core/maintenance';
import {
  ClaudeExecutor,
  createAgentInputLoader,
  FigmaDesignExecutor,
  FigmaMcpClient,
  logEvent,
  runPipeline,
  systemClock,
  SimulatedExecutor,
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
  /** Claude API key; research/content stages stay simulated without it. */
  ANTHROPIC_API_KEY?: string;
  /** Optional model override for real agents (default claude-opus-5). */
  ANTHROPIC_MODEL?: string;
}

/** Real executors light up per agent type as their credentials are provisioned. */
function buildExecutors(env: Env): ExecutorRegistry {
  const executors: ExecutorRegistry = {};
  if (env.ANTHROPIC_API_KEY && env.DB) {
    // One executor serves every Claude-backed agent type; AGENT_SPECS routes
    // the prompt/contract and the input loader assembles per-type inputs.
    const claude = new ClaudeExecutor({
      apiKey: env.ANTHROPIC_API_KEY,
      ...(env.ANTHROPIC_MODEL ? { model: env.ANTHROPIC_MODEL } : {}),
      inputLoader: createAgentInputLoader(createDb(env.DB)),
    });
    executors.research = claude;
    executors.content_strategy = claude;
    executors.creative_direction = claude;
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
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
