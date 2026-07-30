import type { AgentExecution, AgentExecutor, AgentTask } from './dispatcher';

/**
 * Preview "deployment" executor (docs/workflow-state-machine.md).
 *
 * The platform serves previews itself: this executor mints a tokenized
 * review URL pointing at the web app's /preview route, which renders the
 * site on demand from the latest content_plan + creative_brief artifacts.
 * The token in the external ref is what the route validates — the URL is
 * shareable but not guessable, and a new attempt mints a new token.
 */

export interface PreviewDeployExecutorConfig {
  /** Public base URL of the web app, e.g. https://…workers.dev (no slash). */
  baseUrl: string;
  /** Handles every other project_manager task (e.g. production_deploy). */
  fallback: AgentExecutor;
  /** Injectable for tests; defaults to crypto.randomUUID. */
  randomToken?: () => string;
}

export class PreviewDeployExecutor implements AgentExecutor {
  constructor(private readonly config: PreviewDeployExecutorConfig) {}

  async execute(task: AgentTask): Promise<AgentExecution> {
    if (task.outputArtifactType !== 'preview_deployment') {
      return this.config.fallback.execute(task);
    }
    const token = (this.config.randomToken ?? (() => crypto.randomUUID()))();
    const reviewUrl = `${this.config.baseUrl}/preview/${task.projectId}?t=${token}`;
    return {
      model: 'platform-preview',
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      content: {},
      externalRef: { provider: 'platform', token, reviewUrl },
    };
  }
}
