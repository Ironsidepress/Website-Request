import { z } from 'zod';

import { sourceLogEntrySchema } from './research';

/**
 * Content-strategy agent contract v1 (docs/agent-contracts.md).
 *
 * The roster lists sitemap, content plan and draft copy as this agent's
 * outputs; v1 embeds all three in the single `content_plan` artifact the
 * pipeline dispatches (engine STAGE_TASKS), so downstream agents and the
 * preview gates review one coherent version.
 *
 * Like the research contract, the JSON shape sent to the API omits length
 * constraints (structured-output schemas reject them); the strict Zod schema
 * below is the acceptance check applied to the response.
 */

export const CONTENT_STRATEGY_CONTRACT_VERSION = 1;

export const sitemapPageSchema = z.strictObject({
  /** Site-relative path, e.g. "/" or "/services". */
  path: z.string(),
  title: z.string(),
  /** What this page must accomplish for the visitor. */
  purpose: z.string(),
});
export type SitemapPage = z.infer<typeof sitemapPageSchema>;

export const pageContentPlanSchema = z.strictObject({
  /** Must match a sitemap entry's path. */
  path: z.string(),
  sections: z.array(
    z.strictObject({
      heading: z.string(),
      /** Why the section exists — guides the creative and design agents. */
      intent: z.string(),
      /** Draft copy a human can edit; never published without approval. */
      draftCopy: z.string(),
    }),
  ),
  callToAction: z.string(),
});
export type PageContentPlan = z.infer<typeof pageContentPlanSchema>;

export const contentPlanOutputSchema = z.strictObject({
  /** How the site's content earns the primary audience's trust and action. */
  strategySummary: z.string(),
  sitemap: z.array(sitemapPageSchema),
  pages: z.array(pageContentPlanSchema),
  /** Phrases the copy targets; the seo_aeo agent refines these later. */
  seoKeywords: z.array(z.string()),
  /** One entry per factual claim (docs/agent-contracts.md §source logs). */
  sourceLog: z.array(sourceLogEntrySchema),
});
export type ContentPlanOutput = z.infer<typeof contentPlanOutputSchema>;

/** JSON Schema for the API's structured-output format. */
export function contentPlanJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(contentPlanOutputSchema) as Record<string, unknown>;
}
