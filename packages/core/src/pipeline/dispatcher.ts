import type { Database } from '@website-factory/db';
import { createPipelineRepository, tenantContext } from '@website-factory/db';

import type { Clock } from '../clock';
import { isoNow } from '../clock';
import { newId } from '../ids';

/**
 * Agent dispatch (docs/agent-contracts.md). The dispatcher is the ONLY code
 * path that executes agents: it owns the audit record (every mandated field),
 * idempotency and artifact persistence. Executors are bounded task runners —
 * the M5 SimulatedExecutor fabricates schema-shaped outputs; the real
 * Claude-Agent-SDK executor slots in behind the same interface (ADR-0009).
 */

export interface AgentTask {
  projectId: string;
  organizationId: string;
  agentType: string;
  contractVersion: number;
  promptVersion: string;
  inputArtifacts: Array<{ artifactId: string; version: number }>;
  outputArtifactType: string;
  /** Deterministic per (workflow instance, step, attempt) — replay-safe. */
  idempotencyKey: string;
  attempt: number;
}

export interface AgentExecution {
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  /** Structured output content (schema-validated in the real executor). */
  content: Record<string, unknown>;
}

export interface AgentExecutor {
  execute(task: AgentTask): Promise<AgentExecution>;
}

/** Deterministic stand-in used until the production plane exists (ADR-0009). */
export class SimulatedExecutor implements AgentExecutor {
  async execute(task: AgentTask): Promise<AgentExecution> {
    const inputTokens = 400 + task.agentType.length * 10;
    const outputTokens = 900 + task.outputArtifactType.length * 10;
    return {
      model: 'simulated',
      inputTokens,
      outputTokens,
      estimatedCostUsd: Number(((inputTokens + outputTokens) / 1_000_000) * 5).valueOf(),
      content: {
        simulated: true,
        agentType: task.agentType,
        artifactType: task.outputArtifactType,
        note: 'Synthetic output produced by the M5 SimulatedExecutor',
      },
    };
  }
}

export class AgentDispatcher {
  private readonly repo;

  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly executor: AgentExecutor,
  ) {
    this.repo = createPipelineRepository(db);
  }

  /**
   * Runs a bounded agent task idempotently: a replayed step reuses the
   * recorded run and artifact instead of executing again.
   */
  async run(task: AgentTask): Promise<{ agentRunId: string; artifactId: string; version: number }> {
    const ctx = tenantContext(task.organizationId);
    const artifactId = `${task.projectId}:${task.outputArtifactType}`;
    const now = isoNow(this.clock);

    const run = await this.repo.createAgentRunIfAbsent(ctx, {
      id: newId(),
      projectId: task.projectId,
      organizationId: task.organizationId,
      agentType: task.agentType,
      contractVersion: task.contractVersion,
      promptVersion: task.promptVersion,
      inputArtifacts: JSON.stringify(task.inputArtifacts),
      model: 'pending',
      status: 'running',
      retryCount: task.attempt - 1,
      startedAt: now,
      idempotencyKey: task.idempotencyKey,
      createdAt: now,
    });

    if (run.status === 'succeeded' && run.outputArtifacts) {
      const outputs = JSON.parse(run.outputArtifacts) as Array<{
        artifactId: string;
        version: number;
      }>;
      const output = outputs[0];
      if (output) return { agentRunId: run.id, ...output };
    }

    const execution = await this.executor.execute(task);

    await this.repo.createArtifactVersionIfAbsent(ctx, {
      artifactId,
      version: task.attempt,
      projectId: task.projectId,
      organizationId: task.organizationId,
      type: task.outputArtifactType,
      status: 'draft',
      storage: 'inline',
      content: JSON.stringify(execution.content),
      createdByType: 'agent',
      createdById: run.id,
      createdAt: isoNow(this.clock),
    });

    await this.repo.completeAgentRun(ctx, run.id, {
      status: 'succeeded',
      model: execution.model,
      completedAt: isoNow(this.clock),
      outputArtifacts: JSON.stringify([{ artifactId, version: task.attempt }]),
      inputTokens: execution.inputTokens,
      outputTokens: execution.outputTokens,
      estimatedCostUsd: execution.estimatedCostUsd,
    });
    return { agentRunId: run.id, artifactId, version: task.attempt };
  }
}
