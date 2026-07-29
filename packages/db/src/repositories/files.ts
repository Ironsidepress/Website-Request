import { eq, and, lt, sum, inArray } from 'drizzle-orm';

import type { Database } from '../client';
import type { TenantContext } from '../tenant';
import { files } from '../schema/app';

export type FileRow = typeof files.$inferSelect;
export type NewFileRow = typeof files.$inferInsert;

export function createFilesRepository(db: Database) {
  return {
    async createPending(ctx: TenantContext, row: NewFileRow): Promise<void> {
      if (row.organizationId !== ctx.organizationId) {
        throw new Error('file row does not belong to the tenant context');
      }
      await db.insert(files).values(row);
    },

    async findById(ctx: TenantContext, id: string): Promise<FileRow | undefined> {
      return db.query.files.findFirst({
        where: and(eq(files.id, id), eq(files.organizationId, ctx.organizationId)),
      });
    },

    async findByIds(ctx: TenantContext, ids: string[]): Promise<FileRow[]> {
      if (ids.length === 0) return [];
      return db.query.files.findMany({
        where: and(inArray(files.id, ids), eq(files.organizationId, ctx.organizationId)),
      });
    },

    /** Guarded transition pending → stored; returns false when not applicable. */
    async markStored(
      ctx: TenantContext,
      id: string,
      details: { checksumSha256: string; sizeBytes: number; updatedAt: string },
    ): Promise<boolean> {
      const result = await db
        .update(files)
        .set({ status: 'stored', ...details })
        .where(
          and(
            eq(files.id, id),
            eq(files.organizationId, ctx.organizationId),
            eq(files.status, 'pending'),
          ),
        )
        .returning({ id: files.id });
      return result.length > 0;
    },

    async markDeleted(id: string, updatedAt: string): Promise<void> {
      await db.update(files).set({ status: 'deleted', updatedAt }).where(eq(files.id, id));
    },

    async listForOrganization(ctx: TenantContext): Promise<FileRow[]> {
      return db.query.files.findMany({
        where: and(eq(files.organizationId, ctx.organizationId), eq(files.status, 'stored')),
      });
    },

    /** Total stored bytes for quota checks. */
    async storedBytes(ctx: TenantContext): Promise<number> {
      const rows = await db
        .select({ total: sum(files.sizeBytes) })
        .from(files)
        .where(and(eq(files.organizationId, ctx.organizationId), eq(files.status, 'stored')));
      return Number(rows[0]?.total ?? 0);
    },

    /** Cross-tenant by design: the system cleanup job sweeps abandoned slots. */
    async listPendingOlderThan(cutoffIso: string, limit = 100): Promise<FileRow[]> {
      return db.query.files.findMany({
        where: and(eq(files.status, 'pending'), lt(files.createdAt, cutoffIso)),
        limit,
      });
    },
  };
}

export type FilesRepository = ReturnType<typeof createFilesRepository>;
