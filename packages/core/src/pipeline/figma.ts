import type { AgentExecution, AgentExecutor, AgentTask } from './dispatcher';

/**
 * Figma design production (ADR-0017, docs/agent-contracts.md `uiux_design`).
 *
 * Figma's REST API cannot author design content, so generation goes through
 * Figma's hosted MCP server. The executor never talks to Figma directly — it
 * depends on this narrow FigmaClient interface, so the production MCP client
 * (per-environment OAuth secret) and test fakes are interchangeable, and
 * swapping executors requires no dispatcher, schema or workflow changes
 * (the ADR-0009 acceptance criterion).
 */

export interface FigmaDesignRequest {
  projectId: string;
  organizationId: string;
  /** Stage attempt — rework produces a fresh design version. */
  attempt: number;
  /** Input artifact references (creative brief etc.) for traceability. */
  inputArtifacts: Array<{ artifactId: string; version: number }>;
}

export interface FigmaDesignRef {
  fileKey: string;
  /** Canonical URL a human reviewer opens at the design gate. */
  fileUrl: string;
  nodeIds: string[];
  snapshotUrl?: string;
}

export interface FigmaClient {
  generateDesign(request: FigmaDesignRequest): Promise<FigmaDesignRef>;
}

export class FigmaDesignExecutor implements AgentExecutor {
  constructor(private readonly client: FigmaClient) {}

  async execute(task: AgentTask): Promise<AgentExecution> {
    const design = await this.client.generateDesign({
      projectId: task.projectId,
      organizationId: task.organizationId,
      attempt: task.attempt,
      inputArtifacts: task.inputArtifacts,
    });
    return {
      model: 'figma-mcp',
      // Token accounting happens inside Figma's service; the run records the
      // external call itself, not a model invocation.
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      content: {
        summary: `Figma design produced for review (attempt ${task.attempt})`,
      },
      externalRef: {
        provider: 'figma',
        fileKey: design.fileKey,
        nodeIds: design.nodeIds,
        reviewUrl: design.fileUrl,
        ...(design.snapshotUrl ? { snapshotUrl: design.snapshotUrl } : {}),
      },
    };
  }
}
