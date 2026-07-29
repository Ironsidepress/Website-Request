import type { Database } from '@website-factory/db';
import { createAuditRepository, type NewAuditLogRow } from '@website-factory/db';
import { auditEventSchema, type AuditEvent } from '@website-factory/schemas';

import type { Clock } from './clock';
import { isoNow } from './clock';
import { newId } from './ids';

/**
 * Append-only audit trail (docs/security-model.md). Every event is validated
 * against auditEventSchema, which structurally rejects credential-like
 * metadata keys — secrets cannot enter the audit log.
 */
export class AuditService {
  private readonly repo;

  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
  ) {
    this.repo = createAuditRepository(db);
  }

  private toRow(event: AuditEvent): NewAuditLogRow {
    const validated = auditEventSchema.parse(event);
    return {
      id: newId(),
      organizationId: validated.organizationId,
      actorType: validated.actor.type,
      actorId: validated.actor.id,
      action: validated.action,
      resourceType: validated.resourceType,
      resourceId: validated.resourceId,
      ipAddress: validated.ipAddress ?? null,
      metadata: validated.metadata ? JSON.stringify(validated.metadata) : null,
      createdAt: isoNow(this.clock),
    };
  }

  async record(event: AuditEvent): Promise<void> {
    await this.repo.append(this.toRow(event));
  }

  /** For inclusion in a db.batch alongside the mutation being audited. */
  statement(event: AuditEvent) {
    return this.repo.insertStatement(this.toRow(event));
  }

  listForOrganization(ctx: { organizationId: string }, limit?: number) {
    return this.repo.listForOrganization(ctx, limit);
  }

  listAll(limit?: number) {
    return this.repo.listAll(limit);
  }
}
