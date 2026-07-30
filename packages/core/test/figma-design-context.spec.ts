import { describe, expect, it } from 'vitest';

import { createPipelineRepository, tenantContext } from '@website-factory/db';

import { createAgentInputLoader, FigmaDesignReader } from '../src';
import { isoNow } from '../src/clock';
import { submittedProject } from './fixtures';
import { createTestWorld } from './helpers';

/** Shape of a real Figma file response, trimmed to what the reader uses. */
const FIGMA_FILE = {
  name: "Charlie's Automotive — Website Design v1",
  document: {
    type: 'DOCUMENT',
    children: [
      {
        type: 'CANVAS',
        name: 'Page 1',
        children: [
          {
            type: 'FRAME',
            name: 'Homepage — Desktop 1440',
            absoluteBoundingBox: { width: 1440, height: 1814 },
            fills: [{ type: 'SOLID', color: { r: 0.976, g: 0.965, b: 0.941 } }],
            children: [
              {
                type: 'FRAME',
                name: 'Hero',
                layoutMode: 'VERTICAL',
                paddingLeft: 96,
                paddingTop: 96,
                itemSpacing: 24,
                fills: [{ type: 'SOLID', color: { r: 0.976, g: 0.965, b: 0.941 } }],
                children: [
                  {
                    type: 'TEXT',
                    characters: 'Your one-stop shop for all car-related problems',
                    style: { fontFamily: 'Inter', fontSize: 56, fontWeight: 700 },
                    fills: [{ type: 'SOLID', color: { r: 0.16, g: 0.14, b: 0.12 } }],
                  },
                ],
              },
              {
                type: 'FRAME',
                name: 'Services',
                layoutMode: 'VERTICAL',
                fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }],
                children: [
                  {
                    type: 'FRAME',
                    name: 'Card: Mechanical',
                    cornerRadius: 14,
                    children: [
                      {
                        type: 'TEXT',
                        characters: 'Mechanical',
                        style: { fontFamily: 'Inter', fontSize: 22, fontWeight: 600 },
                        fills: [{ type: 'SOLID', color: { r: 0.16, g: 0.14, b: 0.12 } }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

function fakeFigma(respond: (url: string) => Response): {
  urls: string[];
  headers: Array<Record<string, string>>;
  fetchImpl: typeof fetch;
} {
  const urls: string[] = [];
  const headers: Array<Record<string, string>> = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    urls.push(String(url));
    headers.push((init?.headers ?? {}) as Record<string, string>);
    return respond(String(url));
  }) as typeof fetch;
  return { urls, headers, fetchImpl };
}

describe('Figma design context (developer agent implements the approved design)', () => {
  it('distils sections, palette, type scale and spacing from the file tree', async () => {
    const server = fakeFigma(() => Response.json(FIGMA_FILE, { status: 200 }));
    const reader = new FigmaDesignReader({ token: 'figd_test', fetchImpl: server.fetchImpl });

    const context = await reader.readDesignContext('FILEKEY123');
    expect(server.urls[0]).toContain('/v1/files/FILEKEY123');
    expect(server.headers[0]!['x-figma-token']).toBe('figd_test');

    expect(context.fileName).toContain("Charlie's Automotive");
    expect(context.canvasWidth).toBe(1440);
    expect(context.sections.map((s) => s.name)).toEqual(['Hero', 'Services']);

    const hero = context.sections[0]!;
    expect(hero).toMatchObject({
      background: '#f9f6f0',
      layout: 'VERTICAL',
      paddingX: 96,
      paddingY: 96,
      gap: 24,
    });
    expect(hero.texts[0]).toEqual({
      text: 'Your one-stop shop for all car-related problems',
      fontFamily: 'Inter',
      fontSize: 56,
      fontWeight: 700,
      color: '#29241f',
    });

    // Card radius is discovered from nested children, background from the frame.
    expect(context.sections[1]).toMatchObject({ background: '#ffffff', cornerRadius: 14 });
  });

  it('caps what it extracts so a large design cannot flood the prompt', async () => {
    const many = {
      name: 'big',
      document: {
        children: [
          {
            type: 'CANVAS',
            children: [
              {
                type: 'FRAME',
                name: 'Root',
                children: Array.from({ length: 30 }, (_, index) => ({
                  type: 'FRAME',
                  name: `Section ${index}`,
                  children: Array.from({ length: 30 }, (_, textIndex) => ({
                    type: 'TEXT',
                    characters: `t${textIndex}`.padEnd(500, 'x'),
                  })),
                })),
              },
            ],
          },
        ],
      },
    };
    const server = fakeFigma(() => Response.json(many, { status: 200 }));
    const context = await new FigmaDesignReader({
      token: 't',
      fetchImpl: server.fetchImpl,
      maxSections: 4,
      maxTextsPerSection: 3,
    }).readDesignContext('k');

    expect(context.sections).toHaveLength(4);
    expect(context.sections[0]!.texts).toHaveLength(3);
    expect(context.sections[0]!.texts[0]!.text.length).toBeLessThanOrEqual(300);
  });

  it('surfaces read failures without crashing the developer run', async () => {
    const failing = fakeFigma(() => Response.json({ err: 'Not found' }, { status: 404 }));
    await expect(
      new FigmaDesignReader({ token: 't', fetchImpl: failing.fetchImpl }).readDesignContext('k'),
    ).rejects.toThrow(/404/);

    const empty = fakeFigma(() => Response.json({ name: 'x', document: {} }, { status: 200 }));
    await expect(
      new FigmaDesignReader({ token: 't', fetchImpl: empty.fetchImpl }).readDesignContext('k'),
    ).rejects.toThrow(/no top-level frame/);
  });

  it('adds the design context to the developer agent inputs, degrading truthfully', async () => {
    const world = createTestWorld();
    const { org, projectId } = await submittedProject(world, 'design-ctx');
    const ctx = tenantContext(org.id);
    const pipeline = createPipelineRepository(world.services.db);
    const now = isoNow(world.clock);

    for (const [type, content] of [
      ['content_plan', '{"ok":true}'],
      ['creative_brief', '{"ok":true}'],
    ] as const) {
      await pipeline.createArtifactVersionIfAbsent(ctx, {
        artifactId: `${projectId}:${type}`,
        version: 1,
        projectId,
        organizationId: org.id,
        type,
        status: 'draft',
        storage: 'inline',
        content,
        hasUnverifiedClaims: false,
        createdByType: 'agent',
        createdById: 'run-1',
        createdAt: now,
      });
    }
    await pipeline.createArtifactVersionIfAbsent(ctx, {
      artifactId: `${projectId}:figma_design`,
      version: 1,
      projectId,
      organizationId: org.id,
      type: 'figma_design',
      status: 'draft',
      storage: 'external_ref',
      content: null,
      externalRef: '{"provider":"figma","fileKey":"FILEKEY123","reviewUrl":"https://figma.com/x"}',
      hasUnverifiedClaims: false,
      createdByType: 'agent',
      createdById: 'run-2',
      createdAt: now,
    });
    await pipeline.setArtifactStatus(ctx, `${projectId}:figma_design`, 1, 'approved');

    const task = {
      projectId,
      organizationId: org.id,
      agentType: 'developer',
      contractVersion: 1,
      promptVersion: 'v1',
      inputArtifacts: [],
      outputArtifactType: 'code_change',
      idempotencyKey: 'k',
      attempt: 1,
    };

    const ok = fakeFigma(() => Response.json(FIGMA_FILE, { status: 200 }));
    const inputs = await createAgentInputLoader(world.services.db, {
      designReader: new FigmaDesignReader({ token: 't', fetchImpl: ok.fetchImpl }),
    })(task);
    expect((inputs.designContext as { sections: unknown[] }).sections).toHaveLength(2);
    expect(inputs.designContextUnavailable).toBeUndefined();

    // A Figma outage must not fail the stage: the agent is told instead, so its
    // implementation notes can say it worked from the brief alone.
    const down = fakeFigma(() => Response.json({}, { status: 500 }));
    const degraded = await createAgentInputLoader(world.services.db, {
      designReader: new FigmaDesignReader({ token: 't', fetchImpl: down.fetchImpl }),
    })(task);
    expect(degraded.designContext).toBeUndefined();
    expect(String(degraded.designContextUnavailable)).toContain('500');

    // Without a reader configured at all, inputs stay as before.
    const bare = await createAgentInputLoader(world.services.db)(task);
    expect(bare.designContext).toBeUndefined();
    expect(bare.designContextUnavailable).toBeUndefined();
  });
});
