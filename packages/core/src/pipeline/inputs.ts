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

/** Upstream artifacts each agent type reads (docs/agent-contracts.md roster). */
const AGENT_INPUT_ARTIFACTS: Record<string, Array<{ type: string; as: string }>> = {
  research: [],
  content_strategy: [{ type: 'research_report', as: 'researchReport' }],
  creative_direction: [
    { type: 'research_report', as: 'researchReport' },
    { type: 'content_plan', as: 'contentPlan' },
  ],
};

/**
 * Per-agent-type input assembly (docs/agent-contracts.md roster): every agent
 * reads the frozen intake; later agents add the latest upstream artifact
 * versions. A missing upstream artifact is a failed run — the agent never
 * proceeds on partial inputs.
 */
export function createAgentInputLoader(
  db: Database,
): (task: AgentTask) => Promise<Record<string, unknown>> {
  const loadIntake = createIntakeInputLoader(db);
  const pipeline = createPipelineRepository(db);
  return async (task) => {
    const upstream = AGENT_INPUT_ARTIFACTS[task.agentType];
    if (!upstream) {
      throw new Error(`no agent input loader defined for agent type ${task.agentType}`);
    }
    const intake = await loadIntake(task);
    if (upstream.length === 0) return intake;

    const ctx = tenantContext(task.organizationId);
    const inputs: Record<string, unknown> = { intake };
    for (const { type, as } of upstream) {
      const artifact = await pipeline.latestArtifact(ctx, task.projectId, type);
      if (!artifact?.content) {
        throw new Error(`${type} artifact missing for project ${task.projectId}`);
      }
      inputs[as] = JSON.parse(artifact.content) as Record<string, unknown>;
    }
    return inputs;
  };
}
