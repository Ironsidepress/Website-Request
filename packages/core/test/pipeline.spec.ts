import { describe, expect, it } from 'vitest';

import {
  createPipelineRepository,
  createProjectsRepository,
  tenantContext,
} from '@website-factory/db';

import {
  APPROVAL_GATES,
  PIPELINE_STAGES,
  InMemoryStepRunner,
  SimulatedExecutor,
  runPipeline,
  type AgentExecutor,
  type AgentTask,
  type PipelineDeps,
} from '../src';
import { submittedProject } from './fixtures';
import { createTestWorld, type TestWorld } from './helpers';

const WORK_STAGES = PIPELINE_STAGES.filter(
  (s) => s !== 'created' && s !== 'live' && !APPROVAL_GATES.has(s),
);

/** Counts real executions so replays can prove they never re-run agents. */
class CountingExecutor implements AgentExecutor {
  executions = 0;
  private readonly inner = new SimulatedExecutor();
  async execute(task: AgentTask) {
    this.executions += 1;
    return this.inner.execute(task);
  }
}

function pipelineDeps(world: TestWorld, executor: AgentExecutor): PipelineDeps {
  return { db: world.services.db, clock: world.clock, executor, stageDurationMs: 0 };
}

describe('project pipeline (M5, simulated stages)', () => {
  it('drives a submitted project from created to live with a full audit trail', async () => {
    const world = createTestWorld();
    const { owner, org, projectId } = await submittedProject(world, 'pipe-a');
    const ctx = tenantContext(org.id);
    const projects = createProjectsRepository(world.services.db);
    const pipeline = createPipelineRepository(world.services.db);
    const executor = new CountingExecutor();

    const baselineEvents = (await projects.listEvents(ctx, projectId)).length;
    const baselineHistory = (await projects.listAllHistory(ctx, projectId)).length;

    await runPipeline(new InMemoryStepRunner(), pipelineDeps(world, executor), {
      projectId,
      organizationId: org.id,
      workflowInstanceId: 'wf-test-a',
    });

    const project = await projects.findById(ctx, projectId);
    expect(project).toMatchObject({ currentStage: 'live', status: 'completed', health: 'ok' });

    // Work stages emit started+completed, gates emit requested+auto_simulated,
    // live emits started: 9*2 + 3*2 + 1 = 25 events, each with a history row.
    const events = await projects.listEvents(ctx, projectId);
    expect(events.length - baselineEvents).toBe(25);
    const history = await projects.listAllHistory(ctx, projectId);
    expect(history.length - baselineHistory).toBe(25);

    // The auto-advanced gates are honestly labeled and never client-visible.
    const simulatedApprovals = events.filter((e) => e.type === 'approval.auto_simulated');
    expect(simulatedApprovals).toHaveLength(3);
    const visibleTypes = new Set(
      history.filter((h) => h.clientVisible).map((h) => h.eventType ?? ''),
    );
    expect(visibleTypes.has('approval.auto_simulated')).toBe(false);
    expect(visibleTypes.has('approval.requested')).toBe(true);

    // One agent run per work stage, carrying every mandated audit field.
    const runs = await pipeline.listAgentRuns(ctx, projectId);
    expect(runs).toHaveLength(WORK_STAGES.length);
    expect(executor.executions).toBe(WORK_STAGES.length);
    for (const run of runs) {
      expect(run).toMatchObject({
        projectId,
        organizationId: org.id,
        contractVersion: 1,
        promptVersion: 'v1-simulated',
        model: 'simulated',
        status: 'succeeded',
        retryCount: 0,
      });
      expect(run.agentType).toBeTruthy();
      expect(run.startedAt).toBeTruthy();
      expect(run.completedAt).toBeTruthy();
      expect(run.inputTokens).toBeGreaterThan(0);
      expect(run.outputTokens).toBeGreaterThan(0);
      expect(run.estimatedCostUsd).toBeGreaterThan(0);
      expect(JSON.parse(run.inputArtifacts)).toEqual([]);
      expect(JSON.parse(run.outputArtifacts ?? '[]')).toHaveLength(1);
      expect(run.idempotencyKey).toMatch(/^wf-test-a:.+:1:agent$/);
      expect(run.errorDetail).toBeNull();
    }

    // One immutable draft artifact per work stage.
    const artifacts = await pipeline.listArtifacts(ctx, projectId);
    expect(artifacts).toHaveLength(WORK_STAGES.length);
    for (const artifact of artifacts) {
      expect(artifact).toMatchObject({ version: 1, status: 'draft', storage: 'inline' });
      expect(JSON.parse(artifact.content ?? '{}')).toMatchObject({ simulated: true });
    }

    // The client timeline reflects the finished pipeline without internals.
    const timeline = await world.services.projects.timeline(owner.principal, org.id, projectId);
    expect(timeline.stages.at(-1)).toMatchObject({ stage: 'live', status: 'active' });
    expect(timeline.stages.filter((s) => s.status === 'done')).toHaveLength(13);
  });

  it('is idempotent: a full replay over the same database changes nothing', async () => {
    const world = createTestWorld();
    const { org, projectId } = await submittedProject(world, 'pipe-b');
    const ctx = tenantContext(org.id);
    const projects = createProjectsRepository(world.services.db);
    const pipeline = createPipelineRepository(world.services.db);
    const executor = new CountingExecutor();
    const params = { projectId, organizationId: org.id, workflowInstanceId: 'wf-test-b' };

    await runPipeline(new InMemoryStepRunner(), pipelineDeps(world, executor), params);
    const eventsAfterFirst = (await projects.listEvents(ctx, projectId)).length;
    const historyAfterFirst = (await projects.listAllHistory(ctx, projectId)).length;
    const runsAfterFirst = (await pipeline.listAgentRuns(ctx, projectId)).length;
    const executionsAfterFirst = executor.executions;

    // A fresh runner over the same DB models a full workflow replay: every
    // write is absorbed by idempotency keys and guarded projections.
    await runPipeline(new InMemoryStepRunner(), pipelineDeps(world, executor), params);

    expect((await projects.listEvents(ctx, projectId)).length).toBe(eventsAfterFirst);
    expect((await projects.listAllHistory(ctx, projectId)).length).toBe(historyAfterFirst);
    expect((await pipeline.listAgentRuns(ctx, projectId)).length).toBe(runsAfterFirst);
    expect((await pipeline.listArtifacts(ctx, projectId)).length).toBe(runsAfterFirst);
    expect(executor.executions).toBe(executionsAfterFirst);

    const project = await projects.findById(ctx, projectId);
    expect(project).toMatchObject({ currentStage: 'live', status: 'completed' });
  });

  it('records stage.failed and flags the project when retries are exhausted', async () => {
    const world = createTestWorld();
    const { org, projectId } = await submittedProject(world, 'pipe-c');
    const ctx = tenantContext(org.id);
    const projects = createProjectsRepository(world.services.db);
    const params = { projectId, organizationId: org.id, workflowInstanceId: 'wf-test-c' };

    const failingRunner = new InMemoryStepRunner({
      maxAttempts: 3,
      failuresBeforeSuccess: { 'stage:development': 5 },
    });
    await expect(
      runPipeline(failingRunner, pipelineDeps(world, new SimulatedExecutor()), params),
    ).rejects.toThrow(/injected failure/);

    // The project is parked at the last completed stage and flagged.
    const failed = await projects.findById(ctx, projectId);
    expect(failed).toMatchObject({
      currentStage: 'design_review',
      status: 'active',
      health: 'needs_attention',
    });

    const events = await projects.listEvents(ctx, projectId);
    const failures = events.filter((e) => e.type === 'stage.failed');
    expect(failures).toHaveLength(1);
    expect(failures[0]?.idempotencyKey).toBe('wf-test-c:development:1:stage.failed');
    expect(JSON.parse(failures[0]?.payload ?? '{}')).toMatchObject({ stage: 'development' });

    // Failures are internal — the client timeline never shows them.
    const visible = await projects.listClientVisibleHistory(ctx, projectId);
    expect(visible.some((h) => h.eventType === 'stage.failed')).toBe(false);

    // Recovery: replaying the same instance once the fault clears finishes the
    // pipeline without duplicating anything from the failed attempt.
    await runPipeline(
      new InMemoryStepRunner(),
      pipelineDeps(world, new SimulatedExecutor()),
      params,
    );
    const recovered = await projects.findById(ctx, projectId);
    expect(recovered).toMatchObject({ currentStage: 'live', status: 'completed', health: 'ok' });
    const eventsAfter = await projects.listEvents(ctx, projectId);
    expect(eventsAfter.filter((e) => e.type === 'stage.failed')).toHaveLength(1);
    const startedDevelopment = eventsAfter.filter(
      (e) =>
        e.type === 'stage.started' &&
        (JSON.parse(e.payload ?? '{}') as { stage?: string }).stage === 'development',
    );
    expect(startedDevelopment).toHaveLength(1);
  });

  it('submission starts the workflow, records the run, and start failures are non-fatal', async () => {
    const started: Array<{ projectId: string; organizationId: string }> = [];
    const world = createTestWorld({
      workflowStarter: {
        async start(params) {
          started.push(params);
          return { instanceId: `cf-${params.projectId}` };
        },
      },
    });
    const { org, projectId } = await submittedProject(world, 'pipe-d');
    expect(started).toEqual([{ projectId, organizationId: org.id }]);

    const projects = createProjectsRepository(world.services.db);
    const runs = await projects.listWorkflowRuns(tenantContext(org.id), projectId);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      workflowName: 'project-pipeline',
      cfInstanceId: `cf-${projectId}`,
      status: 'running',
    });
    const audit = await world.services.audit.listForOrganization({ organizationId: org.id });
    expect(audit.filter((e) => e.action === 'workflow.started')).toHaveLength(1);

    // A broken starter must never lose the submission.
    const failingWorld = createTestWorld({
      workflowStarter: {
        async start() {
          throw new Error('workflow service unavailable');
        },
      },
    });
    const failing = await submittedProject(failingWorld, 'pipe-e');
    const failingAudit = await failingWorld.services.audit.listForOrganization({
      organizationId: failing.org.id,
    });
    expect(failingAudit.filter((e) => e.action === 'workflow.start_failed')).toHaveLength(1);
    const project = await createProjectsRepository(failingWorld.services.db).findById(
      tenantContext(failing.org.id),
      failing.projectId,
    );
    expect(project).toMatchObject({ currentStage: 'created', status: 'active' });
  });
});
