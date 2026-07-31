import type { Database } from '@website-factory/db';
import { createPipelineRepository, tenantContext } from '@website-factory/db';
import { codeChangeOutputSchema } from '@website-factory/schemas';

import { buildDesignTokens } from './design-tokens';
import type { AgentExecution, AgentExecutor, AgentTask } from './dispatcher';
import type { FigmaDesignReader } from './figma-design-context';

/**
 * Enforces the approved design on generated code (ADR-0018 amendment).
 *
 * Wraps the generating executor and appends a design-system stylesheet derived
 * from the Figma file to the agent's CSS, so the site's palette, type scale
 * and section backgrounds come from the design rather than from whatever the
 * model chose. The appended layer becomes part of the stored artifact, so the
 * preview, the repository and the reviewer all see the same thing.
 */

export interface DesignSystemExecutorConfig {
  inner: AgentExecutor;
  db: Database;
  reader: FigmaDesignReader;
  /** Surfaced as a warning; a design that cannot be read is not fatal. */
  onUnavailable?: (task: AgentTask, reason: string) => void;
}

export class DesignSystemExecutor implements AgentExecutor {
  private readonly pipeline;

  constructor(private readonly config: DesignSystemExecutorConfig) {
    this.pipeline = createPipelineRepository(config.db);
  }

  async execute(task: AgentTask): Promise<AgentExecution> {
    const execution = await this.config.inner.execute(task);
    const parsed = codeChangeOutputSchema.safeParse(execution.content);
    if (!parsed.success) return execution;

    const ctx = tenantContext(task.organizationId);
    const design = await this.pipeline.latestArtifact(ctx, task.projectId, 'figma_design');
    const ref = design?.externalRef
      ? (JSON.parse(design.externalRef) as { fileKey?: unknown })
      : undefined;
    if (typeof ref?.fileKey !== 'string') {
      this.config.onUnavailable?.(task, 'approved design has no Figma file key');
      return execution;
    }

    try {
      const context = await this.config.reader.readDesignContext(ref.fileKey);
      const tokens = buildDesignTokens(context);
      return {
        ...execution,
        content: {
          ...parsed.data,
          // Appended last so the design wins over the agent's own colours.
          css: `${parsed.data.css}\n\n${tokens.css}\n`,
          implementationNotes: [
            ...parsed.data.implementationNotes,
            `Design system applied from the approved Figma design (${context.fileName}): palette ${tokens.palette.background}/${tokens.palette.ink}/${tokens.palette.accent}, type scale ${tokens.typeScale.slice(0, 4).join('/')}px.`,
          ],
        },
      };
    } catch (error) {
      this.config.onUnavailable?.(
        task,
        error instanceof Error ? error.message : 'design could not be read',
      );
      return execution;
    }
  }
}
