/**
 * Reads the approved Figma design so the developer agent can implement THAT
 * design rather than inventing a layout from the creative brief (ADR-0018
 * amendment).
 *
 * Figma's REST API can read files with a personal access token — the gating
 * that blocks authoring (ADR-0017) does not apply to reads. The file tree is
 * distilled into a compact, bounded spec: section order, backgrounds, layout
 * direction/padding/spacing, and each text run with its font, size, weight and
 * colour. That is what a developer needs to reproduce a design in HTML/CSS,
 * and it stays small enough to fit an agent prompt.
 */

export interface FigmaTextRun {
  text: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
}

export interface FigmaSectionSpec {
  name: string;
  background?: string;
  /** 'VERTICAL' | 'HORIZONTAL' when the frame uses auto-layout. */
  layout?: string;
  paddingX?: number;
  paddingY?: number;
  gap?: number;
  /** Rounded corners on child cards, when present. */
  cornerRadius?: number;
  texts: FigmaTextRun[];
}

export interface FigmaDesignContext {
  fileName: string;
  /** Width of the top-level frame, e.g. 1440 for a desktop design. */
  canvasWidth?: number;
  sections: FigmaSectionSpec[];
}

export interface FigmaDesignReaderConfig {
  /** Figma personal access token (read scope is enough). */
  token: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Guardrails so a huge design cannot blow up an agent prompt. */
  maxSections?: number;
  maxTextsPerSection?: number;
}

interface FigmaNode {
  type?: string;
  name?: string;
  characters?: string;
  layoutMode?: string;
  paddingLeft?: number;
  paddingTop?: number;
  itemSpacing?: number;
  cornerRadius?: number;
  absoluteBoundingBox?: { width?: number };
  style?: { fontFamily?: string; fontSize?: number; fontWeight?: number };
  fills?: Array<{ type?: string; color?: { r: number; g: number; b: number }; visible?: boolean }>;
  children?: FigmaNode[];
}

const MAX_TEXT_LENGTH = 300;

function toHex(color: { r: number; g: number; b: number }): string {
  const channel = (value: number) =>
    Math.round(Math.max(0, Math.min(1, value)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

function solidFill(node: FigmaNode): string | undefined {
  const fill = node.fills?.find((f) => f.type === 'SOLID' && f.visible !== false);
  return fill?.color ? toHex(fill.color) : undefined;
}

function collectTexts(node: FigmaNode, out: FigmaTextRun[], limit: number): void {
  if (out.length >= limit) return;
  if (node.type === 'TEXT' && node.characters?.trim()) {
    out.push({
      text: node.characters.slice(0, MAX_TEXT_LENGTH),
      ...(node.style?.fontFamily ? { fontFamily: node.style.fontFamily } : {}),
      ...(node.style?.fontSize ? { fontSize: Math.round(node.style.fontSize) } : {}),
      ...(node.style?.fontWeight ? { fontWeight: node.style.fontWeight } : {}),
      ...(solidFill(node) ? { color: solidFill(node) } : {}),
    });
  }
  for (const child of node.children ?? []) collectTexts(child, out, limit);
}

/** First rounded child gives the design's card radius, if it uses cards. */
function findCornerRadius(node: FigmaNode, depth = 0): number | undefined {
  if (depth > 3) return undefined;
  for (const child of node.children ?? []) {
    if (typeof child.cornerRadius === 'number' && child.cornerRadius > 0) return child.cornerRadius;
    const nested = findCornerRadius(child, depth + 1);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export class FigmaDesignReader {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: FigmaDesignReaderConfig) {
    // Keep the global fetch bound (Workers throws on detached references).
    this.fetchImpl = config.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  async readDesignContext(fileKey: string): Promise<FigmaDesignContext> {
    const response = await this.fetchImpl(
      `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}?depth=6`,
      { headers: { 'x-figma-token': this.config.token } },
    );
    if (!response.ok) {
      throw new Error(`figma file read failed with ${response.status}`);
    }
    const file = (await response.json()) as { name?: string; document?: FigmaNode };
    const canvas = file.document?.children?.[0];
    const frame = canvas?.children?.[0];
    if (!frame) throw new Error('figma file has no top-level frame to implement');

    const maxSections = this.config.maxSections ?? 12;
    const maxTexts = this.config.maxTextsPerSection ?? 12;

    // A design may be one frame of stacked sections (our generator's shape) or
    // a canvas of sibling frames; treat the frame's children as sections when
    // it has them, else the frame itself as a single section.
    const candidates = (frame.children ?? []).filter(
      (child) => child.type === 'FRAME' || child.type === 'GROUP' || child.type === 'SECTION',
    );
    const sectionNodes = candidates.length > 0 ? candidates.slice(0, maxSections) : [frame];

    const sections: FigmaSectionSpec[] = sectionNodes.map((node) => {
      const texts: FigmaTextRun[] = [];
      collectTexts(node, texts, maxTexts);
      const radius = findCornerRadius(node);
      return {
        name: node.name ?? 'section',
        ...(solidFill(node) ? { background: solidFill(node) } : {}),
        ...(node.layoutMode ? { layout: node.layoutMode } : {}),
        ...(node.paddingLeft ? { paddingX: Math.round(node.paddingLeft) } : {}),
        ...(node.paddingTop ? { paddingY: Math.round(node.paddingTop) } : {}),
        ...(node.itemSpacing ? { gap: Math.round(node.itemSpacing) } : {}),
        ...(radius ? { cornerRadius: Math.round(radius) } : {}),
        texts,
      };
    });

    return {
      fileName: file.name ?? 'design',
      ...(frame.absoluteBoundingBox?.width
        ? { canvasWidth: Math.round(frame.absoluteBoundingBox.width) }
        : {}),
      sections,
    };
  }
}
