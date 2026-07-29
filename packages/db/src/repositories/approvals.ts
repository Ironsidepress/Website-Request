import { eq, and, desc } from 'drizzle-orm';

import type { Database } from '../client';
import type { TenantContext } from '../tenant';
import { approvals } from '../schema/app';

export type ApprovalRow = typeof approvals.$inferSelect;
export type NewApprovalRow = typeof approvals.$inferInsert;

/**
 * Approvals data access (ADR-0010). Writes are guarded so both writers stay
 * idempotent: the workflow's request step absorbs replays via the one-pending
 * UNIQUE index, and the decision API's update is a single-winner guarded
 * transition out of `pending`.
 */
export function createApprovalsRepository(db: Database) {
  return {
    /**
     * Idempotent request: at most one pending approval per (project, gate).
     * Returns the pending row, whether this call created it or a replay found
     * the existing one.
     */
    async createPendingIfAbsent(ctx: TenantContext, row: NewApprovalRow): Promise<ApprovalRow> {
      if (row.organizationId !== ctx.organizationId) {
        throw new Error('approval row does not belong to the tenant context');
      }
      try {
        await db.insert(approvals).values(row);
      } catch (error) {
        if (!(error instanceof Error && /UNIQUE constraint failed/i.test(error.message))) {
          throw error;
        }
      }
      const pending = await db.query.approvals.findFirst({
        where: and(
          eq(approvals.projectId, row.projectId),
          eq(approvals.organizationId, ctx.organizationId),
          eq(approvals.gate, row.gate),
          eq(approvals.status, 'pending'),
        ),
      });
      if (!pending) throw new Error('pending approval missing after insert');
      return pending;
    },

    /**
     * Replay-stable request: a re-executed gate step reuses the approval for
     * this exact (project, gate, stage attempt, workflow instance) — whatever
     * its status by now — instead of opening a fresh pending row.
     */
    async getOrCreateForAttempt(ctx: TenantContext, row: NewApprovalRow): Promise<ApprovalRow> {
      const existing = await db.query.approvals.findFirst({
        where: and(
          eq(approvals.projectId, row.projectId),
          eq(approvals.organizationId, ctx.organizationId),
          eq(approvals.gate, row.gate),
          eq(approvals.stageAttempt, row.stageAttempt ?? 1),
          eq(approvals.workflowInstanceId, row.workflowInstanceId),
        ),
      });
      if (existing) return existing;
      return this.createPendingIfAbsent(ctx, row);
    },

    async findById(ctx: TenantContext, id: string): Promise<ApprovalRow | undefined> {
      return db.query.approvals.findFirst({
        where: and(eq(approvals.id, id), eq(approvals.organizationId, ctx.organizationId)),
      });
    },

    async listForProject(ctx: TenantContext, projectId: string): Promise<ApprovalRow[]> {
      return db.query.approvals.findMany({
        where: and(
          eq(approvals.projectId, projectId),
          eq(approvals.organizationId, ctx.organizationId),
        ),
        orderBy: [desc(approvals.requestedAt)],
      });
    },

    async listPendingForProject(ctx: TenantContext, projectId: string): Promise<ApprovalRow[]> {
      return db.query.approvals.findMany({
        where: and(
          eq(approvals.projectId, projectId),
          eq(approvals.organizationId, ctx.organizationId),
          eq(approvals.status, 'pending'),
        ),
      });
    },

    /**
     * Single-winner decision: only a pending row transitions, so a duplicate
     * or racing decision loses and the caller reports a conflict.
     */
    async decide(
      ctx: TenantContext,
      id: string,
      fields: {
        status: 'approved' | 'rejected';
        decidedBy: string;
        decisionReason: string | null;
        decidedAt: string;
      },
    ): Promise<boolean> {
      const result = await db
        .update(approvals)
        .set({ ...fields, updatedAt: fields.decidedAt })
        .where(
          and(
            eq(approvals.id, id),
            eq(approvals.organizationId, ctx.organizationId),
            eq(approvals.status, 'pending'),
          ),
        )
        .returning({ id: approvals.id });
      return result.length > 0;
    },

    /** Guarded pending → expired transition (gate timeout). */
    async expire(ctx: TenantContext, id: string, at: string): Promise<boolean> {
      const result = await db
        .update(approvals)
        .set({ status: 'expired', updatedAt: at })
        .where(
          and(
            eq(approvals.id, id),
            eq(approvals.organizationId, ctx.organizationId),
            eq(approvals.status, 'pending'),
          ),
        )
        .returning({ id: approvals.id });
      return result.length > 0;
    },
  };
}

export type ApprovalsRepository = ReturnType<typeof createApprovalsRepository>;
