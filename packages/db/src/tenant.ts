/**
 * Tenant scoping (docs/security-model.md).
 *
 * Every repository method that touches a tenant-owned table requires a
 * TenantContext in its signature; the repository injects `organization_id`
 * into the query. Handlers and UI never build tenant filters themselves, and
 * a TenantContext may only be constructed from an authenticated membership —
 * use @website-factory/core's authorization services, never a client-supplied
 * organization id.
 */
export interface TenantContext {
  readonly organizationId: string;
}

export function tenantContext(organizationId: string): TenantContext {
  if (!organizationId) {
    throw new Error('TenantContext requires a non-empty organizationId');
  }
  return Object.freeze({ organizationId });
}
