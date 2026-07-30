import { eq, and, asc } from 'drizzle-orm';

import type { Database } from '../client';
import type { TenantContext } from '../tenant';
import { projects, projectStageHistory, workflowEvents, workflowRuns } from '../schema/app';

export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;
export type StageHistoryRow = typeof projectStageHistory.$inferSelect;
export type NewStageHistoryRow = typeof projectStageHistory.$inferInsert;
export type WorkflowEventRow = typeof workflowEvents.$inferSelect;
export type NewWorkflowEventRow = typeof workflowEvents.$inferInsert;
export type WorkflowRunRow = typeof workflowRuns.$inferSelect;
export type NewWorkflowRunRow = typeof workflowRuns.$inferInsert;

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

    /** Records the project's own code repository (ADR-0018); idempotent. */
    async setRepo(
      ctx: TenantContext,
      projectId: string,
      repo: { fullName: string; url: string },
      updatedAt: string,
    ): Promise<void> {
      await db
        .update(projects)
        .set({ repoFullName: repo.fullName, repoUrl: repo.url, updatedAt })
        .where(and(eq(projects.id, projectId), eq(projects.organizationId, ctx.organizationId)));
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

    /**
     * Atomic event + stage-history append. The event's UNIQUE idempotency key
     * guards the whole batch: a replayed step conflicts on the event insert,
     * the batch rolls back, and no duplicate history row is written.
     * Returns true when this call performed the append.
     */
    async appendEventWithHistory(
      ctx: TenantContext,
      event: NewWorkflowEventRow,
      history: NewStageHistoryRow,
    ): Promise<boolean> {
      if (
        event.organizationId !== ctx.organizationId ||
        history.organizationId !== ctx.organizationId
      ) {
        throw new Error('event rows do not belong to the tenant context');
      }
      try {
        await db.batch([
          db.insert(workflowEvents).values(event),
          db.insert(projectStageHistory).values(history),
        ]);
        return true;
      } catch (error) {
        if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
          return false;
        }
        throw error;
      }
    },

    async listEvents(ctx: TenantContext, projectId: string): Promise<WorkflowEventRow[]> {
      return db.query.workflowEvents.findMany({
        where: and(
          eq(workflowEvents.projectId, projectId),
          eq(workflowEvents.organizationId, ctx.organizationId),
        ),
        orderBy: [asc(workflowEvents.createdAt)],
      });
    },

    /** Idempotent run record: the UNIQUE cf_instance_id absorbs retries. */
    async recordWorkflowRunIfAbsent(ctx: TenantContext, row: NewWorkflowRunRow): Promise<void> {
      if (row.organizationId !== ctx.organizationId) {
        throw new Error('workflow run row does not belong to the tenant context');
      }
      await db.insert(workflowRuns).values(row).onConflictDoNothing({
        target: workflowRuns.cfInstanceId,
      });
    },

    async listWorkflowRuns(ctx: TenantContext, projectId: string): Promise<WorkflowRunRow[]> {
      return db.query.workflowRuns.findMany({
        where: and(
          eq(workflowRuns.projectId, projectId),
          eq(workflowRuns.organizationId, ctx.organizationId),
        ),
        orderBy: [asc(workflowRuns.createdAt)],
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
