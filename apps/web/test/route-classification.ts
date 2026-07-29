/**
 * Tenant-isolation registry (docs/testing-strategy.md, docs/security-model.md).
 *
 * EVERY API route must be classified here; the route-registry test diffs this
 * map against the filesystem and fails CI on any unregistered route. Adding a
 * tenant-scoped route obliges you to cover it in the isolation suites
 * (service-level isolation lives in packages/core/test/organizations.spec.ts;
 * HTTP-level coverage grows with the intake API in M2).
 */
export type RouteClassification =
  /** Auth endpoints owned by the AuthService adapter (rate-limited, no tenant data). */
  | 'auth'
  /** Operates only on the authenticated principal's own data. */
  | 'principal-scoped'
  /** Touches tenant-owned tables — MUST resolve TenantContext via membership. */
  | 'tenant-scoped'
  /** Staff-only platform surface — requires a platform permission. */
  | 'staff'
  /** Development-only tooling; must hard-404 outside APP_ENV=development. */
  | 'dev-only';

export const ROUTE_CLASSIFICATIONS: Record<string, RouteClassification> = {
  '/api/auth/[...all]': 'auth',
  '/api/me': 'principal-scoped',
  '/api/organizations': 'principal-scoped',
  '/api/organizations/[id]/members': 'tenant-scoped',
  '/api/organizations/[id]/invitations': 'tenant-scoped',
  '/api/organizations/[id]/intake': 'tenant-scoped',
  '/api/organizations/[id]/intake/sections/[sectionId]': 'tenant-scoped',
  '/api/organizations/[id]/intake/revisions': 'tenant-scoped',
  '/api/organizations/[id]/files': 'tenant-scoped',
  '/api/organizations/[id]/files/[fileId]': 'tenant-scoped',
  '/api/organizations/[id]/files/[fileId]/content': 'tenant-scoped',
  '/api/organizations/[id]/intake/submit': 'tenant-scoped',
  '/api/organizations/[id]/projects': 'tenant-scoped',
  '/api/organizations/[id]/projects/[projectId]/timeline': 'tenant-scoped',
  '/api/organizations/[id]/projects/[projectId]/approvals': 'tenant-scoped',
  '/api/organizations/[id]/approvals/[approvalId]/decision': 'tenant-scoped',
  '/api/invitations/accept': 'principal-scoped',
  '/api/staff/invitations': 'staff',
  '/api/dev/emails': 'dev-only',
};
