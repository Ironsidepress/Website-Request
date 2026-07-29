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
  | 'staff';

export const ROUTE_CLASSIFICATIONS: Record<string, RouteClassification> = {
  '/api/auth/[...all]': 'auth',
  '/api/me': 'principal-scoped',
  '/api/organizations': 'principal-scoped',
  '/api/organizations/[id]/members': 'tenant-scoped',
  '/api/organizations/[id]/invitations': 'tenant-scoped',
  '/api/invitations/accept': 'principal-scoped',
  '/api/staff/invitations': 'staff',
};
