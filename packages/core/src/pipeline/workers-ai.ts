import { requireAgentSpec } from './agent-specs';
import type { AgentExecution, AgentExecutor, AgentTask } from './dispatcher';

/**
 * Agent execution on Cloudflare Workers AI, sharing the provider-independent
 * specs in agent-specs.ts. Chosen as the no-extra-vendor alternative to the
 * Claude API: the model runs inside the Cloudflare account via the `AI`
 * binding, so no separate key exists. JSON mode (response_format json_schema)
 * constrains the output shape; the strict Zod contract remains the acceptance
 * check, and a schema-invalid output is a failed run exactly as with Claude.
 */

/** Structural view of the Workers AI binding — keeps core platform-agnostic. */
export interface WorkersAiClient {
  run(model: string, options: Record<string, unknown>): Promise<unknown>;
}

export interface WorkersAiExecutorConfig {
  ai: WorkersAiClient;
  /** Defaults to Llama 3.3 70B (fast fp8) — supports JSON mode. */
  model?: string;
  /** Loads the agent's input documents (e.g. the frozen intake). */
  inputLoader: (task: AgentTask) => Promise<Record<string, unknown>>;
}

const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MAX_OUTPUT_TOKENS = 4_096;

/**
 * USD per million tokens (input, output), approximated from Cloudflare's
 * published Workers AI pricing — used for estimated_cost_usd bookkeeping.
 */
const PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { input: 0.29, output: 2.25 },
};

function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = PRICING_PER_MTOK[model] ?? { input: 0.29, output: 2.25 };
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

interface WorkersAiTextResult {
  response?: unknown;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class WorkersAiExecutor implements AgentExecutor {
  private readonly model: string;

  constructor(private readonly config: WorkersAiExecutorConfig) {
    this.model = config.model ?? DEFAULT_MODEL;
  }

  async execute(task: AgentTask): Promise<AgentExecution> {
    const spec = requireAgentSpec(task.agentType);
    const inputs = await this.config.inputLoader(task);

    const result = (await this.config.ai.run(this.model, {
      messages: [
        { role: 'system', content: spec.system },
        { role: 'user', content: spec.buildPrompt(inputs) },
      ],
      response_format: { type: 'json_schema', json_schema: spec.jsonSchema() },
      max_tokens: MAX_OUTPUT_TOKENS,
    })) as WorkersAiTextResult;

    // JSON mode returns the object directly on some models and a JSON string
    // on others; both funnel into the same strict validation.
    const raw =
      typeof result.response === 'string'
        ? (JSON.parse(result.response) as unknown)
        : result.response;
    if (raw === undefined || raw === null) {
      throw new Error(`workers-ai returned no output for ${task.agentType}`);
    }

    const { content, hasUnverifiedClaims } = spec.validate(raw);
    const inputTokens = result.usage?.prompt_tokens ?? 0;
    const outputTokens = result.usage?.completion_tokens ?? 0;

    return {
      model: this.model,
      promptVersion: spec.promptVersion,
      inputTokens,
      outputTokens,
      estimatedCostUsd: estimateCostUsd(this.model, inputTokens, outputTokens),
      content,
      hasUnverifiedClaims,
    };
  }
}
