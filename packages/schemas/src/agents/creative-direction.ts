import { z } from 'zod';

/**
 * Creative-direction agent contract v1 (docs/agent-contracts.md).
 *
 * The roster scopes this agent to style, mood and direction only: the brief
 * guides the design agent without specifying final designs, and it makes no
 * factual claims — so unlike the research and content contracts it carries
 * no source log and can never flag unverified claims.
 */

export const CREATIVE_DIRECTION_CONTRACT_VERSION = 1;

export const creativeBriefOutputSchema = z.strictObject({
  /** The single idea the visual identity should communicate. */
  directionSummary: z.string(),
  /** Adjectives the brand should embody, e.g. "crafted", "warm". */
  brandPersonality: z.array(z.string()),
  /** How the site should sound; complements the content plan's copy. */
  toneOfVoice: z.string(),
  visualDirection: z.strictObject({
    /** Mood keywords for the designer, e.g. "tactile", "letterpress texture". */
    mood: z.array(z.string()),
    /** Palette guidance in words — never final hex values. */
    colorDirection: z.string(),
    typographyDirection: z.string(),
    imageryDirection: z.string(),
  }),
  /** Structural guidance, e.g. "portfolio-first", "generous whitespace". */
  layoutPrinciples: z.array(z.string()),
  /** What to avoid, drawn from the client's stated dislikes. */
  avoid: z.array(z.string()),
});
export type CreativeBriefOutput = z.infer<typeof creativeBriefOutputSchema>;

/** JSON Schema for the API's structured-output format. */
export function creativeBriefJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(creativeBriefOutputSchema) as Record<string, unknown>;
}
