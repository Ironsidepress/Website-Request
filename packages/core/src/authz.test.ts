import { describe, expect, it } from 'vitest';

import {
  requirePlatformPermission,
  requirePrincipal,
  requireTenantPermission,
  requireVerified,
} from './authz';
import { DomainError, type DomainErrorCode } from './errors';
import type { Membership, Principal } from './principal';

const principal = (overrides: Partial<Principal> = {}): Principal => ({
  userId: 'u1',
  email: 'user@example.com',
  name: 'User',
  emailVerified: true,
  platformRole: null,
  ...overrides,
});

function expectDomainError(fn: () => unknown, code: DomainErrorCode): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return;
  }
  expect.unreachable(`expected DomainError with code "${code}"`);
}

describe('authorization checks', () => {
  it('requirePrincipal rejects anonymous callers', () => {
    expectDomainError(() => requirePrincipal(null), 'unauthenticated');
    expect(requirePrincipal(principal())).toBeDefined();
  });

  it('requireVerified rejects unverified accounts', () => {
    expectDomainError(() => requireVerified(principal({ emailVerified: false })), 'forbidden');
  });

  it('missing membership is a 404, wrong role a 403', () => {
    expectDomainError(() => requireTenantPermission(undefined, 'organization.view'), 'not_found');
    const member: Membership = { organizationId: 'o1', role: 'member' };
    expectDomainError(
      () => requireTenantPermission(member, 'organization.manage_members'),
      'forbidden',
    );
    expect(requireTenantPermission(member, 'organization.view')).toBe(member);
  });

  it('owners hold management permissions; members hold read/edit only', () => {
    const owner: Membership = { organizationId: 'o1', role: 'owner' };
    expect(requireTenantPermission(owner, 'organization.manage_members')).toBe(owner);
    expect(requireTenantPermission(owner, 'intake.submit')).toBe(owner);
    const member: Membership = { organizationId: 'o1', role: 'member' };
    expectDomainError(() => requireTenantPermission(member, 'intake.submit'), 'forbidden');
  });

  it('platform permissions are explicit per role — no rank hierarchy', () => {
    const admin = principal({ platformRole: 'admin' });
    const reviewer = principal({ platformRole: 'reviewer' });
    const operator = principal({ platformRole: 'operator' });
    const client = principal();

    expect(requirePlatformPermission(admin, 'platform.manage_staff')).toBe(admin);
    expectDomainError(
      () => requirePlatformPermission(reviewer, 'platform.manage_staff'),
      'not_found',
    );
    expectDomainError(
      () => requirePlatformPermission(operator, 'platform.manage_staff'),
      'not_found',
    );
    // Denials read as 404 to hide the surface entirely from non-staff.
    expectDomainError(
      () => requirePlatformPermission(client, 'platform.view_all_projects'),
      'not_found',
    );
  });
});
