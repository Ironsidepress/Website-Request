import type { Database } from '@website-factory/db';
import {
  createIntakesRepository,
  createPipelineRepository,
  createProjectsRepository,
  tenantContext,
} from '@website-factory/db';

import type { AgentTask } from './dispatcher';
import type { FigmaDesignReader } from './figma-design-context';

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

interface UpstreamArtifact {
  type: string;
  as: string;
  /**
   * Project rule: developer agents work ONLY from approved design and content
   * artifacts. When set, an unapproved (or superseded) latest version fails
   * the run instead of silently building from a draft.
   */
  requireApproved?: boolean;
}

/** Upstream artifacts each agent type reads (docs/agent-contracts.md roster). */
const AGENT_INPUT_ARTIFACTS: Record<string, UpstreamArtifact[]> = {
  research: [],
  content_strategy: [{ type: 'research_report', as: 'researchReport' }],
  creative_direction: [
    { type: 'research_report', as: 'researchReport' },
    { type: 'content_plan', as: 'contentPlan' },
  ],
  developer: [
    { type: 'content_plan', as: 'contentPlan' },
    { type: 'creative_brief', as: 'creativeBrief' },
    { type: 'figma_design', as: 'approvedDesign', requireApproved: true },
  ],
};

/**
 * Per-agent-type input assembly (docs/agent-contracts.md roster): every agent
 * reads the frozen intake; later agents add the latest upstream artifact
 * versions. A missing upstream artifact is a failed run — the agent never
 * proceeds on partial inputs. Inline artifacts contribute their parsed
 * content; external-ref artifacts (e.g. a Figma design) contribute their
 * reference, never a fabricated body.
 */
export function createAgentInputLoader(
  db: Database,
  options: {
    /**
     * When provided, the developer agent receives the approved design's actual
     * structure (sections, palette, type scale, copy) instead of only a link —
     * without it the agent can only improvise from the creative brief.
     */
    designReader?: FigmaDesignReader;
  } = {},
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
    for (const { type, as, requireApproved } of upstream) {
      const artifact = await pipeline.latestArtifact(ctx, task.projectId, type);
      if (!artifact) {
        throw new Error(`${type} artifact missing for project ${task.projectId}`);
      }
      if (requireApproved && artifact.status !== 'approved') {
        throw new Error(
          `${type} artifact for project ${task.projectId} is ${artifact.status}, not approved`,
        );
      }
      const payload = artifact.content ?? artifact.externalRef;
      if (!payload) {
        throw new Error(`${type} artifact for project ${task.projectId} has no readable payload`);
      }
      inputs[as] = JSON.parse(payload) as Record<string, unknown>;
    }

    // Resolve the design itself, not just its reference. A read failure is
    // recorded in the inputs rather than thrown: implementing from the brief
    // alone is a degraded but useful outcome, and the agent is told which it
    // got so its implementation notes stay truthful.
    const design = inputs.approvedDesign as { fileKey?: unknown } | undefined;
    if (options.designReader && typeof design?.fileKey === 'string') {
      try {
        inputs.designContext = await options.designReader.readDesignContext(design.fileKey);
      } catch (error) {
        inputs.designContextUnavailable =
          error instanceof Error ? error.message : 'design could not be read';
      }
    }
    return inputs;
  };
}
