import { describe, expect, it } from 'vitest';

import { PASSWORD, ownerWithCompleteIntake } from './fixtures';
import { createTestWorld, registerVerifiedUser } from './helpers';

describe('intake submission → project', () => {
  it('rejects submission while sections are incomplete', async () => {
    const world = createTestWorld();
    const owner = await registerVerifiedUser(world, {
      name: 'Too Early',
      email: 'too-early@example.com',
      password: PASSWORD,
    });
    const org = await world.services.organizations.create(owner.principal, {
      name: 'Early Org',
      contactEmail: 'early@example.com',
    });
    await world.services.intake.getOrCreateDraft(owner.principal, org.id);
    await expect(
      world.services.projects.submitIntake(owner.principal, org.id, { confirmAccuracy: true }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('freezes the intake, creates one project with stage history, and is idempotent', async () => {
    const world = createTestWorld();
    const { owner, org } = await ownerWithCompleteIntake(world, 'a');

    // The wizard needs the attestation; the service injects nothing — it must
    // come from the stored document. Save it via the review flow equivalent:
    // Without the attestation, submission is refused.
    await expect(
      world.services.projects.submitIntake(owner.principal, org.id, { confirmAccuracy: false }),
    ).rejects.toMatchObject({ code: 'validation_failed' });

    const first = await world.services.projects.submitIntake(owner.principal, org.id, {
      confirmAccuracy: true,
    });
    expect(first.alreadySubmitted).toBe(false);

    // Double submission returns the same project.
    const second = await world.services.projects.submitIntake(owner.principal, org.id, {
      confirmAccuracy: true,
    });
    expect(second).toEqual({ projectId: first.projectId, alreadySubmitted: true });

    const projectList = await world.services.projects.listForOrganization(owner.principal, org.id);
    expect(projectList).toHaveLength(1);
    expect(projectList[0]).toMatchObject({ currentStage: 'created', status: 'active' });

    // Draft is frozen: autosave now fails.
    await expect(
      world.services.intake.saveSection(owner.principal, org.id, 'business', {
        baseRevision: 10,
        data: {},
      }),
    ).rejects.toMatchObject({ code: 'not_found' });

    const audit = await world.services.audit.listForOrganization({ organizationId: org.id });
    expect(audit.filter((e) => e.action === 'intake.submitted')).toHaveLength(1);
  });

  it('rejects submissions referencing files the tenant does not own', async () => {
    const world = createTestWorld();
    const { owner, org } = await ownerWithCompleteIntake(world, 'b');
    const view = await world.services.intake.getOrCreateDraft(owner.principal, org.id);
    await world.services.intake.saveSection(owner.principal, org.id, 'branding', {
      baseRevision: view.revision,
      data: {
        hasBrandAssets: true,
        assetFileIds: ['0198e0a2-7b7a-7ccc-8f6c-999999999999'], // nobody owns this
      },
    });
    await expect(
      world.services.projects.submitIntake(owner.principal, org.id, { confirmAccuracy: true }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('members cannot submit; owners can (permission matrix)', async () => {
    const world = createTestWorld();
    const { owner, org } = await ownerWithCompleteIntake(world, 'c');
    const member = await registerVerifiedUser(world, {
      name: 'Member No Submit',
      email: 'member-no-submit@example.com',
      password: PASSWORD,
    });
    await world.services.invitations.inviteMember(owner.principal, org.id, {
      email: 'member-no-submit@example.com',
      role: 'member',
    });
    const message = world.emails.lastTo('member-no-submit@example.com');
    const token = new URL(message!.text.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!;
    await world.services.invitations.accept(member.principal, token);

    await expect(
      world.services.projects.submitIntake(member.principal, org.id, { confirmAccuracy: true }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('timeline shows created as active, later stages upcoming, safe events only', async () => {
    const world = createTestWorld();
    const { owner, org } = await ownerWithCompleteIntake(world, 'd');
    const { projectId } = await world.services.projects.submitIntake(owner.principal, org.id, {
      confirmAccuracy: true,
    });

    const timeline = await world.services.projects.timeline(owner.principal, org.id, projectId);
    expect(timeline.project.id).toBe(projectId);
    expect(timeline.stages[0]).toMatchObject({ stage: 'created', status: 'active' });
    expect(timeline.stages.filter((s) => s.status === 'upcoming')).toHaveLength(13);
    expect(timeline.events).toHaveLength(1);
    expect(timeline.events[0]?.description).toContain('Project created');

    // Tenant isolation on the timeline.
    const outsider = await registerVerifiedUser(world, {
      name: 'Timeline Outsider',
      email: 'timeline-outsider@example.com',
      password: PASSWORD,
    });
    await expect(
      world.services.projects.timeline(outsider.principal, org.id, projectId),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
