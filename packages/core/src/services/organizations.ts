import type { Database, OrganizationRole, OrganizationRow } from '@website-factory/db';
import { createOrganizationsRepository, tenantContext } from '@website-factory/db';
import {
  createOrganizationInputSchema,
  type CreateOrganizationInput,
} from '@website-factory/schemas';

import type { AuditService } from '../audit';
import type { Clock } from '../clock';
import { isoNow } from '../clock';
import { newId } from '../ids';
import type { Membership, Principal } from '../principal';
import { requireTenantPermission, requireVerified } from '../authz';
import { notFound } from '../errors';

export class OrganizationService {
  private readonly repo;

  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {
    this.repo = createOrganizationsRepository(db);
  }

  /**
   * Resolves the caller's membership in an organization. This is the ONLY way
   * request handling obtains a TenantContext — never from client input alone.
   */
  async membershipFor(
    principal: Principal,
    organizationId: string,
  ): Promise<Membership | undefined> {
    const row = await this.repo.findMembership(organizationId, principal.userId);
    return row ? { organizationId: row.organizationId, role: row.role } : undefined;
  }

  async create(principal: Principal, input: CreateOrganizationInput): Promise<OrganizationRow> {
    requireVerified(principal);
    const data = createOrganizationInputSchema.parse(input);
    const now = isoNow(this.clock);
    const org = {
      id: newId(),
      name: data.name,
      contactEmail: data.contactEmail,
      phone: data.phone ?? null,
      status: 'active' as const,
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.createWithOwner(org, principal.userId, now);
    await this.audit.record({
      action: 'organization.created',
      resourceType: 'organization',
      resourceId: org.id,
      organizationId: org.id,
      actor: { type: 'user', id: principal.userId },
      metadata: { name: org.name },
    });
    return org;
  }

  async listForPrincipal(
    principal: Principal,
  ): Promise<Array<{ organization: OrganizationRow; role: OrganizationRole }>> {
    return this.repo.listForUser(principal.userId);
  }

  async getForPrincipal(principal: Principal, organizationId: string): Promise<OrganizationRow> {
    const membership = await this.membershipFor(principal, organizationId);
    requireTenantPermission(membership, 'organization.view');
    const org = await this.repo.findById(tenantContext(organizationId));
    if (!org) {
      // Membership existed but the org row is gone — treat identically to no access.
      throw notFound('organization');
    }
    return org;
  }

  async listMembers(principal: Principal, organizationId: string) {
    const membership = await this.membershipFor(principal, organizationId);
    requireTenantPermission(membership, 'organization.view');
    return this.repo.listMembers(tenantContext(organizationId));
  }
}
