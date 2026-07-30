import {
  CONTENT_STRATEGY_CONTRACT_VERSION,
  CREATIVE_DIRECTION_CONTRACT_VERSION,
  RESEARCH_CONTRACT_VERSION,
  contentPlanJsonSchema,
  contentPlanOutputSchema,
  creativeBriefJsonSchema,
  creativeBriefOutputSchema,
  hasUnverifiedClaims,
  researchOutputJsonSchema,
  researchOutputSchema,
} from '@website-factory/schemas';

/**
 * Provider-independent agent specifications (docs/agent-contracts.md).
 *
 * Each supported agent type has a versioned prompt and a versioned output
 * schema; an output that fails schema validation is a failed run — the
 * workflow retries or escalates, and invalid output is never partially
 * accepted. Executors (Claude API, Workers AI, …) share these specs so a
 * provider swap never changes the contract; the run's `model` column records
 * which provider produced an artifact.
 */

export interface AgentSpec {
  promptVersion: string;
  contractVersion: number;
  system: string;
  jsonSchema: () => Record<string, unknown>;
  buildPrompt: (inputs: Record<string, unknown>) => string;
  validate: (raw: unknown) => {
    content: Record<string, unknown>;
    hasUnverifiedClaims: boolean;
  };
}

const RESEARCH_SYSTEM_PROMPT = `You are the research agent of a website production platform for small businesses. From the client's intake questionnaire you produce a research report that later agents use to plan sitemap, content and design.

Rules you must follow exactly:
- Every factual claim in your report must have a corresponding entry in sourceLog.
- A claim taken from the client's own intake uses source "client_intake".
- General industry knowledge or assumptions you cannot verify use source "unverified". Never present an unverified claim as fact in the report text — phrase it as an assumption.
- Never invent specific facts about named competitors, prices, statistics or regulations. If you are not certain, mark the claim "unverified" or leave it out.
- Keep the report practical and grounded in what a small-business website needs.`;

export const RESEARCH_PROMPT_VERSION = 'research-v2-claude';

const CONTENT_STRATEGY_SYSTEM_PROMPT = `You are the content-strategy agent of a website production platform for small businesses. From the client's intake questionnaire and the approved research report you produce the sitemap, a per-page content plan and draft copy that the creative, design and development agents work from.

Rules you must follow exactly:
- Every factual claim in the plan or draft copy must have a corresponding entry in sourceLog.
- A claim taken from the client's own intake uses source "client_intake".
- A claim taken from the research report keeps that report's source: reuse the URL when the report cites one, "client_intake" when the report sourced it from the intake, and "unverified" when the report flagged it unverified.
- You may not introduce facts that appear in neither the intake nor the research report. General industry knowledge you cannot verify uses source "unverified" and must be phrased as an assumption in the copy, never as fact.
- Never invent specific facts about named competitors, prices, statistics or regulations.
- Keep the sitemap small and purposeful for a small-business site; every pages[] entry must use a path from the sitemap.
- Draft copy is a working draft a human will edit — clear, concrete and in the client's voice, with a call to action per page.`;

export const CONTENT_STRATEGY_PROMPT_VERSION = 'content-strategy-v1-claude';

const CREATIVE_DIRECTION_SYSTEM_PROMPT = `You are the creative-direction agent of a website production platform for small businesses. From the client's intake questionnaire, the research report and the content plan you produce a creative brief that guides the design agent.

Rules you must follow exactly:
- Style, mood and direction only. You do not write copy (the content plan owns it), you do not specify final designs, layouts, hex colors or font names — you give the designer direction in words.
- Ground every direction in the client's stated preferences from the intake and the audience insights from the research report. When the client stated dislikes, they go in "avoid".
- Make no factual claims about the business or its market; the brief expresses creative judgement, not facts.
- Keep it small-business practical: a direction the design stage can execute in a single website design.`;

export const CREATIVE_DIRECTION_PROMPT_VERSION = 'creative-direction-v1-claude';

/** Per-agent-type prompt + acceptance schema (real agents so far). */
export const AGENT_SPECS: Record<string, AgentSpec> = {
  research: {
    promptVersion: RESEARCH_PROMPT_VERSION,
    contractVersion: RESEARCH_CONTRACT_VERSION,
    system: RESEARCH_SYSTEM_PROMPT,
    jsonSchema: researchOutputJsonSchema,
    buildPrompt: (inputs) =>
      `Produce the research report for this client. Their completed intake questionnaire follows as JSON:\n\n${JSON.stringify(inputs, null, 2)}`,
    validate: (raw) => {
      const parsed = researchOutputSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(`research output failed schema validation: ${parsed.error.message}`);
      }
      return { content: parsed.data, hasUnverifiedClaims: hasUnverifiedClaims(parsed.data) };
    },
  },
  content_strategy: {
    promptVersion: CONTENT_STRATEGY_PROMPT_VERSION,
    contractVersion: CONTENT_STRATEGY_CONTRACT_VERSION,
    system: CONTENT_STRATEGY_SYSTEM_PROMPT,
    jsonSchema: contentPlanJsonSchema,
    buildPrompt: (inputs) =>
      `Produce the sitemap, content plan and draft copy for this client. Their completed intake questionnaire and the research report follow as JSON:\n\n${JSON.stringify(inputs, null, 2)}`,
    validate: (raw) => {
      const parsed = contentPlanOutputSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          `content_strategy output failed schema validation: ${parsed.error.message}`,
        );
      }
      return { content: parsed.data, hasUnverifiedClaims: hasUnverifiedClaims(parsed.data) };
    },
  },
  creative_direction: {
    promptVersion: CREATIVE_DIRECTION_PROMPT_VERSION,
    contractVersion: CREATIVE_DIRECTION_CONTRACT_VERSION,
    system: CREATIVE_DIRECTION_SYSTEM_PROMPT,
    jsonSchema: creativeBriefJsonSchema,
    buildPrompt: (inputs) =>
      `Produce the creative brief for this client. Their completed intake questionnaire, the research report and the content plan follow as JSON:\n\n${JSON.stringify(inputs, null, 2)}`,
    validate: (raw) => {
      const parsed = creativeBriefOutputSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          `creative_direction output failed schema validation: ${parsed.error.message}`,
        );
      }
      // Style/mood only — the brief carries no factual claims by contract.
      return { content: parsed.data, hasUnverifiedClaims: false };
    },
  },
};

export function requireAgentSpec(agentType: string): AgentSpec {
  const spec = AGENT_SPECS[agentType];
  if (!spec) throw new Error(`no agent spec defined for agent type ${agentType}`);
  return spec;
}
