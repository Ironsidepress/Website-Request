import { contentPlanOutputSchema, creativeBriefOutputSchema } from '@website-factory/schemas';

/**
 * Server-side preview renderer (docs/workflow-state-machine.md, preview_deploy).
 *
 * The preview "deployment" is the platform serving the client's site itself:
 * the /preview route renders HTML on demand from the latest content_plan and
 * creative_brief artifacts, so the preview always reflects the artifacts the
 * preview_review gate is approving — no build step, no per-project worker.
 * Real generated-code deployments arrive with the developer agent (post-MVP).
 */

export interface PreviewInput {
  businessName: string;
  contentPlan: unknown;
  creativeBrief?: unknown;
}

interface Palette {
  bg: string;
  surface: string;
  ink: string;
  muted: string;
  accent: string;
  accentInk: string;
  dark: string;
  darkInk: string;
}

const WARM: Palette = {
  bg: '#faf7f1',
  surface: '#ffffff',
  ink: '#292420',
  muted: '#6b6157',
  accent: '#c4622d',
  accentInk: '#ffffff',
  dark: '#262019',
  darkInk: '#f5efe7',
};

const COOL: Palette = {
  bg: '#f5f7fa',
  surface: '#ffffff',
  ink: '#1e2733',
  muted: '#5b6b7d',
  accent: '#2f5e9e',
  accentInk: '#ffffff',
  dark: '#18202b',
  darkInk: '#e8eef5',
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Draft copy carries inline source annotations for reviewers of the plan —
 * a rendered site preview reads better without them. */
function cleanCopy(value: string): string {
  return value.replace(/\s*\(source:[^)]*\)/gi, '').trim();
}

/**
 * Renders the preview site as a self-contained HTML document, or null when
 * the project's content plan is missing or not a real (schema-valid) plan —
 * e.g. legacy simulated artifacts.
 */
export function renderPreviewSite(input: PreviewInput): string | null {
  const plan = contentPlanOutputSchema.safeParse(input.contentPlan);
  if (!plan.success) return null;
  const brief = creativeBriefOutputSchema.safeParse(input.creativeBrief);
  const colorDirection = brief.success ? brief.data.visualDirection.colorDirection : '';
  const palette = /warm|earth|rust|amber|terracotta/i.test(colorDirection) ? WARM : COOL;

  const name = escapeHtml(input.businessName);
  const nav = plan.data.sitemap
    .map(
      (page) =>
        `<a href="#page-${escapeHtml(page.path.replaceAll('/', '') || 'home')}">${escapeHtml(page.title)}</a>`,
    )
    .join('');

  const pages = plan.data.pages
    .map((page) => {
      const anchor = escapeHtml(page.path.replaceAll('/', '') || 'home');
      const [hero, ...rest] = page.sections;
      const heroHtml = hero
        ? `<section class="hero"><h1>${escapeHtml(cleanCopy(hero.heading))}</h1><p>${escapeHtml(cleanCopy(hero.draftCopy))}</p><a class="btn" href="#contact">${escapeHtml(cleanCopy(page.callToAction))}</a></section>`
        : '';
      const sections = rest
        .map(
          (section, index) =>
            `<section class="block${index % 2 ? ' alt' : ''}"><h2>${escapeHtml(cleanCopy(section.heading))}</h2><p>${escapeHtml(cleanCopy(section.draftCopy))}</p></section>`,
        )
        .join('');
      return `<div id="page-${anchor}">${heroHtml}${sections}</div>`;
    })
    .join('');

  const cta = plan.data.pages[0]?.callToAction ?? 'Contact us';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${name} — Preview</title>
<style>
  :root { --bg:${palette.bg}; --surface:${palette.surface}; --ink:${palette.ink}; --muted:${palette.muted}; --accent:${palette.accent}; --accent-ink:${palette.accentInk}; --dark:${palette.dark}; --dark-ink:${palette.darkInk}; }
  * { box-sizing:border-box; margin:0; }
  body { font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif; background:var(--bg); color:var(--ink); line-height:1.6; }
  .preview-banner { background:var(--dark); color:var(--dark-ink); font-size:13px; text-align:center; padding:6px 16px; }
  header { display:flex; align-items:center; gap:24px; padding:20px 6vw; background:var(--surface); border-bottom:1px solid rgba(0,0,0,.08); position:sticky; top:0; }
  header .brand { font-weight:800; font-size:18px; margin-right:auto; }
  header a { color:var(--muted); text-decoration:none; font-weight:600; font-size:14px; margin-left:18px; }
  .hero { padding:12vh 6vw; max-width:900px; }
  .hero h1 { font-size:clamp(32px,5vw,56px); line-height:1.12; letter-spacing:-.01em; }
  .hero p { margin:20px 0 28px; font-size:19px; color:var(--muted); max-width:640px; }
  .btn { display:inline-block; background:var(--accent); color:var(--accent-ink); font-weight:650; text-decoration:none; padding:14px 26px; border-radius:10px; }
  .block { padding:64px 6vw; max-width:980px; }
  .block.alt { background:var(--surface); max-width:none; }
  .block.alt > * { max-width:860px; }
  .block h2 { font-size:28px; margin-bottom:12px; }
  .block p { color:var(--muted); max-width:720px; }
  .cta { background:var(--dark); color:var(--dark-ink); text-align:center; padding:80px 6vw; }
  .cta h2 { font-size:32px; margin-bottom:20px; }
  footer { padding:24px 6vw; font-size:13px; color:var(--muted); }
</style>
</head>
<body>
<div class="preview-banner">Preview — this site is awaiting your approval and is not published.</div>
<header><span class="brand">${name}</span>${nav}</header>
${pages}
<section class="cta" id="contact"><h2>${escapeHtml(cleanCopy(cta))}</h2><a class="btn" href="#">Get in touch</a></section>
<footer>${name} — website preview generated by Website Factory.</footer>
</body>
</html>`;
}
