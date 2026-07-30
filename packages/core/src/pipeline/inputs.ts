import type { Database } from '@website-factory/db';
import {
  createIntakesRepository,
  createProjectsRepository,
  tenantContext,
} from '@website-factory/db';

import type { AgentTask } from './dispatcher';

/**
 * Loads the frozen intake document as agent input (docs/agent-contracts.md:
 * the research agent reads the intake; later agents read artifact versions).
 * Tenant-scoped like every other data access.
 */
export function createIntakeInputLoader(
  db: Database,
): (task: AgentTask) => Promise<Record<string, unknown>> {
  const projects = createProjectsRepository(db);
  const intakes = createIntakesRepository(db);
  return async (task) => {
    const ctx = tenantContext(task.organizationId);
    const project = await projects.findById(ctx, task.projectId);
    if (!project) throw new Error(`project ${task.projectId} not found for agent input`);
    const intake = await intakes.findById(ctx, project.intakeId);
    if (!intake) throw new Error(`intake for project ${task.projectId} not found`);
    return JSON.parse(intake.data) as Record<string, unknown>;
  };
}
