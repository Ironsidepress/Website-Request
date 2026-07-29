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
  runPipeline,
  systemClock,
  SimulatedExecutor,
  type StepRunner,
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
}

/**
 * Adapts Cloudflare's durable WorkflowStep to the engine's StepRunner. Step
 * results are memoized by name and retried by the platform; the engine's
 * D1-level idempotency keys make re-execution after a partial failure safe.
 */
class WorkflowStepRunner implements StepRunner {
  constructor(private readonly step: WorkflowStep) {}

  async do<T>(name: string, fn: () => Promise<T>): Promise<T> {
    // The engine uses steps for side effects only (T is void throughout), so
    // the Serializable<T> constraint on step results is trivially satisfied;
    // the cast bridges the generic signatures without weakening runtime types.
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
      console.log(
        JSON.stringify({
          event: 'maintenance.skipped',
          reason: 'D1/R2 bindings not provisioned in this environment',
        }),
      );
      return;
    }
    const maintenance = createMaintenance({ d1: env.DB, r2: env.ASSETS_BUCKET });
    ctx.waitUntil(
      maintenance.cleanupOrphanUploads().then((cleaned) => {
        console.log(JSON.stringify({ event: 'maintenance.orphan_uploads_cleaned', cleaned }));
      }),
    );
  },
};
