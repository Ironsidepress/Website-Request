import { describe, expect, it } from 'vitest';

import { createPipelineRepository, tenantContext } from '@website-factory/db';

import {
  buildDesignTokens,
  DesignSystemExecutor,
  FigmaDesignReader,
  type AgentExecutor,
  type FigmaDesignContext,
} from '../src';
import { isoNow } from '../src/clock';
import { submittedProject } from './fixtures';
import { createTestWorld } from './helpers';

/** The palette and type scale of the real Charlie's Automotive design. */
const CONTEXT: FigmaDesignContext = {
  fileName: "Charlie's Automotive — Website Design v1",
  canvasWidth: 1440,
  sections: [
    {
      name: 'Nav',
      background: '#f9f6f0',
      layout: 'HORIZONTAL',
      paddingX: 96,
      paddingY: 24,
      gap: 32,
      texts: [
        {
          text: "Charlie's Automotive",
          fontFamily: 'Inter',
          fontSize: 20,
          fontWeight: 700,
          color: '#28231e',
        },
      ],
    },
    {
      name: 'Hero',
      background: '#f9f6f0',
      layout: 'VERTICAL',
      paddingX: 96,
      paddingY: 96,
      gap: 24,
      texts: [
        { text: 'FULL-SERVICE AUTO SHOP', fontSize: 14, fontWeight: 600, color: '#c4602d' },
        {
          text: 'Your one-stop shop',
          fontFamily: 'Inter',
          fontSize: 56,
          fontWeight: 700,
          color: '#28231e',
        },
        {
          text: 'We repair all makes and models.',
          fontSize: 19,
          fontWeight: 400,
          color: '#6b6056',
        },
      ],
    },
    {
      name: 'Services',
      background: '#ffffff',
      paddingX: 96,
      paddingY: 80,
      cornerRadius: 14,
      texts: [{ text: 'Whatever your car needs', fontSize: 36, fontWeight: 700, color: '#28231e' }],
    },
    {
      name: 'Contact CTA',
      background: '#261e19',
      paddingX: 96,
      paddingY: 88,
      texts: [{ text: 'Car trouble?', fontSize: 40, fontWeight: 700, color: '#ffffff' }],
    },
    { name: 'Footer', background: '#191411', paddingX: 96, paddingY: 28, texts: [] },
  ],
};

describe('deterministic design tokens (design beats model guesswork)', () => {
  it('derives the palette, type scale and spacing from the design', () => {
    const tokens = buildDesignTokens(CONTEXT);
    expect(tokens.palette).toMatchObject({
      background: '#f9f6f0',
      surface: '#ffffff',
      // Ink is the darkest TEXT colour in the design, not the darkest fill.
      ink: '#28231e',
      accent: '#c4602d',
      dark: '#191411',
      onDark: '#ffffff',
    });
    expect(tokens.typeScale.slice(0, 3)).toEqual([56, 40, 36]);
    expect(tokens.fontFamily).toBe('Inter');

    // Variables carry the design's own values.
    expect(tokens.css).toContain('--wf-bg: #f9f6f0');
    expect(tokens.css).toContain('--wf-accent: #c4602d');
    expect(tokens.css).toContain('--wf-h1: 56px');
    expect(tokens.css).toContain('--wf-radius: 14px');
  });

  it('maps design sections onto the document structure the contract guarantees', () => {
    const css = buildDesignTokens(CONTEXT).css;
    // Nav → header, Footer → footer, the rest are body sections in order.
    expect(css).toContain('html body header');
    expect(css).toContain('html body footer');
    expect(css).toMatch(/html body section:nth-of-type\(1\) \{[\s\S]*?#f9f6f0/);
    expect(css).toMatch(/html body section:nth-of-type\(2\) \{[\s\S]*?#ffffff/);
    // The dark CTA band flips text to the design's light colour.
    expect(css).toMatch(/html body section:nth-of-type\(3\) \{[\s\S]*?#261e19/);
    expect(css).toContain('#ffffff !important');
    // Overrides are deliberate: the design outranks the agent's own CSS.
    expect(css).toContain('background-color: var(--wf-bg) !important');
  });

  it('appends the design layer after the agent CSS so the design wins', async () => {
    const world = createTestWorld();
    const { org, projectId } = await submittedProject(world, 'tokens-a');
    const ctx = tenantContext(org.id);
    const pipeline = createPipelineRepository(world.services.db);
    await pipeline.createArtifactVersionIfAbsent(ctx, {
      artifactId: `${projectId}:figma_design`,
      version: 1,
      projectId,
      organizationId: org.id,
      type: 'figma_design',
      status: 'approved',
      storage: 'external_ref',
      content: null,
      externalRef: '{"provider":"figma","fileKey":"KEY"}',
      hasUnverifiedClaims: false,
      createdByType: 'agent',
      createdById: 'run-1',
      createdAt: isoNow(world.clock),
    });

    const agentCss = 'body{background:#f7f7f7}h1{color:#cccccc}';
    const inner: AgentExecutor = {
      async execute() {
        return {
          model: 'test',
          inputTokens: 1,
          outputTokens: 1,
          estimatedCostUsd: 0,
          content: {
            css: agentCss,
            pages: [{ path: '/', title: 'T', bodyHtml: '<section><h1>Hi</h1></section>' }],
            implementationNotes: ['generic greys, as models do'],
          },
        };
      },
    };
    const fetchImpl = (async () =>
      Response.json(
        {
          name: CONTEXT.fileName,
          document: {
            children: [
              {
                type: 'CANVAS',
                children: [
                  {
                    type: 'FRAME',
                    name: 'Root',
                    absoluteBoundingBox: { width: 1440 },
                    children: CONTEXT.sections.map((section) => ({
                      type: 'FRAME',
                      name: section.name,
                      ...(section.paddingX ? { paddingLeft: section.paddingX } : {}),
                      ...(section.paddingY ? { paddingTop: section.paddingY } : {}),
                      fills: section.background
                        ? [
                            {
                              type: 'SOLID',
                              color: {
                                r: parseInt(section.background.slice(1, 3), 16) / 255,
                                g: parseInt(section.background.slice(3, 5), 16) / 255,
                                b: parseInt(section.background.slice(5, 7), 16) / 255,
                              },
                            },
                          ]
                        : [],
                      children: section.texts.map((t) => ({
                        type: 'TEXT',
                        characters: t.text,
                        style: {
                          fontFamily: t.fontFamily,
                          fontSize: t.fontSize,
                          fontWeight: t.fontWeight,
                        },
                        fills: t.color
                          ? [
                              {
                                type: 'SOLID',
                                color: {
                                  r: parseInt(t.color.slice(1, 3), 16) / 255,
                                  g: parseInt(t.color.slice(3, 5), 16) / 255,
                                  b: parseInt(t.color.slice(5, 7), 16) / 255,
                                },
                              },
                            ]
                          : [],
                      })),
                    })),
                  },
                ],
              },
            ],
          },
        },
        { status: 200 },
      )) as typeof fetch;

    const executor = new DesignSystemExecutor({
      inner,
      db: world.services.db,
      reader: new FigmaDesignReader({ token: 't', fetchImpl }),
    });
    const execution = await executor.execute({
      projectId,
      organizationId: org.id,
      agentType: 'developer',
      contractVersion: 1,
      promptVersion: 'v2',
      inputArtifacts: [],
      outputArtifactType: 'code_change',
      idempotencyKey: 'k',
      attempt: 1,
    });

    const css = (execution.content as { css: string }).css;
    // The agent's CSS is preserved, with the design layer appended after it.
    expect(css.indexOf(agentCss)).toBe(0);
    expect(css).toContain('--wf-bg: #f9f6f0');
    expect(css.indexOf('--wf-bg')).toBeGreaterThan(css.indexOf('#f7f7f7'));
    // The applied design is recorded in the reviewable notes.
    expect(
      (execution.content as { implementationNotes: string[] }).implementationNotes.at(-1),
    ).toContain('Design system applied');
  });

  it('leaves generated code untouched when the design cannot be read', async () => {
    const world = createTestWorld();
    const { org, projectId } = await submittedProject(world, 'tokens-b');
    const reasons: string[] = [];
    const inner: AgentExecutor = {
      async execute() {
        return {
          model: 'test',
          inputTokens: 1,
          outputTokens: 1,
          estimatedCostUsd: 0,
          content: {
            css: 'body{}',
            pages: [{ path: '/', title: 'T', bodyHtml: '<section>x</section>' }],
            implementationNotes: [],
          },
        };
      },
    };
    const executor = new DesignSystemExecutor({
      inner,
      db: world.services.db,
      reader: new FigmaDesignReader({
        token: 't',
        fetchImpl: (async () => new Response('', { status: 500 })) as typeof fetch,
      }),
      onUnavailable: (_task, reason) => reasons.push(reason),
    });
    const execution = await executor.execute({
      projectId,
      organizationId: org.id,
      agentType: 'developer',
      contractVersion: 1,
      promptVersion: 'v2',
      inputArtifacts: [],
      outputArtifactType: 'code_change',
      idempotencyKey: 'k',
      attempt: 1,
    });
    // No approved design artifact at all: the run still succeeds.
    expect((execution.content as { css: string }).css).toBe('body{}');
    expect(reasons[0]).toContain('no Figma file key');
  });
});
