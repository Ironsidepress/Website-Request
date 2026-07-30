/**
 * Subpath entry (`@website-factory/core/pipeline`) for the orchestrator
 * worker: pipeline engine + dispatcher without the auth/service graph, so the
 * workflow bundle stays free of Better Auth (same pattern as ./maintenance).
 */
export { systemClock, isoNow, FixedClock, type Clock } from '../clock';
export { logEvent, redactFields, type LogLevel } from '../logging';
export {
  PIPELINE_STAGES,
  APPROVAL_GATES,
  STAGE_TITLES,
  TRANSITIONS,
  isPipelineStage,
  canTransition,
  stageIndex,
  type PipelineStage,
} from '../state-machine';
export {
  AgentDispatcher,
  SimulatedExecutor,
  type AgentExecutor,
  type AgentTask,
  type AgentExecution,
  type ExecutorRegistry,
} from './dispatcher';
export {
  FigmaDesignExecutor,
  type FigmaClient,
  type FigmaDesignRequest,
  type FigmaDesignRef,
} from './figma';
export { FigmaMcpClient, type FigmaMcpConfig } from './figma-mcp';
export {
  ClaudeExecutor,
  CONTENT_STRATEGY_PROMPT_VERSION,
  CREATIVE_DIRECTION_PROMPT_VERSION,
  RESEARCH_PROMPT_VERSION,
  type ClaudeExecutorConfig,
} from './claude';
export { createAgentInputLoader, createIntakeInputLoader } from './inputs';
export {
  runPipeline,
  APPROVAL_EVENT_TYPE,
  MAX_GATE_ATTEMPTS,
  type StepRunner,
  type WaitResult,
  type PipelineParams,
  type PipelineDeps,
} from './engine';
export { InMemoryStepRunner } from './in-memory-runner';
