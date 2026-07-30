import type { Database } from '@website-factory/db';
import {
  createApprovalsRepository,
  createPipelineRepository,
  createProjectsRepository,
  tenantContext,
} from '@website-factory/db';

import type { Clock } from '../clock';
import { isoNow } from '../clock';
import { newId } from '../ids';
import { APPROVAL_GATES, PIPELINE_STAGES, type PipelineStage } from '../state-machine';
import { AgentDispatcher, type AgentExecutor, type ExecutorRegistry } from './dispatcher';

/**
 * The ProjectPipeline engine (docs/workflow-state-machine.md).
 *
 * Orchestration is expressed against a tiny StepRunner abstraction so the
 * exact same code runs under Cloudflare Workflows (durable, retried,
 * memoized by step name) and under the in-memory runner in tests
 * (docs/testing-strategy.md). Every step is idempotent: events + history
 * append atomically under a UNIQUE idempotency key, projections use guarded
 * updates, and agent runs replay from their recorded results.
 *
 * Approval gates (ADR-0010): the workflow creates the `approvals` row, pauses
 * on waitForEvent with a poll fallback, and on every wake re-reads the row in
 * D1 — the decision API is the sole writer of decisions and the event is only
 * a wake-up signal. Forged or lost events can never advance the pipeline.
 */

export type WaitResult<T> = { outcome: 'event'; payload: T } | { outcome: 'timeout' };

export interface StepRunner {
  do<T>(name: string, fn: () => Promise<T>): Promise<T>;
  sleep(name: string, ms: number): Promise<void>;
  waitForEvent<T>(name: string, opts: { type: string; timeoutMs: number }): Promise<WaitResult<T>>;
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
  /** Per-agent-type overrides (e.g. uiux_design → Figma, ADR-0017). */
  executors?: ExecutorRegistry;
  /** Simulated stage duration; seconds in demos, ~0 in tests. */
  stageDurationMs?: number;
  /** Total lifetime of a pending approval before it expires (default 30 days). */
  gateTimeoutMs?: number;
  /** waitForEvent slice; each timeout re-checks D1 (poll fallback, ADR-0010). */
  gatePollMs?: number;
  /** Test hook: throw inside a stage to exercise retry/exhaustion paths. */
  failureInjector?: (stage: PipelineStage) => void;
}

/**
 * Wake-up event for paused gates. Dashed, not dotted: Cloudflare Workflows
 * rejects dots in event types (workflow.invalid_event_type) — found live when
 * approval signals failed on staging and gates only advanced on the 24h poll.
 */
export const APPROVAL_EVENT_TYPE = 'approval-decision';
/** Rejections at a gate beyond this many stage attempts force on_hold. */
export const MAX_GATE_ATTEMPTS = 3;
const DEFAULT_GATE_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_GATE_POLL_MS = 24 * 60 * 60 * 1000;

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

type GateType = 'design_review' | 'preview_review' | 'production_approval';

/** Gate policy per docs/user-roles.md (authority) and the transition table. */
const GATE_CONFIG: Record<
  GateType,
  {
    requiredRoles: readonly string[];
    reviewArtifactType: string;
    onReject: { kind: 'rework'; to: PipelineStage } | { kind: 'hold' };
  }
> = {
  design_review: {
    requiredRoles: ['owner', 'admin'],
    reviewArtifactType: 'figma_design',
    onReject: { kind: 'rework', to: 'design' },
  },
  preview_review: {
    requiredRoles: ['owner', 'admin'],
    reviewArtifactType: 'preview_deployment',
    onReject: { kind: 'rework', to: 'development' },
  },
  production_approval: {
    requiredRoles: ['reviewer', 'admin'],
    reviewArtifactType: 'preview_deployment',
    onReject: { kind: 'hold' },
  },
};

type GateOutcome =
  { result: 'approved' } | { result: 'rework'; to: PipelineStage } | { result: 'hold' };

export async function runPipeline(
  runner: StepRunner,
  deps: PipelineDeps,
  params: PipelineParams,
): Promise<void> {
  const ctx = tenantContext(params.organizationId);
  const projects = createProjectsRepository(deps.db);
  const pipeline = createPipelineRepository(deps.db);
  const approvals = createApprovalsRepository(deps.db);
  const dispatcher = new AgentDispatcher(deps.db, deps.clock, deps.executor, deps.executors);
  const duration = deps.stageDurationMs ?? 5_000;
  const gateTimeoutMs = deps.gateTimeoutMs ?? DEFAULT_GATE_TIMEOUT_MS;
  const gatePollMs = deps.gatePollMs ?? DEFAULT_GATE_POLL_MS;

  const record = async (
    stage: PipelineStage,
    from: PipelineStage,
    attempt: number,
    eventType: string,
    clientVisible: boolean,
    extraPayload: Record<string, unknown> = {},
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
        actorType: 'system',
        actorId: 'project-pipeline',
        idempotencyKey: `${params.workflowInstanceId}:${stage}:${attempt}:${eventType}`,
        payload: JSON.stringify({ stage, from, attempt, ...extraPayload }),
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
        actorType: 'system',
        actorId: 'project-pipeline',
        workflowInstanceId: params.workflowInstanceId,
        clientVisible,
        createdAt: now,
      },
    );
  };

  /**
   * One full gate pass: request (idempotent), then wait/verify until the D1
   * row leaves `pending` or its deadline passes. Every wake — real decision
   * event, forged event, or poll timeout — funnels into the same D1 read.
   */
  const runGate = async (
    stage: GateType,
    previous: PipelineStage,
    attempt: number,
  ): Promise<GateOutcome> => {
    const cfg = GATE_CONFIG[stage];

    const approvalId = await runner.do(`gate:${stage}:${attempt}:request`, async () => {
      const artifact = await pipeline.latestArtifact(ctx, params.projectId, cfg.reviewArtifactType);
      const now = isoNow(deps.clock);
      const approval = await approvals.getOrCreateForAttempt(ctx, {
        id: newId(),
        projectId: params.projectId,
        organizationId: params.organizationId,
        gate: stage,
        stageAttempt: attempt,
        status: 'pending',
        requiredRoles: JSON.stringify(cfg.requiredRoles),
        artifactRefs: JSON.stringify(
          artifact ? [{ artifactId: artifact.artifactId, version: artifact.version }] : [],
        ),
        requestedAt: now,
        expiresAt: new Date(Date.parse(now) + gateTimeoutMs).toISOString(),
        workflowInstanceId: params.workflowInstanceId,
        createdAt: now,
        updatedAt: now,
      });
      await record(stage, previous, attempt, 'approval.requested', true, {
        approvalId: approval.id,
      });
      await pipeline.projectStage(ctx, params.projectId, previous, stage, now);
      return approval.id;
    });

    // The poll budget mirrors the total gate timeout: once the waits have
    // consumed it, the gate is expired even if a frozen clock says otherwise.
    const maxPolls = Math.max(1, Math.ceil(gateTimeoutMs / Math.max(1, gatePollMs))) + 1;
    for (let poll = 1; ; poll += 1) {
      await runner.waitForEvent(`gate:${stage}:${attempt}:wait:${poll}`, {
        type: APPROVAL_EVENT_TYPE,
        timeoutMs: gatePollMs,
      });

      // ADR-0010: D1 is the source of truth; the event was only a wake-up.
      const verdict = await runner.do(`gate:${stage}:${attempt}:verify:${poll}`, async () => {
        const row = await approvals.findById(ctx, approvalId);
        if (!row) throw new Error('approval row missing');
        const expired =
          row.status === 'pending' &&
          (poll >= maxPolls || Date.parse(isoNow(deps.clock)) >= Date.parse(row.expiresAt));
        return {
          status: row.status,
          expired,
          decidedBy: row.decidedBy,
          reason: row.decisionReason,
          artifactRefs: row.artifactRefs,
        };
      });

      const refs = JSON.parse(verdict.artifactRefs) as Array<{
        artifactId: string;
        version: number;
      }>;

      if (verdict.status === 'approved') {
        await runner.do(`gate:${stage}:${attempt}:granted`, async () => {
          for (const ref of refs) {
            await pipeline.setArtifactStatus(ctx, ref.artifactId, ref.version, 'approved');
          }
          await record(stage, previous, attempt, 'approval.granted', true, {
            approvalId,
            decidedBy: verdict.decidedBy,
          });
        });
        return { result: 'approved' };
      }

      if (verdict.status === 'rejected') {
        const outcome: GateOutcome =
          cfg.onReject.kind === 'rework' && attempt < MAX_GATE_ATTEMPTS
            ? { result: 'rework', to: cfg.onReject.to }
            : { result: 'hold' };
        await runner.do(`gate:${stage}:${attempt}:rejected`, async () => {
          for (const ref of refs) {
            await pipeline.setArtifactStatus(ctx, ref.artifactId, ref.version, 'rejected');
          }
          await record(stage, previous, attempt, 'approval.rejected', true, {
            approvalId,
            decidedBy: verdict.decidedBy,
            reason: verdict.reason,
            next: outcome.result,
          });
        });
        return outcome;
      }

      if (verdict.expired) {
        await runner.do(`gate:${stage}:${attempt}:expired`, async () => {
          await approvals.expire(ctx, approvalId, isoNow(deps.clock));
          await record(stage, previous, attempt, 'approval.expired', false, { approvalId });
        });
        return { result: 'hold' };
      }
      // Still pending and not expired: spurious wake or poll slice — wait again.
    }
  };

  const holdProject = async (stage: PipelineStage, from: PipelineStage, attempt: number) => {
    await runner.do(`hold:${stage}:${attempt}`, async () => {
      const now = isoNow(deps.clock);
      await pipeline.setProjectStatus(ctx, params.projectId, 'on_hold', now);
      await pipeline.setProjectHealth(ctx, params.projectId, 'needs_attention', now);
      await record(stage, from, attempt, 'project.held', true);
    });
  };

  // Per-stage attempt counters: rework loops re-enter stages with a fresh
  // attempt so step names, idempotency keys and artifact versions advance.
  const attempts = new Map<PipelineStage, number>();
  const enter = (stage: PipelineStage): number => {
    const next = (attempts.get(stage) ?? 0) + 1;
    attempts.set(stage, next);
    return next;
  };

  let index = 1; // PIPELINE_STAGES[0] is 'created'
  let from: PipelineStage = 'created';
  let attempting: PipelineStage = 'created';
  let attemptingAttempt = 1;

  try {
    while (index < PIPELINE_STAGES.length) {
      const stage = PIPELINE_STAGES[index] as PipelineStage;
      const previous = from;
      const attempt = enter(stage);
      attempting = stage;
      attemptingAttempt = attempt;

      if (APPROVAL_GATES.has(stage)) {
        const outcome = await runGate(stage as GateType, previous, attempt);
        if (outcome.result === 'hold') {
          await holdProject(stage, previous, attempt);
          return; // Instance ends; admin resume starts a new one (M7).
        }
        from = stage;
        if (outcome.result === 'rework') {
          index = PIPELINE_STAGES.indexOf(outcome.to);
          continue;
        }
        index += 1;
        continue;
      }

      if (stage === 'live') {
        await runner.do(`stage:live:${attempt}`, async () => {
          await record('live', previous, attempt, 'stage.started', true);
          await pipeline.projectStage(ctx, params.projectId, previous, 'live', isoNow(deps.clock));
          await pipeline.markProjectCompleted(ctx, params.projectId, isoNow(deps.clock));
        });
        return;
      }

      await runner.sleep(`work:${stage}:${attempt}`, duration);
      await runner.do(`stage:${stage}:${attempt}`, async () => {
        deps.failureInjector?.(stage);
        await record(stage, previous, attempt, 'stage.started', true);
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
        await record(stage, previous, attempt, 'stage.completed', true);
      });
      from = stage;
      index += 1;
    }
  } catch (error) {
    // Retry exhaustion: leave a truthful record and surface on the dashboard —
    // nothing is silently dropped (docs/workflow-state-machine.md).
    await runner.do(`failure:${attempting}:${attemptingAttempt}`, async () => {
      await record(attempting, from, attemptingAttempt, 'stage.failed', false);
      await pipeline.setProjectHealth(ctx, params.projectId, 'needs_attention', isoNow(deps.clock));
    });
    throw error;
  }
}
