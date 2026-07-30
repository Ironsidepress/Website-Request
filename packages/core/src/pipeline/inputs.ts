import type { Database } from '@website-factory/db';
import {
  createIntakesRepository,
  createPipelineRepository,
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

/**
 * Per-agent-type input assembly (docs/agent-contracts.md roster): research
 * reads the intake alone; content_strategy reads the intake plus the latest
 * research_report artifact. A missing upstream artifact is a failed run — the
 * agent never proceeds on partial inputs.
 */
export function createAgentInputLoader(
  db: Database,
): (task: AgentTask) => Promise<Record<string, unknown>> {
  const loadIntake = createIntakeInputLoader(db);
  const pipeline = createPipelineRepository(db);
  return async (task) => {
    const intake = await loadIntake(task);
    if (task.agentType === 'research') return intake;
    if (task.agentType === 'content_strategy') {
      const ctx = tenantContext(task.organizationId);
      const report = await pipeline.latestArtifact(ctx, task.projectId, 'research_report');
      if (!report?.content) {
        throw new Error(`research_report artifact missing for project ${task.projectId}`);
      }
      return { intake, researchReport: JSON.parse(report.content) as Record<string, unknown> };
    }
    throw new Error(`no agent input loader defined for agent type ${task.agentType}`);
  };
}
