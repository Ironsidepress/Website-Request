import { describe, expect, it } from 'vitest';

import { createTestWorld, registerVerifiedUser, type TestWorld } from './helpers';

const PASSWORD = 'a-strong-password';

async function ownerWithOrg(world: TestWorld, tag: string) {
  const owner = await registerVerifiedUser(world, {
    name: `Owner ${tag}`,
    email: `intake-owner-${tag}@example.com`,
    password: PASSWORD,
  });
  const org = await world.services.organizations.create(owner.principal, {
    name: `Intake Org ${tag}`,
    contactEmail: `intake-${tag}@example.com`,
  });
  return { owner, org };
}

describe('intake drafts and autosave', () => {
  it('creates one draft per organization, idempotently', async () => {
    const world = createTestWorld();
    const { owner, org } = await ownerWithOrg(world, 'a');

    const first = await world.services.intake.getOrCreateDraft(owner.principal, org.id);
    const second = await world.services.intake.getOrCreateDraft(owner.principal, org.id);
    expect(first.id).toBe(second.id);
    expect(first.revision).toBe(0);
    expect(first.validity.business.started).toBe(false);

    const audit = await world.services.audit.listForOrganization({ organizationId: org.id });
    expect(audit.filter((e) => e.action === 'intake.draft_created')).toHaveLength(1);
  });

  it('autosaves sections, bumps revisions, records history and validity', async () => {
    const world = createTestWorld();
    const { owner, org } = await ownerWithOrg(world, 'b');
    await world.services.intake.getOrCreateDraft(owner.principal, org.id);

    const afterFirst = await world.services.intake.saveSection(
      owner.principal,
      org.id,
      'business',
      {
        baseRevision: 0,
        data: { legalName: 'Half-typed', contact: { email: 'not-finished' } },
      },
    );
    expect(afterFirst.revision).toBe(1);
    expect(afterFirst.validity.business).toMatchObject({ started: true, valid: false });

    const afterSecond = await world.services.intake.saveSection(
      owner.principal,
      org.id,
      'business',
      {
        baseRevision: 1,
        data: {
          legalName: 'Ironside Press LLC',
          displayName: 'Ironside Press',
          description: 'A letterpress print shop for small businesses and events.',
          contact: { email: 'hello@ironsidepress.net' },
          serviceArea: 'local',
        },
      },
    );
    expect(afterSecond.revision).toBe(2);
    expect(afterSecond.validity.business.valid).toBe(true);

    const revisions = await world.services.intake.listRevisions(owner.principal, org.id);
    expect(revisions.map((r) => r.revision)).toEqual([1, 2]);
    expect(revisions.every((r) => r.actorUserId === owner.principal.userId)).toBe(true);

    const audit = await world.services.audit.listForOrganization({ organizationId: org.id });
    expect(audit.filter((e) => e.action === 'intake.section_saved')).toHaveLength(2);
  });

  it('rejects stale base revisions with a conflict and loses no data', async () => {
    const world = createTestWorld();
    const { owner, org } = await ownerWithOrg(world, 'c');
    await world.services.intake.getOrCreateDraft(owner.principal, org.id);

    await world.services.intake.saveSection(owner.principal, org.id, 'competitors', {
      baseRevision: 0,
      data: { differentiation: 'tab one wins' },
    });

    // A second tab still holding baseRevision 0 must get a 409-style conflict.
    await expect(
      world.services.intake.saveSection(owner.principal, org.id, 'competitors', {
        baseRevision: 0,
        data: { differentiation: 'tab two would clobber' },
      }),
    ).rejects.toMatchObject({ code: 'conflict' });

    // A base revision ahead of the server is also a conflict and writes nothing.
    await expect(
      world.services.intake.saveSection(owner.principal, org.id, 'competitors', {
        baseRevision: 5,
        data: { differentiation: 'confused client' },
      }),
    ).rejects.toMatchObject({ code: 'conflict' });

    const view = await world.services.intake.getOrCreateDraft(owner.principal, org.id);
    expect(view.revision).toBe(1);
    expect((view.data.competitors as { differentiation: string }).differentiation).toBe(
      'tab one wins',
    );
    const revisions = await world.services.intake.listRevisions(owner.principal, org.id);
    expect(revisions).toHaveLength(1);
  });

  it('rejects unknown sections and oversized drafts', async () => {
    const world = createTestWorld();
    const { owner, org } = await ownerWithOrg(world, 'd');
    await world.services.intake.getOrCreateDraft(owner.principal, org.id);

    await expect(
      world.services.intake.saveSection(owner.principal, org.id, 'not_a_section', {
        baseRevision: 0,
        data: {},
      }),
    ).rejects.toThrow();

    await expect(
      world.services.intake.saveSection(owner.principal, org.id, 'business', {
        baseRevision: 0,
        data: { note: 'x'.repeat(40 * 1024) },
      }),
    ).rejects.toThrow();
  });

  it('tenant isolation: another organization cannot read or write the draft', async () => {
    const world = createTestWorld();
    const { owner, org } = await ownerWithOrg(world, 'e');
    await world.services.intake.getOrCreateDraft(owner.principal, org.id);

    const outsider = await registerVerifiedUser(world, {
      name: 'Outsider',
      email: 'intake-outsider@example.com',
      password: PASSWORD,
    });

    await expect(
      world.services.intake.getOrCreateDraft(outsider.principal, org.id),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      world.services.intake.saveSection(outsider.principal, org.id, 'business', {
        baseRevision: 0,
        data: {},
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      world.services.intake.listRevisions(outsider.principal, org.id),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('members (not only owners) can edit the intake', async () => {
    const world = createTestWorld();
    const { owner, org } = await ownerWithOrg(world, 'f');
    await world.services.intake.getOrCreateDraft(owner.principal, org.id);

    const member = await registerVerifiedUser(world, {
      name: 'Helping Member',
      email: 'intake-member@example.com',
      password: PASSWORD,
    });
    await world.services.invitations.inviteMember(owner.principal, org.id, {
      email: 'intake-member@example.com',
      role: 'member',
    });
    const token = (() => {
      const message = world.emails.lastTo('intake-member@example.com');
      const url = new URL(message!.text.match(/https?:\/\/\S+/)![0]);
      return url.searchParams.get('token')!;
    })();
    await world.services.invitations.accept(member.principal, token);

    const saved = await world.services.intake.saveSection(member.principal, org.id, 'examples', {
      baseRevision: 0,
      data: { likedWebsites: [] },
    });
    expect(saved.revision).toBe(1);
  });
});
