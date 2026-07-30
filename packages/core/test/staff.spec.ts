import { describe, expect, it } from 'vitest';

import { createPipelineRepository, tenantContext } from '@website-factory/db';

import { isoNow } from '../src/clock';
import { submittedProject } from './fixtures';
import { createTestWorld, registerVerifiedUser, type TestWorld } from './helpers';

async function admin(world: TestWorld, email: string) {
  const staff = await registerVerifiedUser(world, {
    name: 'Staff Admin',
    email,
    password: 'a-strong-password',
  });
  if (staff.principal.platformRole !== 'admin') throw new Error('bootstrap did not promote');
  return staff;
}

describe('staff dashboard (M7)', () => {
  it('admin sees cross-tenant projects with filters and pending gates; reads are audited', async () => {
    const adminEmail = 'staff-admin-a@example.com';
    const world = createTestWorld({ initialAdminEmail: adminEmail });
    const a = await submittedProject(world, 'staff-a');
    const b = await submittedProject(world, 'staff-b');
    const staff = await admin(world, adminEmail);

    const all = await world.services.staff.listProjects(staff.principal);
    const ids = all.map((row) => row.project.id);
    expect(ids).toContain(a.projectId);
    expect(ids).toContain(b.projectId);
    expect(all.find((r) => r.project.id === a.projectId)?.organizationName).toContain('staff-a');

    // Filters work on projection columns.
    const held = await world.services.staff.listProjects(staff.principal, { status: 'on_hold' });
    expect(held.map((r) => r.project.id)).not.toContain(a.projectId);

    // The cross-tenant read left an audit record.
    const audit = await world.services.audit.listAll();
    expect(audit.some((e) => e.action === 'staff.read' && e.resourceType === 'project_list')).toBe(
      true,
    );
  });

  it('project detail exposes internals to staff only; non-staff get 404-shaped errors', async () => {
    const adminEmail = 'staff-admin-b@example.com';
    const world = createTestWorld({ initialAdminEmail: adminEmail });
    const { owner, org, projectId } = await submittedProject(world, 'staff-c');
    const staff = await admin(world, adminEmail);

    const detail = await world.services.staff.projectDetail(staff.principal, projectId);
    expect(detail.project.id).toBe(projectId);
    expect(detail.organizationName).toContain('staff-c');
    expect(detail.intake?.status).toBe('submitted');
    expect(detail.history.length).toBeGreaterThan(0);
    expect(Array.isArray(detail.agentRuns)).toBe(true);
    expect(Array.isArray(detail.audit)).toBe(true);

    // A client owner is not staff: the platform surface does not exist for them.
    await expect(
      world.services.staff.projectDetail(owner.principal, projectId),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(world.services.staff.listProjects(owner.principal)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      world.services.staff.performAction(owner.principal, projectId, { action: 'hold' }),
    ).rejects.toMatchObject({ code: 'not_found' });
    void org;
  });

  it('hold/resume/cancel/retry are guarded transitions, audited, and restart the pipeline', async () => {
    const adminEmail = 'staff-admin-c@example.com';
    const started: string[] = [];
    const world = createTestWorld({
      initialAdminEmail: adminEmail,
      workflowStarter: {
        async start(params) {
          started.push(params.projectId);
          return { instanceId: `cf-restart-${started.length}` };
        },
      },
    });
    const { org, projectId } = await submittedProject(world, 'staff-d');
    const staff = await admin(world, adminEmail);
    const ctx = tenantContext(org.id);
    const pipeline = createPipelineRepository(world.services.db);

    // hold: active → on_hold; resume: on_hold → active + restart.
    // (Submission already started instance 1 via the configured starter.)
    await world.services.staff.performAction(staff.principal, projectId, { action: 'hold' });
    await expect(
      world.services.staff.performAction(staff.principal, projectId, { action: 'hold' }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await world.services.staff.performAction(staff.principal, projectId, { action: 'resume' });
    expect(started).toHaveLength(2);

    // retry requires needs_attention.
    await expect(
      world.services.staff.performAction(staff.principal, projectId, { action: 'retry' }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await pipeline.setProjectHealth(ctx, projectId, 'needs_attention', isoNow(world.clock));
    await world.services.staff.performAction(staff.principal, projectId, { action: 'retry' });
    expect(started).toHaveLength(3);

    // cancel requires a reason and closes the project.
    await expect(
      world.services.staff.performAction(staff.principal, projectId, { action: 'cancel' }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await world.services.staff.performAction(staff.principal, projectId, {
      action: 'cancel',
      reason: 'Client requested cancellation',
    });
    const detail = await world.services.staff.projectDetail(staff.principal, projectId);
    expect(detail.project.status).toBe('cancelled');
    await expect(
      world.services.staff.performAction(staff.principal, projectId, {
        action: 'cancel',
        reason: 'again',
      }),
    ).rejects.toMatchObject({ code: 'conflict' });

    // Every action produced an audit event.
    const audit = await world.services.audit.listAll(500);
    for (const action of [
      'staff.project_hold',
      'staff.project_resume',
      'staff.project_retry',
      'staff.project_cancel',
      'workflow.restarted',
    ]) {
      expect(audit.some((e) => e.action === action && e.resourceId === projectId)).toBe(true);
    }
  });

  it('staff pending-approvals queue spans tenants', async () => {
    const adminEmail = 'staff-admin-d@example.com';
    const world = createTestWorld({ initialAdminEmail: adminEmail });
    const { org, projectId } = await submittedProject(world, 'staff-e');
    const staff = await admin(world, adminEmail);

    const { createApprovalsRepository } = await import('@website-factory/db');
    const repo = createApprovalsRepository(world.services.db);
    const now = '2026-07-29T12:00:00.000Z';
    await repo.createPendingIfAbsent(tenantContext(org.id), {
      id: '0198e0a2-7b7a-7ccc-8f6c-000000000005',
      projectId,
      organizationId: org.id,
      gate: 'design_review',
      stageAttempt: 1,
      status: 'pending',
      requiredRoles: JSON.stringify(['owner', 'admin']),
      artifactRefs: '[]',
      requestedAt: now,
      expiresAt: '2026-08-29T12:00:00.000Z',
      workflowInstanceId: 'wf-staff-e',
      createdAt: now,
      updatedAt: now,
    });

    const queue = await world.services.staff.listPendingApprovals(staff.principal);
    const entry = queue.find((q) => q.approval.projectId === projectId);
    expect(entry).toBeTruthy();
    expect(entry?.organizationName).toContain('staff-e');
    expect(entry?.projectName).toContain('website');
  });

  it('attachDesign stores an external-ref design version and repoints the pending gate', async () => {
    const adminEmail = 'staff-admin-e@example.com';
    const world = createTestWorld({ initialAdminEmail: adminEmail });
    const { owner, org, projectId } = await submittedProject(world, 'staff-f');
    const staff = await admin(world, adminEmail);
    const ctx = tenantContext(org.id);

    const { createApprovalsRepository } = await import('@website-factory/db');
    const repo = createApprovalsRepository(world.services.db);
    const now = '2026-07-30T12:00:00.000Z';
    const approvalId = '0198e0a2-7b7a-7ccc-8f6c-000000000006';
    await repo.createPendingIfAbsent(ctx, {
      id: approvalId,
      projectId,
      organizationId: org.id,
      gate: 'design_review',
      stageAttempt: 1,
      status: 'pending',
      requiredRoles: JSON.stringify(['owner', 'admin']),
      artifactRefs: JSON.stringify([{ artifactId: `${projectId}:figma_design`, version: 1 }]),
      requestedAt: now,
      expiresAt: '2026-08-30T12:00:00.000Z',
      workflowInstanceId: 'wf-staff-f',
      createdAt: now,
      updatedAt: now,
    });

    // Clients cannot attach designs.
    await expect(
      world.services.staff.attachDesign(owner.principal, projectId, {
        fileKey: 'nope',
        fileUrl: 'https://www.figma.com/design/nope',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });

    const attached = await world.services.staff.attachDesign(staff.principal, projectId, {
      fileKey: 'FILE123',
      fileUrl: 'https://www.figma.com/design/FILE123/charlies',
      nodeIds: ['1:2'],
    });
    expect(attached).toEqual({ artifactId: `${projectId}:figma_design`, version: 1 });

    const pipeline = createPipelineRepository(world.services.db);
    const artifact = await pipeline.latestArtifact(ctx, projectId, 'figma_design');
    expect(artifact).toMatchObject({ storage: 'external_ref', createdByType: 'user' });
    expect(JSON.parse(artifact!.externalRef ?? '{}')).toMatchObject({
      provider: 'figma',
      fileKey: 'FILE123',
      reviewUrl: 'https://www.figma.com/design/FILE123/charlies',
    });

    // The client's pending gate now resolves the real review link.
    const pending = await world.services.approvals.listPendingForProject(
      owner.principal,
      org.id,
      projectId,
    );
    expect(pending.find((p) => p.id === approvalId)?.reviewUrl).toBe(
      'https://www.figma.com/design/FILE123/charlies',
    );

    // Attaching again produces the next version and repoints the gate again.
    const second = await world.services.staff.attachDesign(staff.principal, projectId, {
      fileKey: 'FILE456',
      fileUrl: 'https://www.figma.com/design/FILE456/charlies-v2',
    });
    expect(second.version).toBe(2);

    const audit = await world.services.audit.listAll(500);
    expect(
      audit.some((e) => e.action === 'staff.design_attached' && e.resourceId === projectId),
    ).toBe(true);
  });
});
