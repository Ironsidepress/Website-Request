import { describe, expect, it } from 'vitest';

import { createPipelineRepository, tenantContext } from '@website-factory/db';

import {
  InMemoryStepRunner,
  RESEARCH_PROMPT_VERSION,
  SimulatedExecutor,
  WorkersAiExecutor,
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

/** Canned Workers AI binding recording every run() call. */
function fakeAi(respond: (model: string, options: Record<string, unknown>) => unknown) {
  const calls: Array<{ model: string; options: Record<string, unknown> }> = [];
  return {
    calls,
    run: async (model: string, options: Record<string, unknown>) => {
      calls.push({ model, options });
      return respond(model, options);
    },
  };
}

describe('WorkersAiExecutor', () => {
  it('produces a validated report with usage, cost, claims flag and JSON-mode request', async () => {
    const ai = fakeAi(() => ({
      response: VALID_OUTPUT,
      usage: { prompt_tokens: 1_500, completion_tokens: 800 },
    }));
    const executor = new WorkersAiExecutor({
      ai,
      inputLoader: async () => ({ business: { displayName: 'Ironside Press' } }),
    });

    const execution = await executor.execute(TASK);
    expect(execution.model).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    expect(execution.promptVersion).toBe(RESEARCH_PROMPT_VERSION);
    expect(execution.inputTokens).toBe(1_500);
    expect(execution.outputTokens).toBe(800);
    // 1500 × $0.29/MTok + 800 × $2.25/MTok
    expect(execution.estimatedCostUsd).toBeCloseTo(0.002235, 8);
    expect(execution.hasUnverifiedClaims).toBe(true);
    expect(execution.content).toMatchObject({ summary: VALID_OUTPUT.summary });

    const call = ai.calls[0]!;
    const format = call.options.response_format as { type: string; json_schema: unknown };
    expect(format.type).toBe('json_schema');
    expect(format.json_schema).toBeTruthy();
    const messages = call.options.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.role).toBe('system');
    expect(messages[1]?.content).toContain('Ironside Press');
  });

  it('accepts stringified JSON responses and fails schema-invalid output', async () => {
    const stringAi = fakeAi(() => ({
      response: JSON.stringify(VALID_OUTPUT),
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    }));
    const stringExecutor = new WorkersAiExecutor({
      ai: stringAi,
      inputLoader: async () => ({}),
    });
    const execution = await stringExecutor.execute(TASK);
    expect(execution.content).toMatchObject({ summary: VALID_OUTPUT.summary });

    const badAi = fakeAi(() => ({ response: { summary: 'missing everything else' } }));
    const badExecutor = new WorkersAiExecutor({ ai: badAi, inputLoader: async () => ({}) });
    await expect(badExecutor.execute(TASK)).rejects.toThrow(/schema validation/);

    const emptyAi = fakeAi(() => ({}));
    const emptyExecutor = new WorkersAiExecutor({ ai: emptyAi, inputLoader: async () => ({}) });
    await expect(emptyExecutor.execute(TASK)).rejects.toThrow(/no output/);
  });

  it('runs inside the pipeline exactly like any other executor', async () => {
    const world = createTestWorld();
    const { org, projectId } = await submittedProject(world, 'wai-a');
    const ai = fakeAi(() => ({
      response: VALID_OUTPUT,
      usage: { prompt_tokens: 1_500, completion_tokens: 800 },
    }));
    const executor = new WorkersAiExecutor({
      ai,
      inputLoader: async () => ({ note: 'intake stand-in' }),
    });

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
      { projectId, organizationId: org.id, workflowInstanceId: 'wf-wai-a' },
    );

    const ctx = tenantContext(org.id);
    const pipeline = createPipelineRepository(world.services.db);
    const artifact = await pipeline.latestArtifact(ctx, projectId, 'research_report');
    const run = (await pipeline.listAgentRuns(ctx, projectId)).find(
      (r) => r.agentType === 'research',
    );
    expect(artifact).toMatchObject({ storage: 'inline', hasUnverifiedClaims: true });
    expect(run).toMatchObject({
      model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      promptVersion: RESEARCH_PROMPT_VERSION,
      status: 'succeeded',
      inputTokens: 1_500,
      outputTokens: 800,
    });
  });
});
