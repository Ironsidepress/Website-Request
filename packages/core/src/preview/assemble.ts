import { codeChangeOutputSchema } from '@website-factory/schemas';

/**
 * Assembles a generated site page for serving (ADR-0018).
 *
 * The developer agent produces body fragments plus one stylesheet; the
 * document shell — doctype, head, noindex, the preview banner — is built here
 * so those can never be shaped by model output. The fragment is additionally
 * scrubbed at render time (defence in depth: the contract already rejects
 * forbidden markup before the artifact is ever stored).
 */

const SCRUB_PATTERNS: Array<[RegExp, string]> = [
  [/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, ''],
  [/<\s*(script|iframe|object|embed|form)\b[^>]*>/gi, ''],
  [/<\s*\/\s*(script|iframe|object|embed|form)\s*>/gi, ''],
  [/\son[a-z]+\s*=\s*"[^"]*"/gi, ''],
  [/\son[a-z]+\s*=\s*'[^']*'/gi, ''],
  [/javascript:/gi, ''],
];

export function scrubFragment(html: string): string {
  return SCRUB_PATTERNS.reduce(
    (acc, [pattern, replacement]) => acc.replace(pattern, replacement),
    html,
  );
}

function scrubCss(css: string): string {
  return css.replace(/@import[^;]*;/gi, '').replace(/url\(\s*['"]?https?:[^)]*\)/gi, 'none');
}

export interface AssembleInput {
  businessName: string;
  /** The code_change artifact content. */
  code: unknown;
  /** Requested site path, e.g. "/" or "/services". */
  path: string;
}

export interface AssembledPage {
  html: string;
  title: string;
}

/**
 * Renders one page of the generated site, or null when the artifact is not a
 * valid code change or the path is unknown (the caller then 404s or falls
 * back to the template preview).
 */
export function assembleGeneratedPage(input: AssembleInput): AssembledPage | null {
  const parsed = codeChangeOutputSchema.safeParse(input.code);
  if (!parsed.success || parsed.data.pages.length === 0) return null;

  const wanted = input.path === '' ? '/' : input.path;
  const page =
    parsed.data.pages.find((candidate) => candidate.path === wanted) ??
    (wanted === '/' ? parsed.data.pages[0] : undefined);
  if (!page) return null;

  const escapedName = input.businessName
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  const title = page.title.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

  return {
    title: page.title,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title} — ${escapedName} (preview)</title>
<style>
  .wf-preview-banner { background:#1d242e; color:#f2f5f8; font:600 13px/1.4 ui-sans-serif,system-ui,sans-serif; text-align:center; padding:8px 16px; }
  .wf-preview-banner a { color:inherit; }
${scrubCss(parsed.data.css)}
</style>
</head>
<body>
<div class="wf-preview-banner">Preview of your website — awaiting your approval, not published.</div>
${scrubFragment(page.bodyHtml)}
</body>
</html>`,
  };
}
