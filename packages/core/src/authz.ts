import type { OrganizationRole } from '@website-factory/db';

import { forbidden, notFound, unauthenticated } from './errors';
import type { Membership, Principal } from './principal';

/**
 * Permission checks (docs/user-roles.md). Handlers check permissions, never
 * role names. Staff roles are platform-scoped; tenant roles come from
 * memberships. Checks are explicit per action — no rank hierarchy is assumed.
 */

export type TenantPermission =
  | 'organization.view'
  | 'organization.manage_members'
  | 'intake.edit'
  | 'intake.submit'
  | 'files.upload';

const TENANT_PERMISSIONS: Record<OrganizationRole, ReadonlySet<TenantPermission>> = {
  owner: new Set([
    'organization.view',
    'organization.manage_members',
    'intake.edit',
    'intake.submit',
    'files.upload',
  ]),
  member: new Set(['organization.view', 'intake.edit', 'files.upload']),
};

export type PlatformPermission =
  | 'platform.view_all_projects'
  | 'platform.manage_staff'
  | 'platform.view_audit_logs'
  | 'platform.manage_projects'
  | 'platform.retry_workflow';

const PLATFORM_PERMISSIONS: Record<string, ReadonlySet<PlatformPermission>> = {
  admin: new Set([
    'platform.view_all_projects',
    'platform.manage_staff',
    'platform.view_audit_logs',
    'platform.manage_projects',
    'platform.retry_workflow',
  ]),
  reviewer: new Set(['platform.view_all_projects']),
  operator: new Set([
    'platform.view_all_projects',
    'platform.view_audit_logs',
    'platform.retry_workflow',
  ]),
};

export function requirePrincipal(principal: Principal | null): Principal {
  if (!principal) throw unauthenticated();
  return principal;
}

export function requireVerified(principal: Principal): Principal {
  if (!principal.emailVerified) {
    throw forbidden('Please verify your email address first');
  }
  return principal;
}

/** Membership failures are 404s to avoid leaking other tenants' existence. */
export function requireTenantPermission(
  membership: Membership | undefined,
  permission: TenantPermission,
): Membership {
  if (!membership) throw notFound('organization');
  if (!TENANT_PERMISSIONS[membership.role].has(permission)) {
    throw forbidden();
  }
  return membership;
}

export function requirePlatformPermission(
  principal: Principal,
  permission: PlatformPermission,
): Principal {
  const granted = principal.platformRole ? PLATFORM_PERMISSIONS[principal.platformRole] : undefined;
  if (!granted?.has(permission)) throw notFound('resource');
  return principal;
}
