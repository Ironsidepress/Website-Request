import Anthropic from '@anthropic-ai/sdk';
import {
  RESEARCH_CONTRACT_VERSION,
  hasUnverifiedClaims,
  researchOutputJsonSchema,
  researchOutputSchema,
} from '@website-factory/schemas';

import type { AgentExecution, AgentExecutor, AgentTask } from './dispatcher';

/**
 * Real agent execution over the Claude API (docs/agent-contracts.md).
 *
 * Each supported agent type has a versioned prompt and a versioned output
 * schema; an output that fails schema validation is a failed run — the
 * workflow retries or escalates, and invalid output is never partially
 * accepted. Runs record real token usage and estimated cost. Server-side
 * refusal fallbacks are enabled so a safety-classifier decline re-runs on
 * Anthropic's recommended fallback model instead of failing the stage.
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

const RESEARCH_SYSTEM_PROMPT = `You are the research agent of a website production platform for small businesses. From the client's intake questionnaire you produce a research report that later agents use to plan sitemap, content and design.

Rules you must follow exactly:
- Every factual claim in your report must have a corresponding entry in sourceLog.
- A claim taken from the client's own intake uses source "client_intake".
- General industry knowledge or assumptions you cannot verify use source "unverified". Never present an unverified claim as fact in the report text — phrase it as an assumption.
- Never invent specific facts about named competitors, prices, statistics or regulations. If you are not certain, mark the claim "unverified" or leave it out.
- Keep the report practical and grounded in what a small-business website needs.`;

export const RESEARCH_PROMPT_VERSION = 'research-v2-claude';

/** Per-agent-type prompt + acceptance schema. Only `research` is real so far. */
const AGENT_SPECS = {
  research: {
    promptVersion: RESEARCH_PROMPT_VERSION,
    contractVersion: RESEARCH_CONTRACT_VERSION,
    system: RESEARCH_SYSTEM_PROMPT,
    jsonSchema: researchOutputJsonSchema,
    buildPrompt: (inputs: Record<string, unknown>): string =>
      `Produce the research report for this client. Their completed intake questionnaire follows as JSON:\n\n${JSON.stringify(inputs, null, 2)}`,
    validate: (raw: unknown) => {
      const parsed = researchOutputSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(`research output failed schema validation: ${parsed.error.message}`);
      }
      return { content: parsed.data, hasUnverifiedClaims: hasUnverifiedClaims(parsed.data) };
    },
  },
} as const;

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

  static supports(agentType: string): boolean {
    return agentType in AGENT_SPECS;
  }

  async execute(task: AgentTask): Promise<AgentExecution> {
    const spec = AGENT_SPECS[task.agentType as keyof typeof AGENT_SPECS];
    if (!spec) {
      throw new Error(`ClaudeExecutor has no contract for agent type ${task.agentType}`);
    }
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
