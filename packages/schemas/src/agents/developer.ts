import { z } from 'zod';

/**
 * Developer agent contract v1 (docs/agent-contracts.md, ADR-0018).
 *
 * The agent writes the site's markup and one shared stylesheet — NOT whole
 * HTML documents: the platform assembles `<head>`, the preview banner and the
 * response headers itself, so document-level concerns (noindex, CSP, meta)
 * can never be shaped by model output. Per-page `bodyHtml` is a fragment.
 *
 * Scripts are out of contract: a small-business brochure site needs none, and
 * refusing them keeps generated markup inert. Violations fail the run.
 */

export const CODE_CHANGE_CONTRACT_VERSION = 1;

export const generatedPageSchema = z.strictObject({
  /** Site-relative path matching a sitemap entry, e.g. "/" or "/services". */
  path: z.string(),
  /** Document title for this page. */
  title: z.string(),
  /** Body markup only — no <html>, <head>, <body> or <script> elements. */
  bodyHtml: z.string(),
});
export type GeneratedPage = z.infer<typeof generatedPageSchema>;

export const codeChangeOutputSchema = z.strictObject({
  /** One stylesheet shared by every page. */
  css: z.string(),
  pages: z.array(generatedPageSchema),
  /** What the implementation did and anything a reviewer should know. */
  implementationNotes: z.array(z.string()),
});
export type CodeChangeOutput = z.infer<typeof codeChangeOutputSchema>;

/** JSON Schema for the API's structured-output format. */
export function codeChangeJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(codeChangeOutputSchema) as Record<string, unknown>;
}

/** Markup the contract forbids outright (checked before acceptance). */
const FORBIDDEN_MARKUP = [
  /<\s*script/i,
  /<\s*iframe/i,
  /<\s*object/i,
  /<\s*embed/i,
  /<\s*form/i,
  /\son[a-z]+\s*=/i,
  /javascript:/i,
  /<\s*(html|head|body)\b/i,
];

/**
 * Contract-level safety check on generated markup. Returns the offending
 * pattern descriptions; an empty array means the output is acceptable.
 */
export function generatedMarkupViolations(output: CodeChangeOutput): string[] {
  const problems: string[] = [];
  for (const page of output.pages) {
    for (const pattern of FORBIDDEN_MARKUP) {
      if (pattern.test(page.bodyHtml)) {
        problems.push(`page ${page.path} contains forbidden markup ${String(pattern)}`);
      }
    }
  }
  if (/@import|url\(\s*['"]?https?:/i.test(output.css)) {
    problems.push('stylesheet loads remote resources');
  }
  return problems;
}
