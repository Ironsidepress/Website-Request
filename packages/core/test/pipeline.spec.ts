import { describe, expect, it } from 'vitest';

import {
  createApprovalsRepository,
  createPipelineRepository,
  createProjectsRepository,
  tenantContext,
} from '@website-factory/db';

import {
  APPROVAL_GATES,
  PIPELINE_STAGES,
  FigmaDesignExecutor,
  InMemoryStepRunner,
  SimulatedExecutor,
  runPipeline,
  type AgentExecutor,
  type AgentTask,
  type FigmaClient,
  type PipelineDeps,
  type Principal,
  type WaitResult,
} from '../src';
import { submittedProject } from './fixtures';
import { createTestWorld, registerVerifiedUser, type TestWorld } from './helpers';

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

function pipelineDeps(
  world: TestWorld,
  executor: AgentExecutor,
  extra: Partial<PipelineDeps> = {},
): PipelineDeps {
  return { db: world.services.db, clock: world.clock, executor, stageDurationMs: 0, ...extra };
}

/** Registers the world's platform admin (bootstrap email must match). */
async function registerAdmin(world: TestWorld, email: string) {
  const admin = await registerVerifiedUser(world, {
    name: 'Platform Admin',
    email,
    password: 'a-strong-password',
  });
  if (admin.principal.platformRole !== 'admin') throw new Error('bootstrap did not promote');
  return admin;
}

/**
 * Decides the pending approval for a gate through the real service. Returns
 * false when nothing is pending (e.g. a replay re-visits a decided gate).
 */
async function decideGate(
  world: TestWorld,
  approver: Principal,
  organizationId: string,
  projectId: string,
  gate: string,
  decision: 'approved' | 'rejected',
  reason?: string,
): Promise<boolean> {
  const repo = createApprovalsRepository(world.services.db);
  const pending = (await repo.listPendingForProject(tenantContext(organizationId), projectId)).find(
    (row) => row.gate === gate,
  );
  if (!pending) return false;
  await world.services.approvals.decide(approver, organizationId, pending.id, {
    decision,
    ...(reason ? { reason } : {}),
  });
  return true;
}

/** Builds an onWait hook that runs per-gate decision callbacks. */
function gateWaits(
  handler: (gate: string, attempt: number, poll: number) => Promise<WaitResult<unknown>>,
): (name: string) => Promise<WaitResult<unknown>> {
  return async (name) => {
    const match = name.match(/^gate:(\w+):(\d+):wait:(\d+)$/);
    if (!match) return { outcome: 'timeout' };
    return handler(match[1] as string, Number(match[2]), Number(match[3]));
  };
}

describe('project pipeline (M6, real approval gates)', () => {
  it('runs created→live through human-approved gates, then replays without changes', async () => {
    const adminEmail = 'pipeline-admin-a@example.com';
    const world = createTestWorld({ initialAdminEmail: adminEmail });
    const { owner, org, projectId } = await submittedProject(world, 'pipe-a');
    const admin = await registerAdmin(world, adminEmail);
    const ctx = tenantContext(org.id);
    const projects = createProjectsRepository(world.services.db);
    const pipeline = createPipelineRepository(world.services.db);
    const approvalsRepo = createApprovalsRepository(world.services.db);
    const executor = new CountingExecutor();
    const params = { projectId, organizationId: org.id, workflowInstanceId: 'wf-test-a' };

    const onWait = gateWaits(async (gate) => {
      const approver = gate === 'production_approval' ? admin.principal : owner.principal;
      await decideGate(world, approver, org.id, projectId, gate, 'approved');
      return { outcome: 'event', payload: {} };
    });

    await runPipeline(new InMemoryStepRunner({ onWait }), pipelineDeps(world, executor), params);

    const project = await projects.findById(ctx, projectId);
    expect(project).toMatchObject({ currentStage: 'live', status: 'completed', health: 'ok' });

    // All three gates were human-decided, recorded in D1, and audited.
    const approvals = await approvalsRepo.listForProject(ctx, projectId);
    expect(approvals).toHaveLength(3);
    for (const approval of approvals) {
      expect(approval.status).toBe('approved');
      expect(approval.decidedBy).toBeTruthy();
      expect(approval.decidedAt).toBeTruthy();
    }
    const production = approvals.find((a) => a.gate === 'production_approval');
    expect(production?.decidedBy).toBe(admin.principal.userId);

    // Reviewed artifacts carry the gate outcome.
    const design = await pipeline.latestArtifact(ctx, projectId, 'figma_design');
    expect(design).toMatchObject({ version: 1, status: 'approved' });

    // Granted events are client-visible; agent audit trail is complete.
    const events = await projects.listEvents(ctx, projectId);
    expect(events.filter((e) => e.type === 'approval.granted')).toHaveLength(3);
    expect(events.some((e) => e.type === 'approval.auto_simulated')).toBe(false);
    const runs = await pipeline.listAgentRuns(ctx, projectId);
    expect(runs).toHaveLength(WORK_STAGES.length);
    expect(executor.executions).toBe(WORK_STAGES.length);
    for (const run of runs) {
      expect(run).toMatchObject({
        promptVersion: 'v1-simulated',
        model: 'simulated',
        status: 'succeeded',
      });
      expect(run.estimatedCostUsd).toBeGreaterThan(0);
      expect(run.completedAt).toBeTruthy();
    }

    const audit = await world.services.audit.listForOrganization({ organizationId: org.id });
    expect(audit.filter((e) => e.action === 'approval.approved')).toHaveLength(3);

    // Full replay with a fresh runner over the same DB changes nothing: the
    // gate requests reuse the decided rows and every write is absorbed.
    const eventCount = events.length;
    const historyCount = (await projects.listAllHistory(ctx, projectId)).length;
    await runPipeline(
      new InMemoryStepRunner(), // every wait times out; D1 already holds decisions
      pipelineDeps(world, executor),
      params,
    );
    expect((await projects.listEvents(ctx, projectId)).length).toBe(eventCount);
    expect((await projects.listAllHistory(ctx, projectId)).length).toBe(historyCount);
    expect((await approvalsRepo.listForProject(ctx, projectId)).length).toBe(3);
    expect(executor.executions).toBe(WORK_STAGES.length);
  });

  it('never advances on a forged wake-up event — only the D1 decision counts', async () => {
    const world = createTestWorld();
    const { owner, org, projectId } = await submittedProject(world, 'pipe-b');
    const params = { projectId, organizationId: org.id, workflowInstanceId: 'wf-test-b' };
    const polls: string[] = [];

    const onWait = gateWaits(async (gate, attempt, poll) => {
      polls.push(`${gate}:${attempt}:${poll}`);
      if (gate === 'design_review' && poll === 1) {
        // Forged event: a wake-up with no decision recorded in D1.
        return { outcome: 'event', payload: { forged: true, decision: 'approved' } };
      }
      if (gate === 'production_approval') {
        // Client gates approved by the owner; stop the run at the staff gate.
        return { outcome: 'timeout' };
      }
      await decideGate(world, owner.principal, org.id, projectId, gate, 'approved');
      return { outcome: 'event', payload: {} };
    });

    // Default timeouts: the unanswered staff gate exhausts its poll budget
    // and expires, terminating the run deterministically at that gate.
    await runPipeline(
      new InMemoryStepRunner({ onWait }),
      pipelineDeps(world, new SimulatedExecutor()),
      params,
    );

    // The forged event triggered a verify that found `pending` → a second
    // poll happened before the real approval advanced the gate.
    expect(polls).toContain('design_review:1:1');
    expect(polls).toContain('design_review:1:2');

    const projects = createProjectsRepository(world.services.db);
    const project = await projects.findById(tenantContext(org.id), projectId);
    // Gate expiry at production_approval parked the project — proving the
    // forged event never pushed anything past a gate on its own.
    expect(project).toMatchObject({ currentStage: 'production_approval', status: 'on_hold' });
  });

  it('rejection reworks the stage: new agent run, new artifact version, fresh gate', async () => {
    const world = createTestWorld();
    const { owner, org, projectId } = await submittedProject(world, 'pipe-c');
    const ctx = tenantContext(org.id);
    const pipeline = createPipelineRepository(world.services.db);
    const params = { projectId, organizationId: org.id, workflowInstanceId: 'wf-test-c' };

    // The owner decides the client gates; the staff gate is deliberately left
    // unanswered so the run stops there (its expiry path is covered elsewhere).
    const onWait = gateWaits(async (gate, attempt) => {
      if (gate === 'design_review' && attempt === 1) {
        await decideGate(
          world,
          owner.principal,
          org.id,
          projectId,
          gate,
          'rejected',
          'Please use warmer colors',
        );
        return { outcome: 'event', payload: {} };
      }
      if (gate === 'production_approval') return { outcome: 'timeout' };
      await decideGate(world, owner.principal, org.id, projectId, gate, 'approved');
      return { outcome: 'event', payload: {} };
    });

    await runPipeline(
      new InMemoryStepRunner({ onWait }),
      pipelineDeps(world, new SimulatedExecutor(), { gateTimeoutMs: 0 }),
      params,
    );

    // Design ran twice: v1 rejected with the client's reason, v2 approved.
    const v2 = await pipeline.latestArtifact(ctx, projectId, 'figma_design');
    expect(v2).toMatchObject({ version: 2, status: 'approved' });
    const artifacts = await pipeline.listArtifacts(ctx, projectId);
    const designVersions = artifacts.filter((a) => a.type === 'figma_design');
    expect(designVersions.find((a) => a.version === 1)?.status).toBe('rejected');

    const approvalsRepo = createApprovalsRepository(world.services.db);
    const gateRows = (await approvalsRepo.listForProject(ctx, projectId)).filter(
      (a) => a.gate === 'design_review',
    );
    expect(gateRows.map((a) => [a.stageAttempt, a.status]).sort()).toEqual([
      [1, 'rejected'],
      [2, 'approved'],
    ]);
    expect(gateRows.find((a) => a.status === 'rejected')?.decisionReason).toBe(
      'Please use warmer colors',
    );

    // The rejection is visible to the client; the rework advanced past the gate.
    const projects = createProjectsRepository(world.services.db);
    const events = await projects.listEvents(ctx, projectId);
    expect(events.filter((e) => e.type === 'approval.rejected')).toHaveLength(1);
    const project = await projects.findById(ctx, projectId);
    expect(project?.currentStage).toBe('production_approval');
  });

  it('caps rework attempts: the third rejection parks the project on hold', async () => {
    const world = createTestWorld();
    const { owner, org, projectId } = await submittedProject(world, 'pipe-d');
    const ctx = tenantContext(org.id);
    const params = { projectId, organizationId: org.id, workflowInstanceId: 'wf-test-d' };

    const onWait = gateWaits(async (gate) => {
      if (gate !== 'design_review') return { outcome: 'timeout' };
      await decideGate(world, owner.principal, org.id, projectId, gate, 'rejected', 'Not yet');
      return { outcome: 'event', payload: {} };
    });

    await runPipeline(
      new InMemoryStepRunner({ onWait }),
      pipelineDeps(world, new SimulatedExecutor()),
      params,
    );

    const projects = createProjectsRepository(world.services.db);
    const project = await projects.findById(ctx, projectId);
    expect(project).toMatchObject({
      currentStage: 'design_review',
      status: 'on_hold',
      health: 'needs_attention',
    });
    const approvalsRepo = createApprovalsRepository(world.services.db);
    const gateRows = (await approvalsRepo.listForProject(ctx, projectId)).filter(
      (a) => a.gate === 'design_review',
    );
    expect(gateRows).toHaveLength(3);
    expect(gateRows.every((a) => a.status === 'rejected')).toBe(true);
    const held = (await projects.listClientVisibleHistory(ctx, projectId)).filter(
      (h) => h.eventType === 'project.held',
    );
    expect(held).toHaveLength(1);
  });

  it('expires an unanswered gate and parks the project on hold', async () => {
    const world = createTestWorld();
    const { org, projectId } = await submittedProject(world, 'pipe-e');
    const ctx = tenantContext(org.id);
    const params = { projectId, organizationId: org.id, workflowInstanceId: 'wf-test-e' };

    await runPipeline(
      new InMemoryStepRunner(), // nobody ever answers
      pipelineDeps(world, new SimulatedExecutor(), { gateTimeoutMs: 0 }),
      params,
    );

    const approvalsRepo = createApprovalsRepository(world.services.db);
    const rows = await approvalsRepo.listForProject(ctx, projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ gate: 'design_review', status: 'expired' });
    const projects = createProjectsRepository(world.services.db);
    const project = await projects.findById(ctx, projectId);
    expect(project).toMatchObject({
      currentStage: 'design_review',
      status: 'on_hold',
      health: 'needs_attention',
    });
  });

  it('enforces the authority matrix and single-decision semantics', async () => {
    const adminEmail = 'pipeline-admin-f@example.com';
    const world = createTestWorld({ initialAdminEmail: adminEmail });
    const { owner, org, projectId } = await submittedProject(world, 'pipe-f');
    const admin = await registerAdmin(world, adminEmail);
    const ctx = tenantContext(org.id);
    const approvalsRepo = createApprovalsRepository(world.services.db);
    const now = '2026-07-29T12:00:00.000Z';

    const clientGate = await approvalsRepo.createPendingIfAbsent(ctx, {
      id: '0198e0a2-7b7a-7ccc-8f6c-000000000001',
      projectId,
      organizationId: org.id,
      gate: 'design_review',
      stageAttempt: 1,
      status: 'pending',
      requiredRoles: JSON.stringify(['owner', 'admin']),
      artifactRefs: '[]',
      requestedAt: now,
      expiresAt: '2026-08-29T12:00:00.000Z',
      workflowInstanceId: 'wf-test-f',
      createdAt: now,
      updatedAt: now,
    });
    const staffGate = await approvalsRepo.createPendingIfAbsent(ctx, {
      id: '0198e0a2-7b7a-7ccc-8f6c-000000000002',
      projectId,
      organizationId: org.id,
      gate: 'production_approval',
      stageAttempt: 1,
      status: 'pending',
      requiredRoles: JSON.stringify(['reviewer', 'admin']),
      artifactRefs: '[]',
      requestedAt: now,
      expiresAt: '2026-08-29T12:00:00.000Z',
      workflowInstanceId: 'wf-test-f',
      createdAt: now,
      updatedAt: now,
    });

    // A member can view but never decide.
    const member = await registerVerifiedUser(world, {
      name: 'Member No Approve',
      email: 'member-no-approve@example.com',
      password: 'a-strong-password',
    });
    await world.services.invitations.inviteMember(owner.principal, org.id, {
      email: 'member-no-approve@example.com',
      role: 'member',
    });
    const invite = world.emails.lastTo('member-no-approve@example.com');
    const token = new URL(invite!.text.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!;
    await world.services.invitations.accept(member.principal, token);
    await expect(
      world.services.approvals.decide(member.principal, org.id, clientGate.id, {
        decision: 'approved',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });

    // An outsider learns nothing.
    const outsider = await registerVerifiedUser(world, {
      name: 'Approval Outsider',
      email: 'approval-outsider@example.com',
      password: 'a-strong-password',
    });
    await expect(
      world.services.approvals.decide(outsider.principal, org.id, clientGate.id, {
        decision: 'approved',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });

    // The owner may not approve the staff-only launch gate.
    await expect(
      world.services.approvals.decide(owner.principal, org.id, staffGate.id, {
        decision: 'approved',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });

    // Rejections require a reason.
    await expect(
      world.services.approvals.decide(owner.principal, org.id, clientGate.id, {
        decision: 'rejected',
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });

    // The pending list marks what the caller can act on.
    const memberView = await world.services.approvals.listPendingForProject(
      member.principal,
      org.id,
      projectId,
    );
    expect(memberView).toHaveLength(2);
    expect(memberView.every((v) => !v.canDecide)).toBe(true);
    const ownerView = await world.services.approvals.listPendingForProject(
      owner.principal,
      org.id,
      projectId,
    );
    expect(ownerView.find((v) => v.gate === 'design_review')?.canDecide).toBe(true);
    expect(ownerView.find((v) => v.gate === 'production_approval')?.canDecide).toBe(false);

    // First decision wins; a second attempt conflicts. Admin decides the staff
    // gate cross-tenant and the on-behalf audit trail records it.
    await world.services.approvals.decide(owner.principal, org.id, clientGate.id, {
      decision: 'approved',
    });
    await expect(
      world.services.approvals.decide(admin.principal, org.id, clientGate.id, {
        decision: 'approved',
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await world.services.approvals.decide(admin.principal, org.id, staffGate.id, {
      decision: 'approved',
    });
    const audit = await world.services.audit.listForOrganization({ organizationId: org.id });
    const staffDecision = audit.find(
      (e) => e.action === 'approval.approved' && e.resourceId === staffGate.id,
    );
    expect(staffDecision).toBeTruthy();
    expect(JSON.parse(staffDecision!.metadata ?? '{}')).toMatchObject({ onBehalf: true });
  });

  it('records stage.failed and flags the project when work-stage retries exhaust', async () => {
    const world = createTestWorld();
    const { owner, org, projectId } = await submittedProject(world, 'pipe-g');
    const ctx = tenantContext(org.id);
    const projects = createProjectsRepository(world.services.db);
    const params = { projectId, organizationId: org.id, workflowInstanceId: 'wf-test-g' };

    const onWait = gateWaits(async (gate) => {
      await decideGate(world, owner.principal, org.id, projectId, gate, 'approved');
      return { outcome: 'event', payload: {} };
    });

    const failingRunner = new InMemoryStepRunner({
      onWait,
      maxAttempts: 3,
      failuresBeforeSuccess: { 'stage:development': 5 },
    });
    await expect(
      runPipeline(failingRunner, pipelineDeps(world, new SimulatedExecutor()), params),
    ).rejects.toThrow(/injected failure/);

    const failed = await projects.findById(ctx, projectId);
    expect(failed).toMatchObject({
      currentStage: 'design_review',
      status: 'active',
      health: 'needs_attention',
    });
    const events = await projects.listEvents(ctx, projectId);
    expect(events.filter((e) => e.type === 'stage.failed')).toHaveLength(1);
    const visible = await projects.listClientVisibleHistory(ctx, projectId);
    expect(visible.some((h) => h.eventType === 'stage.failed')).toBe(false);

    // Recovery: a fresh replay of the same instance finishes the work stage
    // without duplicating anything from the failed attempt.
    const onWaitRecovery = gateWaits(async (gate) => {
      if (gate === 'production_approval') return { outcome: 'timeout' };
      await decideGate(world, owner.principal, org.id, projectId, gate, 'approved');
      return { outcome: 'event', payload: {} };
    });
    await runPipeline(
      new InMemoryStepRunner({ onWait: onWaitRecovery }),
      pipelineDeps(world, new SimulatedExecutor(), { gateTimeoutMs: 0 }),
      params,
    );
    const recovered = await projects.findById(ctx, projectId);
    expect(recovered?.currentStage).toBe('production_approval');
    const eventsAfter = await projects.listEvents(ctx, projectId);
    expect(eventsAfter.filter((e) => e.type === 'stage.failed')).toHaveLength(1);
  });

  it('Figma executor produces an external-ref design artifact and a client review link', async () => {
    const world = createTestWorld();
    const { owner, org, projectId } = await submittedProject(world, 'pipe-figma');
    const ctx = tenantContext(org.id);
    const pipeline = createPipelineRepository(world.services.db);
    const params = { projectId, organizationId: org.id, workflowInstanceId: 'wf-test-figma' };

    const fakeFigma: FigmaClient = {
      async generateDesign(request) {
        return {
          fileKey: `fig-${request.projectId.slice(0, 8)}-v${request.attempt}`,
          fileUrl: `https://www.figma.com/design/fake-${request.attempt}`,
          nodeIds: ['1:1', '1:2'],
          snapshotUrl: 'https://images.figma.example/snapshot.png',
        };
      },
    };

    let reviewUrlAtGate: string | undefined;
    const onWait = gateWaits(async (gate) => {
      if (gate !== 'design_review') return { outcome: 'timeout' };
      // What the client sees while the gate is pending: the Figma review link.
      const pending = await world.services.approvals.listPendingForProject(
        owner.principal,
        org.id,
        projectId,
      );
      reviewUrlAtGate = pending.find((p) => p.gate === 'design_review')?.reviewUrl;
      await decideGate(world, owner.principal, org.id, projectId, gate, 'approved');
      return { outcome: 'event', payload: {} };
    });

    await runPipeline(
      new InMemoryStepRunner({ onWait }),
      pipelineDeps(world, new SimulatedExecutor(), {
        executors: { uiux_design: new FigmaDesignExecutor(fakeFigma) },
        gateTimeoutMs: 0, // run parks at the next unanswered gate
      }),
      params,
    );

    expect(reviewUrlAtGate).toBe('https://www.figma.com/design/fake-1');

    // The artifact is a reference, not a copy; approval projected onto it.
    const design = await pipeline.latestArtifact(ctx, projectId, 'figma_design');
    expect(design).toMatchObject({ version: 1, storage: 'external_ref', status: 'approved' });
    expect(design?.content).toBeNull();
    expect(JSON.parse(design?.externalRef ?? '{}')).toMatchObject({
      provider: 'figma',
      fileKey: expect.stringContaining('fig-') as string,
      nodeIds: ['1:1', '1:2'],
      reviewUrl: 'https://www.figma.com/design/fake-1',
    });

    // Other stages still ran through the default simulated executor.
    const research = await pipeline.latestArtifact(ctx, projectId, 'research_report');
    expect(research).toMatchObject({ storage: 'inline' });
    const runs = await pipeline.listAgentRuns(ctx, projectId);
    expect(runs.find((r) => r.agentType === 'uiux_design')?.model).toBe('figma-mcp');
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
    const { org, projectId } = await submittedProject(world, 'pipe-h');
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

    const failingWorld = createTestWorld({
      workflowStarter: {
        async start() {
          throw new Error('workflow service unavailable');
        },
      },
    });
    const failing = await submittedProject(failingWorld, 'pipe-i');
    const failingAudit = await failingWorld.services.audit.listForOrganization({
      organizationId: failing.org.id,
    });
    expect(failingAudit.filter((e) => e.action === 'workflow.start_failed')).toHaveLength(1);
  });

  it('signals the workflow after a decision; signal failures are audited, not fatal', async () => {
    const signals: Array<{ instanceId: string; approvalId: string; decision: string }> = [];
    const world = createTestWorld({
      workflowSignaler: {
        async signalApproval(instanceId, payload) {
          signals.push({ instanceId, ...payload });
        },
      },
    });
    const { owner, org, projectId } = await submittedProject(world, 'pipe-j');
    const ctx = tenantContext(org.id);
    const approvalsRepo = createApprovalsRepository(world.services.db);
    const now = '2026-07-29T12:00:00.000Z';
    const gate = await approvalsRepo.createPendingIfAbsent(ctx, {
      id: '0198e0a2-7b7a-7ccc-8f6c-000000000003',
      projectId,
      organizationId: org.id,
      gate: 'design_review',
      stageAttempt: 1,
      status: 'pending',
      requiredRoles: JSON.stringify(['owner', 'admin']),
      artifactRefs: '[]',
      requestedAt: now,
      expiresAt: '2026-08-29T12:00:00.000Z',
      workflowInstanceId: 'wf-signal-1',
      createdAt: now,
      updatedAt: now,
    });

    await world.services.approvals.decide(owner.principal, org.id, gate.id, {
      decision: 'approved',
    });
    expect(signals).toEqual([
      { instanceId: 'wf-signal-1', approvalId: gate.id, decision: 'approved' },
    ]);

    // A broken signaler never fails the decision — the poll fallback covers it.
    const brokenWorld = createTestWorld({
      workflowSignaler: {
        async signalApproval() {
          throw new Error('workflow unreachable');
        },
      },
    });
    const b = await submittedProject(brokenWorld, 'pipe-k');
    const bRepo = createApprovalsRepository(brokenWorld.services.db);
    const bGate = await bRepo.createPendingIfAbsent(tenantContext(b.org.id), {
      id: '0198e0a2-7b7a-7ccc-8f6c-000000000004',
      projectId: b.projectId,
      organizationId: b.org.id,
      gate: 'design_review',
      stageAttempt: 1,
      status: 'pending',
      requiredRoles: JSON.stringify(['owner', 'admin']),
      artifactRefs: '[]',
      requestedAt: now,
      expiresAt: '2026-08-29T12:00:00.000Z',
      workflowInstanceId: 'wf-signal-2',
      createdAt: now,
      updatedAt: now,
    });
    const result = await brokenWorld.services.approvals.decide(
      b.owner.principal,
      b.org.id,
      bGate.id,
      {
        decision: 'approved',
      },
    );
    expect(result.status).toBe('approved');
    const bAudit = await brokenWorld.services.audit.listForOrganization({
      organizationId: b.org.id,
    });
    expect(bAudit.filter((e) => e.action === 'workflow.signal_failed')).toHaveLength(1);
  });
});
