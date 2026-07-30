import { eq, and, desc } from 'drizzle-orm';

import type { Database } from '../client';
import type { TenantContext } from '../tenant';
import { artifacts, agentRuns, projects } from '../schema/app';

export type ArtifactRow = typeof artifacts.$inferSelect;
export type NewArtifactRow = typeof artifacts.$inferInsert;
export type AgentRunRow = typeof agentRuns.$inferSelect;
export type NewAgentRunRow = typeof agentRuns.$inferInsert;

/** Data access for pipeline execution: artifacts, agent runs, projections. */
export function createPipelineRepository(db: Database) {
  return {
    /** Immutable per version; a duplicate (id, version) insert is absorbed. */
    async createArtifactVersionIfAbsent(ctx: TenantContext, row: NewArtifactRow): Promise<void> {
      if (row.organizationId !== ctx.organizationId) {
        throw new Error('artifact row does not belong to the tenant context');
      }
      await db.insert(artifacts).values(row).onConflictDoNothing();
    },

    async getArtifact(
      ctx: TenantContext,
      artifactId: string,
      version: number,
    ): Promise<ArtifactRow | undefined> {
      return db.query.artifacts.findFirst({
        where: and(
          eq(artifacts.artifactId, artifactId),
          eq(artifacts.version, version),
          eq(artifacts.organizationId, ctx.organizationId),
        ),
      });
    },

    async latestArtifact(
      ctx: TenantContext,
      projectId: string,
      type: string,
    ): Promise<ArtifactRow | undefined> {
      const rows = await db.query.artifacts.findMany({
        where: and(
          eq(artifacts.projectId, projectId),
          eq(artifacts.organizationId, ctx.organizationId),
          eq(artifacts.type, type),
        ),
        orderBy: [desc(artifacts.version)],
        limit: 1,
      });
      return rows[0];
    },

    async listArtifacts(ctx: TenantContext, projectId: string): Promise<ArtifactRow[]> {
      return db.query.artifacts.findMany({
        where: and(
          eq(artifacts.projectId, projectId),
          eq(artifacts.organizationId, ctx.organizationId),
        ),
      });
    },

    /** Idempotent create: a replayed step reuses the existing run row. */
    async createAgentRunIfAbsent(ctx: TenantContext, row: NewAgentRunRow): Promise<AgentRunRow> {
      if (row.organizationId !== ctx.organizationId) {
        throw new Error('agent run row does not belong to the tenant context');
      }
      await db
        .insert(agentRuns)
        .values(row)
        .onConflictDoNothing({ target: agentRuns.idempotencyKey });
      const created = await db.query.agentRuns.findFirst({
        where: eq(agentRuns.idempotencyKey, row.idempotencyKey),
      });
      if (!created) throw new Error('agent run missing after insert');
      return created;
    },

    async completeAgentRun(
      ctx: TenantContext,
      id: string,
      fields: Partial<
        Pick<
          NewAgentRunRow,
          | 'status'
          | 'model'
          | 'promptVersion'
          | 'completedAt'
          | 'outputArtifacts'
          | 'inputTokens'
          | 'outputTokens'
          | 'estimatedCostUsd'
          | 'errorDetail'
          | 'retryCount'
        >
      >,
    ): Promise<void> {
      await db
        .update(agentRuns)
        .set(fields)
        .where(and(eq(agentRuns.id, id), eq(agentRuns.organizationId, ctx.organizationId)));
    },

    async listAgentRuns(ctx: TenantContext, projectId: string): Promise<AgentRunRow[]> {
      return db.query.agentRuns.findMany({
        where: and(
          eq(agentRuns.projectId, projectId),
          eq(agentRuns.organizationId, ctx.organizationId),
        ),
      });
    },

    /** Gate outcomes project onto the reviewed artifact version. */
    async setArtifactStatus(
      ctx: TenantContext,
      artifactId: string,
      version: number,
      status: 'approved' | 'rejected' | 'superseded',
    ): Promise<void> {
      await db
        .update(artifacts)
        .set({ status })
        .where(
          and(
            eq(artifacts.artifactId, artifactId),
            eq(artifacts.version, version),
            eq(artifacts.organizationId, ctx.organizationId),
          ),
        );
    },

    /**
     * Guarded stage projection update (docs/workflow-state-machine.md): a
     * retried step converges instead of double-transitioning.
     */
    async projectStage(
      ctx: TenantContext,
      projectId: string,
      expectedFrom: string,
      to: string,
      updatedAt: string,
    ): Promise<void> {
      await db
        .update(projects)
        .set({ currentStage: to, updatedAt })
        .where(
          and(
            eq(projects.id, projectId),
            eq(projects.organizationId, ctx.organizationId),
            eq(projects.currentStage, expectedFrom),
          ),
        );
    },

    /** Gate expiry and rejected launches park the project (docs/workflow-state-machine.md). */
    async setProjectStatus(
      ctx: TenantContext,
      projectId: string,
      status: 'active' | 'on_hold' | 'cancelled' | 'completed',
      updatedAt: string,
    ): Promise<void> {
      await db
        .update(projects)
        .set({ status, updatedAt })
        .where(and(eq(projects.id, projectId), eq(projects.organizationId, ctx.organizationId)));
    },

    async setProjectHealth(
      ctx: TenantContext,
      projectId: string,
      health: 'ok' | 'needs_attention',
      updatedAt: string,
    ): Promise<void> {
      await db
        .update(projects)
        .set({ health, updatedAt })
        .where(and(eq(projects.id, projectId), eq(projects.organizationId, ctx.organizationId)));
    },

    /** Reaching `live` also clears any lingering needs_attention flag. */
    async markProjectCompleted(ctx: TenantContext, projectId: string, updatedAt: string) {
      await db
        .update(projects)
        .set({ status: 'completed', health: 'ok', updatedAt })
        .where(and(eq(projects.id, projectId), eq(projects.organizationId, ctx.organizationId)));
    },
  };
}

export type PipelineRepository = ReturnType<typeof createPipelineRepository>;
