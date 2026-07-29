import type { Database, IntakeRow } from '@website-factory/db';
import { createIntakesRepository, IntakeConflictError, tenantContext } from '@website-factory/db';
import {
  computeIntakeValidity,
  INTAKE_SCHEMA_VERSION,
  intakeSectionIdSchema,
  saveSectionInputSchema,
  type IntakeSectionId,
  type IntakeValidityMap,
  type SaveSectionInput,
} from '@website-factory/schemas';

import type { AuditService } from '../audit';
import { requireTenantPermission, requireVerified } from '../authz';
import type { Clock } from '../clock';
import { isoNow } from '../clock';
import { DomainError } from '../errors';
import { newId } from '../ids';
import type { Principal } from '../principal';
import type { OrganizationService } from './organizations';

export interface IntakeView {
  id: string;
  status: IntakeRow['status'];
  schemaVersion: number;
  revision: number;
  data: Record<string, unknown>;
  validity: IntakeValidityMap;
}

export class IntakeService {
  private readonly repo;

  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly organizations: OrganizationService,
  ) {
    this.repo = createIntakesRepository(db);
  }

  private async requireEditAccess(principal: Principal, organizationId: string) {
    requireVerified(principal);
    const membership = await this.organizations.membershipFor(principal, organizationId);
    requireTenantPermission(membership, 'intake.edit');
    return tenantContext(organizationId);
  }

  private toView(row: IntakeRow): IntakeView {
    const data = JSON.parse(row.data) as Record<string, unknown>;
    return {
      id: row.id,
      status: row.status,
      schemaVersion: row.schemaVersion,
      revision: row.currentRevision,
      data,
      validity: computeIntakeValidity(data),
    };
  }

  /** Returns the organization's draft, creating it on first access. */
  async getOrCreateDraft(principal: Principal, organizationId: string): Promise<IntakeView> {
    const ctx = await this.requireEditAccess(principal, organizationId);
    const existing = await this.repo.findDraft(ctx);
    if (existing) return this.toView(existing);

    const now = isoNow(this.clock);
    const created = await this.repo.createDraftIfAbsent(ctx, {
      id: newId(),
      organizationId,
      status: 'draft',
      schemaVersion: INTAKE_SCHEMA_VERSION,
      data: '{}',
      currentRevision: 0,
      createdAt: now,
      updatedAt: now,
    });
    await this.audit.record({
      action: 'intake.draft_created',
      resourceType: 'intake',
      resourceId: created.id,
      organizationId,
      actor: { type: 'user', id: principal.userId },
    });
    return this.toView(created);
  }

  /**
   * Autosave one section. Optimistic concurrency: a stale baseRevision is a
   * conflict (HTTP 409) carrying the current server state so multi-tab
   * editing never silently loses data.
   */
  async saveSection(
    principal: Principal,
    organizationId: string,
    sectionId: string,
    input: SaveSectionInput,
  ): Promise<IntakeView> {
    const ctx = await this.requireEditAccess(principal, organizationId);
    const section: IntakeSectionId = intakeSectionIdSchema.parse(sectionId);
    const { baseRevision, data } = saveSectionInputSchema.parse(input);

    const draft = await this.repo.findDraft(ctx);
    if (!draft) throw new DomainError('not_found', 'No intake draft exists yet');

    const document = JSON.parse(draft.data) as Record<string, unknown>;
    document[section] = data;
    const now = isoNow(this.clock);

    try {
      await this.repo.saveSectionRevision(ctx, {
        intakeId: draft.id,
        baseRevision,
        newData: JSON.stringify(document),
        updatedAt: now,
        revisionRow: {
          id: newId(),
          intakeId: draft.id,
          organizationId,
          revision: baseRevision + 1,
          sectionId: section,
          sectionData: JSON.stringify(data),
          actorUserId: principal.userId,
          createdAt: now,
        },
      });
    } catch (error) {
      if (error instanceof IntakeConflictError) {
        throw new DomainError(
          'conflict',
          'This questionnaire was updated elsewhere — refresh to continue',
        );
      }
      throw error;
    }

    // One audit row per accepted revision (autosaves are already coalesced by
    // the client's debounce; every accepted write is attributable).
    await this.audit.record({
      action: 'intake.section_saved',
      resourceType: 'intake',
      resourceId: draft.id,
      organizationId,
      actor: { type: 'user', id: principal.userId },
      metadata: { section, revision: baseRevision + 1 },
    });

    const updated = await this.repo.findById(ctx, draft.id);
    if (!updated) throw new DomainError('not_found', 'Intake disappeared during save');
    return this.toView(updated);
  }

  async listRevisions(principal: Principal, organizationId: string) {
    const ctx = await this.requireEditAccess(principal, organizationId);
    const draft = await this.repo.findDraft(ctx);
    if (!draft) return [];
    const rows = await this.repo.listRevisions(ctx, draft.id);
    return rows.map((row) => ({
      revision: row.revision,
      sectionId: row.sectionId,
      actorUserId: row.actorUserId,
      createdAt: row.createdAt,
    }));
  }
}
