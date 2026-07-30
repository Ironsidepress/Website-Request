import Anthropic from '@anthropic-ai/sdk';

import { requireAgentSpec } from './agent-specs';
import type { AgentExecution, AgentExecutor, AgentTask } from './dispatcher';

export {
  CONTENT_STRATEGY_PROMPT_VERSION,
  CREATIVE_DIRECTION_PROMPT_VERSION,
  RESEARCH_PROMPT_VERSION,
} from './agent-specs';

/**
 * Real agent execution over the Claude API, sharing the provider-independent
 * specs in agent-specs.ts. Runs record real token usage and estimated cost.
 * Server-side refusal fallbacks are enabled so a safety-classifier decline
 * re-runs on Anthropic's recommended fallback model instead of failing the
 * stage.
 */

export interface ClaudeExecutorConfig {
  apiKey: string;
  /** Defaults to claude-opus-5. */
  model?: string;
  /** Loads the agent's input documents (e.g. the frozen intake). */
  inputLoader: (task: AgentTask) => Promise<Record<string, unknown>>;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_MODEL = 'claude-opus-5';
const MAX_OUTPUT_TOKENS = 16_000;

/** USD per million tokens (input, output) — used for estimated_cost_usd. */
const PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing =
    Object.entries(PRICING_PER_MTOK).find(([prefix]) => model.startsWith(prefix))?.[1] ??
    PRICING_PER_MTOK[DEFAULT_MODEL]!;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

export class ClaudeExecutor implements AgentExecutor {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(private readonly config: ClaudeExecutorConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.fetchImpl ? { fetch: config.fetchImpl } : {}),
    });
    this.model = config.model ?? DEFAULT_MODEL;
  }

  async execute(task: AgentTask): Promise<AgentExecution> {
    const spec = requireAgentSpec(task.agentType);
    const inputs = await this.config.inputLoader(task);

    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: spec.system,
      output_config: { format: { type: 'json_schema', schema: spec.jsonSchema() } },
      messages: [{ role: 'user', content: spec.buildPrompt(inputs) }],
    });

    if (response.stop_reason === 'refusal') {
      throw new Error(
        `claude declined the ${task.agentType} task (category: ${response.stop_details?.category ?? 'unknown'})`,
      );
    }
    const text = response.content.find(
      (block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text',
    )?.text;
    if (!text) throw new Error(`claude returned no text output for ${task.agentType}`);

    const { content, hasUnverifiedClaims } = spec.validate(JSON.parse(text));
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;

    return {
      model: response.model,
      promptVersion: spec.promptVersion,
      inputTokens,
      outputTokens,
      estimatedCostUsd: estimateCostUsd(response.model, inputTokens, outputTokens),
      content,
      hasUnverifiedClaims,
    };
  }
}
