import { describe, expect, it } from 'vitest';

import { createPipelineRepository, tenantContext } from '@website-factory/db';

import {
  ClaudeExecutor,
  createIntakeInputLoader,
  InMemoryStepRunner,
  RESEARCH_PROMPT_VERSION,
  SimulatedExecutor,
  runPipeline,
} from '../src';
import { submittedProject } from './fixtures';
import { createTestWorld } from './helpers';

const VALID_OUTPUT = {
  summary: 'Ironside Press is a letterpress print shop serving local wedding clients.',
  audienceInsights: ['Engaged couples value tactile, premium stationery.'],
  competitorNotes: [],
  recommendations: ['Lead with a portfolio gallery and a simple inquiry form.'],
  sourceLog: [
    {
      claim: 'The business is a letterpress print shop.',
      source: 'client_intake',
      confidence: 'high',
    },
    {
      claim: 'Letterpress buyers respond to tactile samples.',
      source: 'unverified',
      confidence: 'medium',
    },
  ],
};

interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Canned Anthropic Messages API. */
function fakeAnthropic(respond: (body: Record<string, unknown>) => Record<string, unknown>): {
  requests: RecordedRequest[];
  fetchImpl: typeof fetch;
} {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(
      init?.headers instanceof Headers
        ? init.headers.entries()
        : Object.entries((init?.headers ?? {}) as Record<string, string>),
    );
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ url: String(url), headers, body });
    return new Response(JSON.stringify(respond(body)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { requests, fetchImpl };
}

function message(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'msg_test_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content: [{ type: 'text', text: JSON.stringify(VALID_OUTPUT) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 2_000, output_tokens: 900 },
    ...overrides,
  };
}

const TASK = {
  projectId: 'proj-1',
  organizationId: 'org-1',
  agentType: 'research',
  contractVersion: 1,
  promptVersion: 'v1-simulated',
  inputArtifacts: [],
  outputArtifactType: 'research_report',
  idempotencyKey: 'wf:research:1:agent',
  attempt: 1,
};

describe('ClaudeExecutor (real research agent)', () => {
  it('produces a validated report with real usage, cost and the claims flag', async () => {
    const server = fakeAnthropic(() => message());
    const executor = new ClaudeExecutor({
      apiKey: 'test-key',
      fetchImpl: server.fetchImpl,
      inputLoader: async () => ({ business: { displayName: 'Ironside Press' } }),
    });

    const execution = await executor.execute(TASK);
    expect(execution.model).toBe('claude-opus-5');
    expect(execution.promptVersion).toBe(RESEARCH_PROMPT_VERSION);
    expect(execution.inputTokens).toBe(2_000);
    expect(execution.outputTokens).toBe(900);
    // 2000 × $5/MTok + 900 × $25/MTok
    expect(execution.estimatedCostUsd).toBeCloseTo(0.0325, 6);
    expect(execution.hasUnverifiedClaims).toBe(true);
    expect(execution.content).toMatchObject({ summary: VALID_OUTPUT.summary });

    // Request shape: structured output, refusal fallback opt-in, intake in prompt.
    const request = server.requests[0]!;
    expect(request.headers['x-api-key']).toBe('test-key');
    expect(request.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    expect(request.body.fallbacks).toBe('default');
    const outputConfig = request.body.output_config as {
      format: { type: string; schema: Record<string, unknown> };
    };
    expect(outputConfig.format.type).toBe('json_schema');
    expect(JSON.stringify(request.body.messages)).toContain('Ironside Press');
  });

  it('treats schema-invalid output and refusals as failed runs', async () => {
    const badServer = fakeAnthropic(() =>
      message({ content: [{ type: 'text', text: JSON.stringify({ summary: 'no source log' }) }] }),
    );
    const badExecutor = new ClaudeExecutor({
      apiKey: 'k',
      fetchImpl: badServer.fetchImpl,
      inputLoader: async () => ({}),
    });
    await expect(badExecutor.execute(TASK)).rejects.toThrow(/schema validation/);

    const refusingServer = fakeAnthropic(() =>
      message({
        content: [],
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: null, explanation: null },
      }),
    );
    const refusingExecutor = new ClaudeExecutor({
      apiKey: 'k',
      fetchImpl: refusingServer.fetchImpl,
      inputLoader: async () => ({}),
    });
    await expect(refusingExecutor.execute(TASK)).rejects.toThrow(/declined/);
  });

  it('runs inside the pipeline: real research artifact, claims flag, true prompt version', async () => {
    const world = createTestWorld();
    const { org, projectId } = await submittedProject(world, 'claude-a');
    const server = fakeAnthropic(() => message());
    const executor = new ClaudeExecutor({
      apiKey: 'k',
      fetchImpl: server.fetchImpl,
      inputLoader: createIntakeInputLoader(world.services.db),
    });

    // No gate decisions arrive, so with a zero gate timeout the run parks at
    // design_review — after the real research stage has executed.
    await runPipeline(
      new InMemoryStepRunner(),
      {
        db: world.services.db,
        clock: world.clock,
        executor: new SimulatedExecutor(),
        executors: { research: executor },
        stageDurationMs: 0,
        gateTimeoutMs: 0,
      },
      { projectId, organizationId: org.id, workflowInstanceId: 'wf-claude-a' },
    );

    const ctx = tenantContext(org.id);
    const pipeline = createPipelineRepository(world.services.db);
    const artifact = await pipeline.latestArtifact(ctx, projectId, 'research_report');
    const run = (await pipeline.listAgentRuns(ctx, projectId)).find(
      (r) => r.agentType === 'research',
    );
    expect(artifact).toMatchObject({ storage: 'inline', hasUnverifiedClaims: true });
    expect(JSON.parse(artifact!.content ?? '{}')).toMatchObject({ summary: VALID_OUTPUT.summary });
    expect(run).toMatchObject({
      model: 'claude-opus-5',
      promptVersion: RESEARCH_PROMPT_VERSION,
      status: 'succeeded',
      inputTokens: 2_000,
      outputTokens: 900,
    });
    // The executor loaded the real frozen intake as its input.
    expect(JSON.stringify(server.requests[0]?.body.messages)).toContain('Ironside Press LLC');
  });
});
