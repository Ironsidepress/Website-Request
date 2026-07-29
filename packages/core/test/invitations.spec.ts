import { describe, expect, it } from 'vitest';

import { createTestWorld, extractInvitationToken, registerVerifiedUser } from './helpers';

const PASSWORD = 'a-strong-password';

async function ownerWithOrg(world: ReturnType<typeof createTestWorld>, tag: string) {
  const owner = await registerVerifiedUser(world, {
    name: `Owner ${tag}`,
    email: `owner-${tag}@example.com`,
    password: PASSWORD,
  });
  const org = await world.services.organizations.create(owner.principal, {
    name: `Org ${tag}`,
    contactEmail: `org-${tag}@example.com`,
  });
  return { owner, org };
}

describe('member invitations', () => {
  it('owner invites, matching verified user accepts, membership appears', async () => {
    const world = createTestWorld();
    const { owner, org } = await ownerWithOrg(world, 'a');
    const invitee = await registerVerifiedUser(world, {
      name: 'New Member',
      email: 'member@example.com',
      password: PASSWORD,
    });

    await world.services.invitations.inviteMember(owner.principal, org.id, {
      email: 'member@example.com',
      role: 'member',
    });
    const token = extractInvitationToken(world, 'member@example.com');

    const result = await world.services.invitations.accept(invitee.principal, token);
    expect(result).toEqual({ kind: 'organization_member', organizationId: org.id });

    const members = await world.services.organizations.listMembers(owner.principal, org.id);
    expect(members).toHaveLength(2);
    expect(members).toContainEqual(
      expect.objectContaining({ userId: invitee.principal.userId, role: 'member' }),
    );

    const actions = (
      await world.services.audit.listForOrganization({ organizationId: org.id })
    ).map((event) => event.action);
    expect(actions).toContain('invitation.created');
    expect(actions).toContain('invitation.accepted');
  });

  it('rejects acceptance by a user with a different email', async () => {
    const world = createTestWorld();
    const { owner, org } = await ownerWithOrg(world, 'b');
    const wrongPerson = await registerVerifiedUser(world, {
      name: 'Wrong Person',
      email: 'someone-else@example.com',
      password: PASSWORD,
    });

    await world.services.invitations.inviteMember(owner.principal, org.id, {
      email: 'intended@example.com',
      role: 'member',
    });
    const token = extractInvitationToken(world, 'intended@example.com');

    await expect(
      world.services.invitations.accept(wrongPerson.principal, token),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('rejects replayed and expired invitations', async () => {
    const world = createTestWorld();
    const { owner, org } = await ownerWithOrg(world, 'c');
    const invitee = await registerVerifiedUser(world, {
      name: 'Replay',
      email: 'replay@example.com',
      password: PASSWORD,
    });

    await world.services.invitations.inviteMember(owner.principal, org.id, {
      email: 'replay@example.com',
      role: 'member',
    });
    const token = extractInvitationToken(world, 'replay@example.com');
    await world.services.invitations.accept(invitee.principal, token);

    // Replay
    await expect(world.services.invitations.accept(invitee.principal, token)).rejects.toMatchObject(
      {
        code: 'conflict',
      },
    );

    // Expiry: a fresh invitation, clock advanced past the 7-day TTL.
    await world.services.invitations.inviteMember(owner.principal, org.id, {
      email: 'late@example.com',
      role: 'member',
    });
    const lateToken = extractInvitationToken(world, 'late@example.com');
    const late = await registerVerifiedUser(world, {
      name: 'Late',
      email: 'late@example.com',
      password: PASSWORD,
    });
    world.clock.advance(8 * 24 * 60 * 60 * 1000);
    await expect(
      world.services.invitations.accept(late.principal, lateToken),
    ).rejects.toMatchObject({
      code: 'expired',
    });
  });

  it('members cannot invite; only owners manage members', async () => {
    const world = createTestWorld();
    const { owner, org } = await ownerWithOrg(world, 'd');
    const member = await registerVerifiedUser(world, {
      name: 'Just A Member',
      email: 'plain-member@example.com',
      password: PASSWORD,
    });
    await world.services.invitations.inviteMember(owner.principal, org.id, {
      email: 'plain-member@example.com',
      role: 'member',
    });
    const token = extractInvitationToken(world, 'plain-member@example.com');
    await world.services.invitations.accept(member.principal, token);

    await expect(
      world.services.invitations.inviteMember(member.principal, org.id, {
        email: 'friend@example.com',
        role: 'member',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('revoked invitations cannot be accepted', async () => {
    const world = createTestWorld();
    const { owner, org } = await ownerWithOrg(world, 'e');
    const invitee = await registerVerifiedUser(world, {
      name: 'Revoked',
      email: 'revoked@example.com',
      password: PASSWORD,
    });

    const { invitationId } = await world.services.invitations.inviteMember(
      owner.principal,
      org.id,
      {
        email: 'revoked@example.com',
        role: 'member',
      },
    );
    const token = extractInvitationToken(world, 'revoked@example.com');
    await world.services.invitations.revoke(owner.principal, org.id, invitationId);

    await expect(world.services.invitations.accept(invitee.principal, token)).rejects.toMatchObject(
      {
        code: 'not_found',
      },
    );
  });
});

describe('staff invitations (invitation-only staff)', () => {
  it('admin invites staff; acceptance assigns the platform role', async () => {
    const world = createTestWorld({ initialAdminEmail: 'admin@ironsidepress.net' });
    const admin = await registerVerifiedUser(world, {
      name: 'The Admin',
      email: 'admin@ironsidepress.net',
      password: PASSWORD,
    });
    expect(admin.principal.platformRole).toBe('admin');

    const reviewer = await registerVerifiedUser(world, {
      name: 'Rae Reviewer',
      email: 'reviewer@ironsidepress.net',
      password: PASSWORD,
    });

    await world.services.invitations.inviteStaff(admin.principal, {
      email: 'reviewer@ironsidepress.net',
      role: 'reviewer',
    });
    const token = extractInvitationToken(world, 'reviewer@ironsidepress.net');
    const result = await world.services.invitations.accept(reviewer.principal, token);
    expect(result).toEqual({ kind: 'staff' });

    const refreshed = await world.services.auth.getPrincipal(
      new Headers({ cookie: reviewer.cookie }),
    );
    expect(refreshed?.platformRole).toBe('reviewer');
  });

  it('non-admins cannot invite staff', async () => {
    const world = createTestWorld();
    const civilian = await registerVerifiedUser(world, {
      name: 'No Authority',
      email: 'civilian@example.com',
      password: PASSWORD,
    });
    await expect(
      world.services.invitations.inviteStaff(civilian.principal, {
        email: 'target@example.com',
        role: 'admin',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
