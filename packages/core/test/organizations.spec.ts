import { describe, expect, it } from 'vitest';

import { DomainError } from '../src/errors';
import { createTestWorld, registerVerifiedUser } from './helpers';

describe('organizations and tenant isolation', () => {
  it('creates an organization with the creator as owner', async () => {
    const world = createTestWorld();
    const { principal } = await registerVerifiedUser(world, {
      name: 'Owner One',
      email: 'owner1@example.com',
      password: 'a-strong-password',
    });

    const org = await world.services.organizations.create(principal, {
      name: 'Ironside Press',
      contactEmail: 'hello@ironsidepress.net',
    });

    const memberships = await world.services.organizations.listForPrincipal(principal);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.organization.id).toBe(org.id);
    expect(memberships[0]?.role).toBe('owner');

    const members = await world.services.organizations.listMembers(principal, org.id);
    expect(members).toEqual([expect.objectContaining({ userId: principal.userId, role: 'owner' })]);

    const audit = await world.services.audit.listForOrganization({ organizationId: org.id });
    expect(audit.map((event) => event.action)).toContain('organization.created');
  });

  it('flagship isolation: tenant B cannot see or touch tenant A resources', async () => {
    const world = createTestWorld();
    const alice = await registerVerifiedUser(world, {
      name: 'Alice A',
      email: 'alice@tenant-a.com',
      password: 'a-strong-password',
    });
    const bob = await registerVerifiedUser(world, {
      name: 'Bob B',
      email: 'bob@tenant-b.com',
      password: 'a-strong-password',
    });

    const orgA = await world.services.organizations.create(alice.principal, {
      name: 'Tenant A',
      contactEmail: 'a@tenant-a.com',
    });
    const orgB = await world.services.organizations.create(bob.principal, {
      name: 'Tenant B',
      contactEmail: 'b@tenant-b.com',
    });

    // Reads across the tenant boundary are indistinguishable from absence (404).
    await expect(
      world.services.organizations.listMembers(bob.principal, orgA.id),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      world.services.organizations.getForPrincipal(bob.principal, orgA.id),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      world.services.invitations.listForOrganization(bob.principal, orgA.id),
    ).rejects.toMatchObject({ code: 'not_found' });

    // Writes across the boundary are rejected the same way.
    await expect(
      world.services.invitations.inviteMember(bob.principal, orgA.id, {
        email: 'mole@tenant-b.com',
        role: 'member',
      }),
    ).rejects.toBeInstanceOf(DomainError);

    // Listings never leak the other tenant.
    const bobOrgs = await world.services.organizations.listForPrincipal(bob.principal);
    expect(bobOrgs.map((m) => m.organization.id)).toEqual([orgB.id]);
    const auditA = await world.services.audit.listForOrganization({ organizationId: orgA.id });
    expect(auditA.every((event) => event.organizationId === orgA.id)).toBe(true);
  });

  it('rejects organization creation for unverified principals', async () => {
    const world = createTestWorld();
    const { principal } = await registerVerifiedUser(world, {
      name: 'Verified',
      email: 'verified@example.com',
      password: 'a-strong-password',
    });
    const unverified = { ...principal, emailVerified: false };
    await expect(
      world.services.organizations.create(unverified, {
        name: 'Nope',
        contactEmail: 'nope@example.com',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
