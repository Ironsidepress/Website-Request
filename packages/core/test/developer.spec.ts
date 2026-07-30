import { describe, expect, it } from 'vitest';

import { createPipelineRepository, tenantContext } from '@website-factory/db';

import {
  AGENT_SPECS,
  AgentDispatcher,
  assembleGeneratedPage,
  createAgentInputLoader,
  filePathFor,
  GitHubPublishingExecutor,
  GitHubRestClient,
  repoNameFor,
  SimulatedExecutor,
  WorkersAiExecutor,
  type AgentExecutor,
  type AgentTask,
  type GitHubClient,
} from '../src';
import { isoNow } from '../src/clock';
import { submittedProject } from './fixtures';
import { createTestWorld } from './helpers';

const VALID_CODE = {
  css: ':root{--ink:#222}body{margin:0;font-family:system-ui}.hero{padding:6vh 6vw}',
  pages: [
    {
      path: '/',
      title: "Charlie's Automotive",
      bodyHtml:
        '<header><nav><a href="/services">Services</a></nav></header><section class="hero"><h1>Your one-stop shop</h1><p>We repair all makes and models.</p></section><footer>Charlie\'s Automotive</footer>',
    },
    {
      path: '/services',
      title: 'Services',
      bodyHtml:
        '<section class="hero"><h1>Services</h1><p>Mechanical, tires, electrical.</p></section>',
    },
  ],
  implementationNotes: ['Mobile-first layout', 'No remote assets'],
};

const TASK: AgentTask = {
  projectId: 'proj-abcdef12-3456',
  organizationId: 'org-1',
  agentType: 'developer',
  contractVersion: 1,
  promptVersion: 'v1-simulated',
  inputArtifacts: [],
  outputArtifactType: 'code_change',
  idempotencyKey: 'wf:development:1:agent',
  attempt: 1,
};

/** Records every GitHub call so ordering and idempotency are observable. */
function fakeGitHub(): { calls: string[]; client: GitHubClient } {
  const calls: string[] = [];
  return {
    calls,
    client: {
      async ensureRepo(name) {
        calls.push(`ensureRepo:${name}`);
        return {
          fullName: `ironsidepress/${name}`,
          htmlUrl: `https://github.com/ironsidepress/${name}`,
          defaultBranch: 'main',
        };
      },
      async ensureBranch(fullName, branch, from) {
        calls.push(`ensureBranch:${branch}:from=${from}`);
      },
      async putFile(fullName, branch, file) {
        calls.push(`putFile:${file.path}@${branch}`);
      },
      async ensurePullRequest(fullName, input) {
        calls.push(`pr:${input.head}->${input.base}`);
        return { number: 7, htmlUrl: `https://github.com/${fullName}/pull/7` };
      },
    },
  };
}

const generating: AgentExecutor = {
  async execute() {
    return {
      model: 'test-model',
      promptVersion: 'developer-v1-static-html',
      inputTokens: 900,
      outputTokens: 1_200,
      estimatedCostUsd: 0.01,
      content: VALID_CODE,
    };
  },
};

describe('developer agent (M19)', () => {
  it('accepts a valid code change and rejects unsafe or empty markup', () => {
    const spec = AGENT_SPECS.developer!;
    const accepted = spec.validate(VALID_CODE);
    expect(accepted.hasUnverifiedClaims).toBe(false);
    expect(accepted.content).toMatchObject({ implementationNotes: VALID_CODE.implementationNotes });

    // Scripts, handlers, forms and document tags are contract violations —
    // a failed run, never a sanitize-and-ship.
    for (const bodyHtml of [
      '<section><script>alert(1)</script></section>',
      '<button onclick="x()">Go</button>',
      '<form action="/x"><input></form>',
      '<body><h1>Hi</h1></body>',
      '<a href="javascript:alert(1)">x</a>',
    ]) {
      expect(() =>
        spec.validate({ ...VALID_CODE, pages: [{ path: '/', title: 'T', bodyHtml }] }),
      ).toThrow(/rejected/);
    }
    // Remote CSS resources are rejected too.
    expect(() =>
      spec.validate({ ...VALID_CODE, css: '@import url("https://fonts.example/x.css");' }),
    ).toThrow(/remote resources/);
    // No pages at all is a failed run.
    expect(() => spec.validate({ ...VALID_CODE, pages: [] })).toThrow(/no pages/);
    // Unknown fields / wrong shapes fail schema validation.
    expect(() => spec.validate({ css: 'x', pages: [], implementationNotes: [], extra: 1 })).toThrow(
      /schema validation/,
    );
  });

  it('requires an approved design before implementing', async () => {
    const world = createTestWorld();
    const { org, projectId } = await submittedProject(world, 'dev-a');
    const ctx = tenantContext(org.id);
    const pipeline = createPipelineRepository(world.services.db);
    const load = createAgentInputLoader(world.services.db);
    const task = { ...TASK, projectId, organizationId: org.id };

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

    // No design yet.
    await expect(load(task)).rejects.toThrow(/figma_design artifact missing/);

    await pipeline.createArtifactVersionIfAbsent(ctx, {
      artifactId: `${projectId}:figma_design`,
      version: 1,
      projectId,
      organizationId: org.id,
      type: 'figma_design',
      status: 'draft',
      storage: 'external_ref',
      content: null,
      externalRef: '{"provider":"figma","reviewUrl":"https://figma.com/design/x"}',
      hasUnverifiedClaims: false,
      createdByType: 'agent',
      createdById: 'run-2',
      createdAt: now,
    });

    // Present but not approved — the project rule blocks the run.
    await expect(load(task)).rejects.toThrow(/is draft, not approved/);

    await pipeline.setArtifactStatus(ctx, `${projectId}:figma_design`, 1, 'approved');
    const inputs = await load(task);
    expect(inputs).toMatchObject({
      contentPlan: { ok: true },
      creativeBrief: { ok: true },
      // External-ref artifacts contribute their reference, not a fake body.
      approvedDesign: { provider: 'figma', reviewUrl: 'https://figma.com/design/x' },
    });
  });

  it('publishes generated code to a per-project repo branch and opens a pull request', async () => {
    const github = fakeGitHub();
    const recorded: Array<{ projectId: string; fullName: string }> = [];
    const executor = new GitHubPublishingExecutor({
      inner: generating,
      github: github.client,
      recordRepo: async (task, repo) => {
        recorded.push({ projectId: task.projectId, fullName: repo.fullName });
      },
    });

    const execution = await executor.execute(TASK);
    const repo = repoNameFor(TASK);
    expect(github.calls).toEqual([
      `ensureRepo:${repo}`,
      'ensureBranch:site/attempt-1:from=main',
      'putFile:index.html@site/attempt-1',
      'putFile:services/index.html@site/attempt-1',
      'putFile:styles.css@site/attempt-1',
      'pr:site/attempt-1->main',
    ]);
    expect(recorded).toEqual([{ projectId: TASK.projectId, fullName: `ironsidepress/${repo}` }]);
    expect(execution.externalRef).toMatchObject({
      provider: 'github',
      branch: 'site/attempt-1',
      pullRequest: 7,
      reviewUrl: `https://github.com/ironsidepress/${repo}/pull/7`,
    });
    // The generated code is still the artifact body — previews never depend
    // on GitHub being reachable.
    expect(execution.content).toMatchObject({ css: VALID_CODE.css });

    // A rework attempt gets its own branch and pull request.
    github.calls.length = 0;
    await executor.execute({ ...TASK, attempt: 2 });
    expect(github.calls).toContain('ensureBranch:site/attempt-2:from=main');
    expect(github.calls).toContain('pr:site/attempt-2->main');
  });

  it('reuses an existing pull request and never targets a branch it did not create', async () => {
    const requests: string[] = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const target = `${init?.method ?? 'GET'} ${String(url).replace('https://api.github.com', '')}`;
      requests.push(target);
      if (target.startsWith('GET /repos/acme/site-x/pulls?state=open')) {
        return Response.json([{ number: 3, html_url: 'https://github.com/acme/site-x/pull/3' }], {
          status: 200,
        });
      }
      if (target.startsWith('POST /repos/acme/site-x/pulls')) {
        return Response.json({ message: 'A pull request already exists' }, { status: 422 });
      }
      if (target === 'GET /repos/acme/site-x') {
        return Response.json(
          {
            full_name: 'acme/site-x',
            html_url: 'https://github.com/acme/site-x',
            default_branch: 'main',
          },
          { status: 200 },
        );
      }
      return Response.json({}, { status: 200 });
    }) as typeof fetch;

    const client = new GitHubRestClient({ token: 'tok', owner: 'acme', fetchImpl });
    const pr = await client.ensurePullRequest('acme/site-x', {
      head: 'site/attempt-1',
      base: 'main',
      title: 't',
      body: 'b',
    });
    expect(pr).toEqual({ number: 3, htmlUrl: 'https://github.com/acme/site-x/pull/3' });
    expect(requests.some((r) => r.includes('head=acme%3Asite%2Fattempt-1'))).toBe(true);
  });

  it('assembles the generated page inside a platform-controlled document shell', () => {
    const page = assembleGeneratedPage({
      businessName: "Charlie's Automotive",
      code: VALID_CODE,
      path: '/',
    });
    expect(page?.html).toContain('<!doctype html>');
    expect(page?.html).toContain('noindex');
    expect(page?.html).toContain('wf-preview-banner');
    expect(page?.html).toContain('Your one-stop shop');
    expect(page?.html).toContain('--ink:#222');
    // Second page is reachable by path; unknown paths render nothing.
    expect(
      assembleGeneratedPage({ businessName: 'X', code: VALID_CODE, path: '/services' })?.title,
    ).toBe('Services');
    expect(
      assembleGeneratedPage({ businessName: 'X', code: VALID_CODE, path: '/nope' }),
    ).toBeNull();
    expect(
      assembleGeneratedPage({ businessName: 'X', code: { simulated: true }, path: '/' }),
    ).toBeNull();

    // Defence in depth: markup that somehow reached storage is still scrubbed.
    const hostile = assembleGeneratedPage({
      businessName: 'X',
      code: {
        ...VALID_CODE,
        pages: [
          {
            path: '/',
            title: 'T',
            bodyHtml: '<div onclick="steal()">hi</div><script>steal()</script>',
          },
        ],
      },
      path: '/',
    });
    expect(hostile?.html).not.toContain('<script');
    expect(hostile?.html).not.toContain('onclick');
  });

  it('stores code and the pull-request reference on one artifact version', async () => {
    const world = createTestWorld();
    const { org, projectId } = await submittedProject(world, 'dev-b');
    const github = fakeGitHub();
    const dispatcher = new AgentDispatcher(
      world.services.db,
      world.clock,
      new SimulatedExecutor(),
      {
        developer: new GitHubPublishingExecutor({ inner: generating, github: github.client }),
      },
    );
    await dispatcher.run({ ...TASK, projectId, organizationId: org.id });

    const ctx = tenantContext(org.id);
    const artifact = await createPipelineRepository(world.services.db).latestArtifact(
      ctx,
      projectId,
      'code_change',
    );
    expect(artifact).toMatchObject({ storage: 'external_ref' });
    expect(JSON.parse(artifact!.content ?? '{}')).toMatchObject({ css: VALID_CODE.css });
    expect(JSON.parse(artifact!.externalRef ?? '{}')).toMatchObject({ provider: 'github' });
  });

  it('routes site paths to conventional file paths', () => {
    expect(filePathFor('/')).toBe('index.html');
    expect(filePathFor('/services')).toBe('services/index.html');
    expect(filePathFor('/About Us/')).toBe('about-us/index.html');
  });

  it('generates through the shared spec on Workers AI', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const executor = new WorkersAiExecutor({
      ai: {
        async run(_model, options) {
          calls.push(options);
          return { response: VALID_CODE, usage: { prompt_tokens: 800, completion_tokens: 1_500 } };
        },
      },
      inputLoader: async () => ({ contentPlan: { ok: true } }),
    });
    const execution = await executor.execute(TASK);
    expect(execution.promptVersion).toBe('developer-v1-static-html');
    expect(execution.content).toMatchObject({ css: VALID_CODE.css });
    expect(
      String((calls[0] as { messages: Array<{ content: string }> }).messages[0]!.content),
    ).toContain('developer agent');
  });
});
