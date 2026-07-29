import { eq, and, asc } from 'drizzle-orm';

import type { Database } from '../client';
import type { TenantContext } from '../tenant';
import { projects, projectStageHistory, workflowEvents } from '../schema/app';

export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;
export type StageHistoryRow = typeof projectStageHistory.$inferSelect;
export type NewStageHistoryRow = typeof projectStageHistory.$inferInsert;
export type NewWorkflowEventRow = typeof workflowEvents.$inferInsert;

export function createProjectsRepository(db: Database) {
  return {
    /**
     * Atomic project creation: project row + initial stage-history row in one
     * D1 batch. UNIQUE(intake_id) rejects a second project for the same
     * intake, keeping submission idempotent under retries and double-clicks.
     */
    async createWithInitialStage(
      ctx: TenantContext,
      project: NewProjectRow,
      initialHistory: NewStageHistoryRow,
    ): Promise<boolean> {
      if (
        project.organizationId !== ctx.organizationId ||
        initialHistory.organizationId !== ctx.organizationId
      ) {
        throw new Error('project rows do not belong to the tenant context');
      }
      try {
        await db.batch([
          db.insert(projects).values(project),
          db.insert(projectStageHistory).values(initialHistory),
        ]);
        return true;
      } catch (error) {
        if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
          return false;
        }
        throw error;
      }
    },

    async findById(ctx: TenantContext, id: string): Promise<ProjectRow | undefined> {
      return db.query.projects.findFirst({
        where: and(eq(projects.id, id), eq(projects.organizationId, ctx.organizationId)),
      });
    },

    async findByIntakeId(ctx: TenantContext, intakeId: string): Promise<ProjectRow | undefined> {
      return db.query.projects.findFirst({
        where: and(
          eq(projects.intakeId, intakeId),
          eq(projects.organizationId, ctx.organizationId),
        ),
      });
    },

    async listForOrganization(ctx: TenantContext): Promise<ProjectRow[]> {
      return db.query.projects.findMany({
        where: eq(projects.organizationId, ctx.organizationId),
      });
    },

    async appendHistory(ctx: TenantContext, row: NewStageHistoryRow): Promise<void> {
      if (row.organizationId !== ctx.organizationId) {
        throw new Error('history row does not belong to the tenant context');
      }
      await db.insert(projectStageHistory).values(row);
    },

    /** Client-safe rows only; internal events never leave the service layer. */
    async listClientVisibleHistory(
      ctx: TenantContext,
      projectId: string,
    ): Promise<StageHistoryRow[]> {
      return db.query.projectStageHistory.findMany({
        where: and(
          eq(projectStageHistory.projectId, projectId),
          eq(projectStageHistory.organizationId, ctx.organizationId),
          eq(projectStageHistory.clientVisible, true),
        ),
        orderBy: [asc(projectStageHistory.createdAt)],
      });
    },

    async listAllHistory(ctx: TenantContext, projectId: string): Promise<StageHistoryRow[]> {
      return db.query.projectStageHistory.findMany({
        where: and(
          eq(projectStageHistory.projectId, projectId),
          eq(projectStageHistory.organizationId, ctx.organizationId),
        ),
        orderBy: [asc(projectStageHistory.createdAt)],
      });
    },

    /** Idempotent event append: replays are absorbed by the UNIQUE key. */
    async appendEventIfAbsent(ctx: TenantContext, row: NewWorkflowEventRow): Promise<void> {
      if (row.organizationId !== ctx.organizationId) {
        throw new Error('event row does not belong to the tenant context');
      }
      await db
        .insert(workflowEvents)
        .values(row)
        .onConflictDoNothing({ target: workflowEvents.idempotencyKey });
    },
  };
}

export type ProjectsRepository = ReturnType<typeof createProjectsRepository>;
