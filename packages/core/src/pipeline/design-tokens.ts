import type { FigmaDesignContext, FigmaSectionSpec } from './figma-design-context';

/**
 * Deterministic design-system CSS derived from the approved Figma design
 * (ADR-0018 amendment).
 *
 * Measured on staging: an open 70B model receives the design context and still
 * substitutes its own greys. Rather than hope a model transcribes hex values
 * faithfully, the platform computes the design's palette, type scale and
 * spacing itself and appends this layer AFTER the agent's stylesheet, mapped
 * onto the document structure the code_change contract already guarantees
 * (header, sections in order, footer). Colour, type scale and section padding
 * therefore come from the design by construction, whatever the agent wrote;
 * the agent remains responsible for structure and layout.
 *
 * The override properties are marked !important deliberately: this layer is
 * the design's authority over an agent's guesses, and the set is deliberately
 * narrow (background, colour, font-family, font-size, padding, radius).
 */

export interface DesignTokens {
  /** CSS to append after the agent's stylesheet. */
  css: string;
  /** The resolved palette, for logging and review. */
  palette: {
    background: string;
    surface: string;
    ink: string;
    muted: string;
    accent: string;
    dark?: string;
    onDark?: string;
  };
  /** Distinct font sizes, largest first. */
  typeScale: number[];
  fontFamily?: string;
}

function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function saturation(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  const max = Math.max(...channels);
  const min = Math.min(...channels);
  return max === 0 ? 0 : (max - min) / max;
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** header/nav first, footer last, everything else a body section in order. */
function classifySections(sections: FigmaSectionSpec[]): {
  header?: FigmaSectionSpec;
  footer?: FigmaSectionSpec;
  body: FigmaSectionSpec[];
} {
  const rest = [...sections];
  const header = rest[0] && /nav|header|top ?bar/i.test(rest[0].name) ? rest.shift() : undefined;
  const footer =
    rest.length > 0 && /footer/i.test(rest[rest.length - 1]!.name) ? rest.pop() : undefined;
  return { ...(header ? { header } : {}), ...(footer ? { footer } : {}), body: rest };
}

export function buildDesignTokens(context: FigmaDesignContext): DesignTokens {
  const sections = context.sections;
  const backgrounds = sections.map((s) => s.background).filter((c): c is string => Boolean(c));
  const textColours = sections.flatMap((s) =>
    s.texts.map((t) => t.color).filter((c): c is string => Boolean(c)),
  );

  const lightBackgrounds = backgrounds.filter((c) => luminance(c) > 0.5);
  const darkBackgrounds = backgrounds.filter((c) => luminance(c) <= 0.5);
  const background = lightBackgrounds[0] ?? '#ffffff';
  const surface =
    lightBackgrounds.find((c) => c !== background && luminance(c) > luminance(background)) ??
    '#ffffff';
  const dark = darkBackgrounds.sort((a, b) => luminance(a) - luminance(b))[0];

  const darkText = [...textColours].sort((a, b) => luminance(a) - luminance(b));
  const ink = darkText[0] ?? '#1a1a1a';
  const muted = darkText.find((c) => c !== ink && luminance(c) < 0.6) ?? ink;
  // The accent is the most saturated colour anywhere in the design.
  const accent =
    [...textColours, ...backgrounds].sort((a, b) => saturation(b) - saturation(a))[0] ?? ink;
  const onDark = textColours.filter((c) => luminance(c) > 0.7)[0] ?? '#ffffff';

  const sizes = [...new Set(sections.flatMap((s) => s.texts.map((t) => t.fontSize ?? 0)))]
    .filter((size) => size > 0)
    .sort((a, b) => b - a);
  const fontFamily = sections.flatMap((s) => s.texts.map((t) => t.fontFamily)).find(Boolean);
  const [h1 = 48, h2 = 32, h3 = 22] = sizes;
  const body = sizes.find((size) => size <= 20) ?? 16;

  const padX = median(sections.map((s) => s.paddingX ?? 0).filter(Boolean)) ?? 48;
  const padY = median(sections.map((s) => s.paddingY ?? 0).filter(Boolean)) ?? 64;
  const gap = median(sections.map((s) => s.gap ?? 0).filter(Boolean)) ?? 24;
  const radius = sections.map((s) => s.cornerRadius ?? 0).find(Boolean) ?? 10;

  const { header, footer, body: bodySections } = classifySections(sections);
  const stack = (spec: FigmaSectionSpec | undefined, selector: string): string => {
    if (!spec) return '';
    const isDark = spec.background ? luminance(spec.background) <= 0.5 : false;
    return `${selector} {
  background-color: ${spec.background ?? 'transparent'} !important;
  ${isDark ? `color: ${onDark} !important;` : ''}
  padding: ${spec.paddingY ?? padY}px clamp(20px, 6vw, ${spec.paddingX ?? padX}px) !important;
}
${isDark ? `${selector} :is(h1,h2,h3,p,a,span,li) { color: ${onDark} !important; }` : ''}`;
  };

  // Descendant, not child: agents commonly wrap sections in <main>, and a
  // child selector then silently matches nothing (found on staging).
  const sectionRules = bodySections
    .map((spec, index) => stack(spec, `html body section:nth-of-type(${index + 1})`))
    .join('\n');

  const css = `
/* Design system derived from the approved Figma design: ${context.fileName}.
   Generated by Website Factory — the design's authority over generated CSS. */
:root {
  --wf-bg: ${background};
  --wf-surface: ${surface};
  --wf-ink: ${ink};
  --wf-muted: ${muted};
  --wf-accent: ${accent};
  ${dark ? `--wf-dark: ${dark};` : ''}
  --wf-on-dark: ${onDark};
  --wf-h1: ${h1}px;
  --wf-h2: ${h2}px;
  --wf-h3: ${h3}px;
  --wf-body: ${body}px;
  --wf-pad-x: ${padX}px;
  --wf-pad-y: ${padY}px;
  --wf-gap: ${gap}px;
  --wf-radius: ${radius}px;
}
html body {
  background-color: var(--wf-bg) !important;
  color: var(--wf-ink) !important;
  font-family: ${fontFamily ? `'${fontFamily}', ` : ''}ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif !important;
  font-size: var(--wf-body) !important;
  line-height: 1.6;
  margin: 0;
}
html body :is(h1, h2, h3) { color: var(--wf-ink) !important; line-height: 1.15; }
html body h1 { font-size: clamp(32px, 5vw, var(--wf-h1)) !important; }
html body h2 { font-size: clamp(24px, 3.5vw, var(--wf-h2)) !important; }
html body h3 { font-size: var(--wf-h3) !important; }
html body p, html body li { color: var(--wf-muted) !important; font-size: var(--wf-body) !important; }
${stack(header, 'html body header')}
${sectionRules}
${stack(footer, 'html body footer')}
/* Call-to-action styling from the design's accent colour. */
html body :is(a.btn, a.button, a.cta, .btn, .cta a, button) {
  background-color: var(--wf-accent) !important;
  color: #ffffff !important;
  border: 0 !important;
  border-radius: var(--wf-radius) !important;
  padding: 14px 26px !important;
  display: inline-block;
  text-decoration: none;
  font-weight: 650;
}
html body :is([class*='card'], article) {
  background-color: var(--wf-surface) !important;
  border-radius: var(--wf-radius) !important;
}
html body :focus-visible { outline: 2px solid var(--wf-accent); outline-offset: 2px; }
@media (max-width: 720px) {
  html body :is(header, section, footer) { padding-left: 20px !important; padding-right: 20px !important; }
}
`.trim();

  return {
    css,
    palette: {
      background,
      surface,
      ink,
      muted,
      accent,
      ...(dark ? { dark } : {}),
      onDark,
    },
    typeScale: sizes,
    ...(fontFamily ? { fontFamily } : {}),
  };
}
