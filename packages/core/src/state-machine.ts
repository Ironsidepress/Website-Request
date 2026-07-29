/**
 * Project state machine (docs/workflow-state-machine.md).
 *
 * The canonical stage sequence and transition table. Cloudflare Workflows is
 * the authoritative driver (ADR-0001); this module is the shared vocabulary
 * used by the workflow (M5), timeline projection and tests.
 */

export const PIPELINE_STAGES = [
  'created',
  'research',
  'content_strategy',
  'creative_direction',
  'design',
  'design_review',
  'development',
  'testing',
  'seo_review',
  'preview_deploy',
  'preview_review',
  'production_approval',
  'production_deploy',
  'live',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const APPROVAL_GATES: ReadonlySet<PipelineStage> = new Set([
  'design_review',
  'preview_review',
  'production_approval',
]);

/** Human-readable stage titles for the client timeline. */
export const STAGE_TITLES: Record<PipelineStage, string> = {
  created: 'Project created',
  research: 'Research',
  content_strategy: 'Content plan',
  creative_direction: 'Creative direction',
  design: 'Design',
  design_review: 'Design review (your approval)',
  development: 'Development',
  testing: 'Testing',
  seo_review: 'SEO review',
  preview_deploy: 'Preview deployment',
  preview_review: 'Preview review (your approval)',
  production_approval: 'Launch approval',
  production_deploy: 'Launch',
  live: 'Live',
};

/** Legal forward transitions, including rework routes from rejected gates. */
export const TRANSITIONS: Record<PipelineStage, readonly PipelineStage[]> = {
  created: ['research'],
  research: ['content_strategy'],
  content_strategy: ['creative_direction'],
  creative_direction: ['design'],
  design: ['design_review'],
  design_review: ['development', 'design'],
  development: ['testing'],
  testing: ['seo_review', 'development'],
  seo_review: ['preview_deploy'],
  preview_deploy: ['preview_review'],
  preview_review: ['production_approval', 'development'],
  production_approval: ['production_deploy'],
  production_deploy: ['live'],
  live: [],
};

export function isPipelineStage(value: string): value is PipelineStage {
  return (PIPELINE_STAGES as readonly string[]).includes(value);
}

export function canTransition(from: PipelineStage, to: PipelineStage): boolean {
  return TRANSITIONS[from].includes(to);
}

export function stageIndex(stage: PipelineStage): number {
  return PIPELINE_STAGES.indexOf(stage);
}
