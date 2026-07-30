import { describe, expect, it } from 'vitest';

import { createPipelineRepository, tenantContext } from '@website-factory/db';

import { PreviewDeployExecutor, renderPreviewSite, SimulatedExecutor } from '../src';
import { submittedProject } from './fixtures';
import { createTestWorld } from './helpers';

const CONTENT_PLAN = {
  strategySummary: 'Craft-led strategy.',
  sitemap: [{ path: '/', title: 'Home', purpose: 'Convert visitors' }],
  pages: [
    {
      path: '/',
      sections: [
        {
          heading: 'Letterpress, made by hand',
          intent: 'Hero',
          draftCopy: 'Every sheet pressed in our studio (source: client_intake).',
        },
        {
          heading: 'Why couples choose us',
          intent: 'Trust',
          draftCopy: 'Premium cotton papers and honest timelines (source: unverified).',
        },
      ],
      callToAction: 'Request a quote',
    },
  ],
  seoKeywords: ['letterpress'],
  sourceLog: [{ claim: 'x', source: 'client_intake', confidence: 'high' }],
};

const CREATIVE_BRIEF = {
  directionSummary: 'Quiet craftsmanship.',
  brandPersonality: ['crafted'],
  toneOfVoice: 'warm',
  visualDirection: {
    mood: ['tactile'],
    colorDirection: 'warm neutrals with a rust accent',
    typographyDirection: 'humanist',
    imageryDirection: 'close-up press photography',
  },
  layoutPrinciples: ['portfolio-first'],
  avoid: ['stock photography'],
};

describe('preview rendering and deployment (M18)', () => {
  it('renders a self-contained site from the content plan, stripping source annotations', () => {
    const html = renderPreviewSite({
      businessName: 'Ironside Press',
      contentPlan: CONTENT_PLAN,
      creativeBrief: CREATIVE_BRIEF,
    });
    expect(html).toBeTruthy();
    expect(html).toContain('Ironside Press');
    expect(html).toContain('Letterpress, made by hand');
    expect(html).toContain('Request a quote');
    // Reviewer-facing source annotations never reach the rendered site.
    expect(html).not.toContain('(source:');
    // Warm color direction selects the warm palette.
    expect(html).toContain('#c4622d');
    expect(html).toContain('noindex');
  });

  it('refuses to render simulated or malformed plans', () => {
    expect(renderPreviewSite({ businessName: 'X', contentPlan: { simulated: true } })).toBeNull();
    expect(renderPreviewSite({ businessName: 'X', contentPlan: null })).toBeNull();
  });

  it('mints a tokenized preview URL and falls back for other project_manager tasks', async () => {
    const executor = new PreviewDeployExecutor({
      baseUrl: 'https://app.example.com',
      fallback: new SimulatedExecutor(),
      randomToken: () => 'tok-123',
    });
    const preview = await executor.execute({
      projectId: 'proj-1',
      organizationId: 'org-1',
      agentType: 'project_manager',
      contractVersion: 1,
      promptVersion: 'v1-simulated',
      inputArtifacts: [],
      outputArtifactType: 'preview_deployment',
      idempotencyKey: 'wf:preview_deploy:1:agent',
      attempt: 1,
    });
    expect(preview.model).toBe('platform-preview');
    expect(preview.externalRef).toMatchObject({
      provider: 'platform',
      token: 'tok-123',
      reviewUrl: 'https://app.example.com/preview/proj-1?t=tok-123',
    });

    const production = await executor.execute({
      projectId: 'proj-1',
      organizationId: 'org-1',
      agentType: 'project_manager',
      contractVersion: 1,
      promptVersion: 'v1-simulated',
      inputArtifacts: [],
      outputArtifactType: 'production_deployment',
      idempotencyKey: 'wf:production_deploy:1:agent',
      attempt: 1,
    });
    expect(production.model).toBe('simulated');
  });

  it('dispatcher stores the preview as an external-ref artifact with the review URL', async () => {
    const world = createTestWorld();
    const { org, projectId } = await submittedProject(world, 'preview-a');
    const { AgentDispatcher } = await import('../src');
    const dispatcher = new AgentDispatcher(
      world.services.db,
      world.clock,
      new SimulatedExecutor(),
      {
        project_manager: new PreviewDeployExecutor({
          baseUrl: 'https://app.example.com',
          fallback: new SimulatedExecutor(),
          randomToken: () => 'tok-pipeline',
        }),
      },
    );
    await dispatcher.run({
      projectId,
      organizationId: org.id,
      agentType: 'project_manager',
      contractVersion: 1,
      promptVersion: 'v1-simulated',
      inputArtifacts: [],
      outputArtifactType: 'preview_deployment',
      idempotencyKey: 'wf-preview-a:preview_deploy:1:agent',
      attempt: 1,
    });

    const pipeline = createPipelineRepository(world.services.db);
    const ctx = tenantContext(org.id);
    const artifact = await pipeline.latestArtifact(ctx, projectId, 'preview_deployment');
    expect(artifact).toMatchObject({ storage: 'external_ref' });
    expect(JSON.parse(artifact!.externalRef ?? '{}')).toMatchObject({
      provider: 'platform',
      token: 'tok-pipeline',
      reviewUrl: `https://app.example.com/preview/${projectId}?t=tok-pipeline`,
    });
  });
});
