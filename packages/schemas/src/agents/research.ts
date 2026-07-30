import { z } from 'zod';

/**
 * Research agent contract v1 (docs/agent-contracts.md).
 *
 * The mechanical factual-claims rule lives here: every claim in the report
 * carries a source-log entry, and any `unverified` entry flags the artifact
 * so it cannot pass pre-publication gates without human approval.
 *
 * Note: `researchOutputJsonShape` (what the API is asked to produce) omits
 * length constraints because structured-output schemas reject them; the
 * strict Zod schema below is the acceptance check applied to the response.
 */

export const RESEARCH_CONTRACT_VERSION = 1;

export const sourceLogEntrySchema = z.strictObject({
  /** The factual claim being made, verbatim or near-verbatim. */
  claim: z.string(),
  /** Where it comes from: a URL, the client's own intake, or nowhere yet. */
  source: z.union([z.url(), z.literal('client_intake'), z.literal('unverified')]),
  confidence: z.enum(['high', 'medium', 'low']),
});
export type SourceLogEntry = z.infer<typeof sourceLogEntrySchema>;

export const researchOutputSchema = z.strictObject({
  /** Plain-language overview of the business and its market position. */
  summary: z.string(),
  /** What matters to the primary audience and how to reach them. */
  audienceInsights: z.array(z.string()),
  /** Competitive landscape observations (may be empty when none known). */
  competitorNotes: z.array(z.string()),
  /** Concrete recommendations for the website's content and structure. */
  recommendations: z.array(z.string()),
  /** One entry per factual claim (docs/agent-contracts.md §source logs). */
  sourceLog: z.array(sourceLogEntrySchema),
});
export type ResearchOutput = z.infer<typeof researchOutputSchema>;

/** JSON Schema for the API's structured-output format. */
export function researchOutputJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(researchOutputSchema) as Record<string, unknown>;
}

/** Shared across every source-logged contract (research, content strategy). */
export function hasUnverifiedClaims(output: { sourceLog: SourceLogEntry[] }): boolean {
  return output.sourceLog.some((entry) => entry.source === 'unverified');
}
