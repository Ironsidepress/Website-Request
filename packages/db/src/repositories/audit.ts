import { eq, desc } from 'drizzle-orm';

import type { Database } from '../client';
import type { TenantContext } from '../tenant';
import { auditLogs } from '../schema/app';

export type AuditLogRow = typeof auditLogs.$inferSelect;
export type NewAuditLogRow = typeof auditLogs.$inferInsert;

/**
 * Append-only by construction: this repository exposes insert and select only.
 * There is deliberately no update or delete method — do not add one.
 */
export function createAuditRepository(db: Database) {
  return {
    async append(row: NewAuditLogRow): Promise<void> {
      await db.insert(auditLogs).values(row);
    },

    /** Insert rows atomically alongside other statements via db.batch upstream. */
    insertStatement(row: NewAuditLogRow) {
      return db.insert(auditLogs).values(row);
    },

    async listForOrganization(ctx: TenantContext, limit = 100): Promise<AuditLogRow[]> {
      return db.query.auditLogs.findMany({
        where: eq(auditLogs.organizationId, ctx.organizationId),
        orderBy: [desc(auditLogs.createdAt)],
        limit,
      });
    },

    /** Cross-tenant read — staff only; callers must audit the access itself. */
    async listAll(limit = 100): Promise<AuditLogRow[]> {
      return db.query.auditLogs.findMany({ orderBy: [desc(auditLogs.createdAt)], limit });
    },
  };
}

export type AuditRepository = ReturnType<typeof createAuditRepository>;
