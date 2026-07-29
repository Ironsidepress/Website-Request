import type { Database } from '@website-factory/db';
import {
  createPipelineRepository,
  createProjectsRepository,
  tenantContext,
} from '@website-factory/db';

import type { Clock } from '../clock';
import { isoNow } from '../clock';
import { newId } from '../ids';
import { APPROVAL_GATES, PIPELINE_STAGES, type PipelineStage } from '../state-machine';
import { AgentDispatcher, type AgentExecutor } from './dispatcher';

/**
 * The ProjectPipeline engine (docs/workflow-state-machine.md).
 *
 * Orchestration is expressed against a tiny StepRunner abstraction so the
 * exact same code runs under Cloudflare Workflows (durable, retried,
 * memoized by step name) and under the in-memory runner in tests
 * (docs/testing-strategy.md). Every step is idempotent: events + history
 * append atomically under a UNIQUE idempotency key, projections use guarded
 * updates, and agent runs replay from their recorded results.
 */

export interface StepRunner {
  do<T>(name: string, fn: () => Promise<T>): Promise<T>;
  sleep(name: string, ms: number): Promise<void>;
}

export interface PipelineParams {
  projectId: string;
  organizationId: string;
  workflowInstanceId: string;
}

export interface PipelineDeps {
  db: Database;
  clock: Clock;
  executor: AgentExecutor;
  /** Simulated stage duration; seconds in demos, ~0 in tests. */
  stageDurationMs?: number;
  /** Test hook: throw inside a stage to exercise retry/exhaustion paths. */
  failureInjector?: (stage: PipelineStage) => void;
}

/** Work stages and the bounded agent task each one dispatches. */
const STAGE_TASKS: Partial<Record<PipelineStage, { agentType: string; artifactType: string }>> = {
  research: { agentType: 'research', artifactType: 'research_report' },
  content_strategy: { agentType: 'content_strategy', artifactType: 'content_plan' },
  creative_direction: { agentType: 'creative_direction', artifactType: 'creative_brief' },
  design: { agentType: 'uiux_design', artifactType: 'figma_design' },
  development: { agentType: 'developer', artifactType: 'code_change' },
  testing: { agentType: 'tester', artifactType: 'test_report' },
  seo_review: { agentType: 'seo_aeo', artifactType: 'seo_report' },
  preview_deploy: { agentType: 'project_manager', artifactType: 'preview_deployment' },
  production_deploy: { agentType: 'project_manager', artifactType: 'production_deployment' },
};

export async function runPipeline(
  runner: StepRunner,
  deps: PipelineDeps,
  params: PipelineParams,
): Promise<void> {
  const ctx = tenantContext(params.organizationId);
  const projects = createProjectsRepository(deps.db);
  const pipeline = createPipelineRepository(deps.db);
  const dispatcher = new AgentDispatcher(deps.db, deps.clock, deps.executor);
  const duration = deps.stageDurationMs ?? 5_000;
  const attempt = 1; // Rework loops arrive with the M6 approval gates.

  const record = async (
    stage: PipelineStage,
    from: PipelineStage,
    eventType: string,
    clientVisible: boolean,
    actorType: 'system' | 'agent' = 'system',
  ) => {
    const now = isoNow(deps.clock);
    await projects.appendEventWithHistory(
      ctx,
      {
        id: newId(),
        projectId: params.projectId,
        organizationId: params.organizationId,
        type: eventType,
        schemaVersion: 1,
        actorType,
        actorId: 'project-pipeline',
        idempotencyKey: `${params.workflowInstanceId}:${stage}:${attempt}:${eventType}`,
        payload: JSON.stringify({ stage, from, attempt }),
        occurredAt: now,
        createdAt: now,
      },
      {
        id: newId(),
        projectId: params.projectId,
        organizationId: params.organizationId,
        fromStage: from,
        toStage: stage,
        attempt,
        eventType,
        actorType,
        actorId: 'project-pipeline',
        workflowInstanceId: params.workflowInstanceId,
        clientVisible,
        createdAt: now,
      },
    );
  };

  let from: PipelineStage = 'created';
  let attempting: PipelineStage = 'created';
  try {
    for (const stage of PIPELINE_STAGES) {
      if (stage === 'created') continue;
      const previous = from;
      attempting = stage;

      if (APPROVAL_GATES.has(stage)) {
        // M5 placeholder: the gate is recorded and immediately auto-advanced by
        // the simulator. M6 replaces the auto-advance with a real pause
        // (waitForEvent + D1-verified human decision, ADR-0010).
        await runner.do(`gate:${stage}:${attempt}`, async () => {
          await record(stage, previous, 'approval.requested', true);
          await pipeline.projectStage(ctx, params.projectId, previous, stage, isoNow(deps.clock));
          await record(stage, previous, 'approval.auto_simulated', false);
        });
        from = stage;
        continue;
      }

      if (stage === 'live') {
        await runner.do(`stage:live:${attempt}`, async () => {
          await record('live', previous, 'stage.started', true);
          await pipeline.projectStage(ctx, params.projectId, previous, 'live', isoNow(deps.clock));
          await pipeline.markProjectCompleted(ctx, params.projectId, isoNow(deps.clock));
        });
        break;
      }

      await runner.sleep(`work:${stage}:${attempt}`, duration);
      await runner.do(`stage:${stage}:${attempt}`, async () => {
        deps.failureInjector?.(stage);
        await record(stage, previous, 'stage.started', true);
        await pipeline.projectStage(ctx, params.projectId, previous, stage, isoNow(deps.clock));

        const task = STAGE_TASKS[stage];
        if (task) {
          await dispatcher.run({
            projectId: params.projectId,
            organizationId: params.organizationId,
            agentType: task.agentType,
            contractVersion: 1,
            promptVersion: 'v1-simulated',
            inputArtifacts: [],
            outputArtifactType: task.artifactType,
            idempotencyKey: `${params.workflowInstanceId}:${stage}:${attempt}:agent`,
            attempt,
          });
        }
        await record(stage, previous, 'stage.completed', true);
      });
      from = stage;
    }
  } catch (error) {
    // Retry exhaustion: leave a truthful record and surface on the dashboard —
    // nothing is silently dropped (docs/workflow-state-machine.md).
    await runner.do(`failure:${attempting}:${attempt}`, async () => {
      await record(attempting, from, 'stage.failed', false);
      await pipeline.setProjectHealth(ctx, params.projectId, 'needs_attention', isoNow(deps.clock));
    });
    throw error;
  }
}
