/**
 * @website-factory/db — Drizzle schema, migrations and tenant-scoped repositories.
 *
 * Rules (docs/security-model.md):
 * - This package is the only code allowed to touch D1.
 * - Tenant-owned tables are only reachable through repository methods that
 *   require a TenantContext.
 * - Better Auth tables (schema/auth.ts) are owned by the auth library and are
 *   exported solely so the auth adapter in @website-factory/core can hand them
 *   to Better Auth — application code must never query them.
 */
export { createDb, type Database } from './client';
export { tenantContext, type TenantContext } from './tenant';
export * as schema from './schema';
export {
  PLATFORM_ROLES,
  ORGANIZATION_ROLES,
  INVITATION_KINDS,
  INVITATION_STATUSES,
  ACTOR_TYPES,
  type PlatformRole,
  type OrganizationRole,
  type InvitationKind,
  type InvitationStatus,
  type ActorType,
} from './schema/app';
export {
  createUsersRepository,
  type UsersRepository,
  type UserRow,
  type NewUserRow,
} from './repositories/users';
export {
  createOrganizationsRepository,
  type OrganizationsRepository,
  type OrganizationRow,
  type NewOrganizationRow,
  type MembershipRow,
} from './repositories/organizations';
export {
  createInvitationsRepository,
  type InvitationsRepository,
  type InvitationRow,
  type NewInvitationRow,
} from './repositories/invitations';
export {
  createAuditRepository,
  type AuditRepository,
  type AuditLogRow,
  type NewAuditLogRow,
} from './repositories/audit';
