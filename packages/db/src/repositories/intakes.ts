import { eq, and, asc } from 'drizzle-orm';

import type { Database } from '../client';
import type { TenantContext } from '../tenant';
import { intakes, intakeRevisions } from '../schema/app';

export type IntakeRow = typeof intakes.$inferSelect;
export type NewIntakeRow = typeof intakes.$inferInsert;
export type IntakeRevisionRow = typeof intakeRevisions.$inferSelect;
export type NewIntakeRevisionRow = typeof intakeRevisions.$inferInsert;

export class IntakeConflictError extends Error {
  constructor() {
    super('intake revision conflict');
    this.name = 'IntakeConflictError';
  }
}

export function createIntakesRepository(db: Database) {
  return {
    /** Idempotent under the one-draft-per-org unique index. */
    async createDraftIfAbsent(ctx: TenantContext, row: NewIntakeRow): Promise<IntakeRow> {
      if (row.organizationId !== ctx.organizationId) {
        throw new Error('intake row does not belong to the tenant context');
      }
      await db.insert(intakes).values(row).onConflictDoNothing();
      const draft = await this.findDraft(ctx);
      if (!draft) throw new Error('intakes.createDraftIfAbsent: draft missing after insert');
      return draft;
    },

    async findDraft(ctx: TenantContext): Promise<IntakeRow | undefined> {
      return db.query.intakes.findFirst({
        where: and(eq(intakes.organizationId, ctx.organizationId), eq(intakes.status, 'draft')),
      });
    },

    async findById(ctx: TenantContext, id: string): Promise<IntakeRow | undefined> {
      return db.query.intakes.findFirst({
        where: and(eq(intakes.id, id), eq(intakes.organizationId, ctx.organizationId)),
      });
    },

    /**
     * Atomic autosave: the revision INSERT and the draft UPDATE run in one D1
     * batch (implicit transaction). UNIQUE(intake_id, revision) is the
     * optimistic-concurrency guard — a stale baseRevision collides with an
     * existing revision row, the whole batch rolls back, and the caller
     * receives IntakeConflictError (HTTP 409 upstream).
     */
    async saveSectionRevision(
      ctx: TenantContext,
      args: {
        intakeId: string;
        baseRevision: number;
        newData: string;
        revisionRow: NewIntakeRevisionRow;
        updatedAt: string;
      },
    ): Promise<void> {
      if (
        args.revisionRow.organizationId !== ctx.organizationId ||
        args.revisionRow.revision !== args.baseRevision + 1
      ) {
        throw new Error('invalid revision row for autosave');
      }
      // Fast-path check: a baseRevision that is not the current revision is
      // stale (or ahead — a client bug) and must never write anything. True
      // races that slip past this read are caught by UNIQUE(intake_id,
      // revision) inside the atomic batch below.
      const current = await this.findById(ctx, args.intakeId);
      if (!current || current.status !== 'draft') throw new IntakeConflictError();
      if (current.currentRevision !== args.baseRevision) throw new IntakeConflictError();
      try {
        await db.batch([
          db.insert(intakeRevisions).values(args.revisionRow),
          db
            .update(intakes)
            .set({
              data: args.newData,
              currentRevision: args.baseRevision + 1,
              updatedAt: args.updatedAt,
            })
            .where(
              and(
                eq(intakes.id, args.intakeId),
                eq(intakes.organizationId, ctx.organizationId),
                eq(intakes.status, 'draft'),
                eq(intakes.currentRevision, args.baseRevision),
              ),
            ),
        ]);
      } catch (error) {
        if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
          throw new IntakeConflictError();
        }
        throw error;
      }
    },

    /**
     * Guarded freeze: transitions draft → submitted exactly once. Returns
     * false when the intake is no longer a draft (double submission).
     */
    async markSubmitted(
      ctx: TenantContext,
      intakeId: string,
      submittedBy: string,
      submittedAt: string,
    ): Promise<boolean> {
      const result = await db
        .update(intakes)
        .set({ status: 'submitted', submittedBy, submittedAt, updatedAt: submittedAt })
        .where(
          and(
            eq(intakes.id, intakeId),
            eq(intakes.organizationId, ctx.organizationId),
            eq(intakes.status, 'draft'),
          ),
        )
        .returning({ id: intakes.id });
      return result.length > 0;
    },

    async listRevisions(ctx: TenantContext, intakeId: string): Promise<IntakeRevisionRow[]> {
      return db.query.intakeRevisions.findMany({
        where: and(
          eq(intakeRevisions.intakeId, intakeId),
          eq(intakeRevisions.organizationId, ctx.organizationId),
        ),
        orderBy: [asc(intakeRevisions.revision)],
      });
    },
  };
}

export type IntakesRepository = ReturnType<typeof createIntakesRepository>;
