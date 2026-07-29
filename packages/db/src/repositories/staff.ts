import { eq, and, desc, inArray } from 'drizzle-orm';

import type { Database } from '../client';
import { approvals, organizations, projects } from '../schema/app';
import type { ApprovalRow } from './approvals';
import type { ProjectRow } from './projects';

export interface StaffProjectListRow {
  project: ProjectRow;
  organizationName: string;
  pendingApprovals: number;
}

/**
 * Staff-only cross-tenant data access (docs/user-roles.md). This is the ONE
 * deliberate exception to the TenantContext rule: platform staff see across
 * organizations by design. It must only ever be reached through StaffService,
 * which checks platform permissions and audit-logs every cross-tenant read.
 */
export function createStaffRepository(db: Database) {
  return {
    async listProjects(filters: {
      status?: string;
      health?: string;
    }): Promise<StaffProjectListRow[]> {
      const conditions = [];
      if (filters.status) {
        conditions.push(
          eq(projects.status, filters.status as (typeof projects.status.enumValues)[number]),
        );
      }
      if (filters.health) {
        conditions.push(
          eq(projects.health, filters.health as (typeof projects.health.enumValues)[number]),
        );
      }
      const rows = await db
        .select({ project: projects, organizationName: organizations.name })
        .from(projects)
        .innerJoin(organizations, eq(projects.organizationId, organizations.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(projects.createdAt));

      const ids = rows.map((row) => row.project.id);
      const pending =
        ids.length > 0
          ? await db.query.approvals.findMany({
              where: and(eq(approvals.status, 'pending'), inArray(approvals.projectId, ids)),
            })
          : [];
      const pendingByProject = new Map<string, number>();
      for (const approval of pending) {
        pendingByProject.set(
          approval.projectId,
          (pendingByProject.get(approval.projectId) ?? 0) + 1,
        );
      }
      return rows.map((row) => ({
        ...row,
        pendingApprovals: pendingByProject.get(row.project.id) ?? 0,
      }));
    },

    /** Cross-tenant lookup; returns the org id so detail reads can scope. */
    async findProjectById(projectId: string): Promise<ProjectRow | undefined> {
      return db.query.projects.findFirst({ where: eq(projects.id, projectId) });
    },

    async findProjectWithOrg(
      projectId: string,
    ): Promise<{ project: ProjectRow; organizationName: string } | undefined> {
      const rows = await db
        .select({ project: projects, organizationName: organizations.name })
        .from(projects)
        .innerJoin(organizations, eq(projects.organizationId, organizations.id))
        .where(eq(projects.id, projectId))
        .limit(1);
      return rows[0];
    },

    async listPendingApprovals(): Promise<
      Array<{ approval: ApprovalRow; organizationName: string; projectName: string }>
    > {
      const rows = await db
        .select({
          approval: approvals,
          organizationName: organizations.name,
          projectName: projects.name,
        })
        .from(approvals)
        .innerJoin(projects, eq(approvals.projectId, projects.id))
        .innerJoin(organizations, eq(approvals.organizationId, organizations.id))
        .where(eq(approvals.status, 'pending'))
        .orderBy(desc(approvals.requestedAt));
      return rows;
    },
  };
}

export type StaffRepository = ReturnType<typeof createStaffRepository>;
