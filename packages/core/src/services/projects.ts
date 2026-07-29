import type { Database, ProjectRow, StageHistoryRow } from '@website-factory/db';
import {
  createFilesRepository,
  createIntakesRepository,
  createProjectsRepository,
  tenantContext,
} from '@website-factory/db';
import { intakeDocumentSchema, INTAKE_SCHEMA_VERSION } from '@website-factory/schemas';

import type { AuditService } from '../audit';
import { requireTenantPermission, requireVerified } from '../authz';
import type { Clock } from '../clock';
import { isoNow } from '../clock';
import { DomainError, notFound } from '../errors';
import { newId } from '../ids';
import { SYSTEM_ACTOR, type Principal } from '../principal';
import { PIPELINE_STAGES, STAGE_TITLES, stageIndex, isPipelineStage } from '../state-machine';
import type { OrganizationService } from './organizations';

/**
 * Starts the durable ProjectPipeline for a newly created project. The web app
 * backs this with the PROJECT_PIPELINE workflow binding; environments without
 * the binding (local `next dev`) simply skip the start — the M7 admin
 * dashboard is the recovery path for projects whose start failed.
 */
export interface WorkflowStarter {
  start(params: { projectId: string; organizationId: string }): Promise<{ instanceId: string }>;
}

export interface TimelineEntry {
  stage: string;
  title: string;
  status: 'done' | 'active' | 'upcoming';
  waitingOnYou: boolean;
}

export interface ProjectTimeline {
  project: { id: string; name: string; status: string; createdAt: string };
  stages: TimelineEntry[];
  /** Client-safe, human-readable events (no internals, ever). */
  events: Array<{ at: string; description: string }>;
}

function collectFileIds(document: Record<string, unknown>): string[] {
  const ids: string[] = [];
  const branding = document.branding as { assetFileIds?: string[] } | undefined;
  const content = document.content as
    { copyFileIds?: string[]; photoFileIds?: string[] } | undefined;
  ids.push(...(branding?.assetFileIds ?? []));
  ids.push(...(content?.copyFileIds ?? []));
  ids.push(...(content?.photoFileIds ?? []));
  return ids;
}

export class ProjectService {
  private readonly projects;
  private readonly intakes;
  private readonly files;

  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly organizations: OrganizationService,
    private readonly workflowStarter?: WorkflowStarter,
  ) {
    this.projects = createProjectsRepository(db);
    this.intakes = createIntakesRepository(db);
    this.files = createFilesRepository(db);
  }

  private async requireAccess(
    principal: Principal,
    organizationId: string,
    permission: 'intake.submit' | 'organization.view',
  ) {
    requireVerified(principal);
    const membership = await this.organizations.membershipFor(principal, organizationId);
    requireTenantPermission(membership, permission);
    return tenantContext(organizationId);
  }

  /**
   * Submission (docs/user-flows.md §2 step 10): strict full-document
   * validation, tenant-ownership check of every referenced file, guarded
   * intake freeze, then atomic project creation. Idempotent end to end —
   * a double submission returns the already-created project.
   */
  async submitIntake(
    principal: Principal,
    organizationId: string,
    input: { confirmAccuracy: boolean },
  ): Promise<{ projectId: string; alreadySubmitted: boolean }> {
    const ctx = await this.requireAccess(principal, organizationId, 'intake.submit');
    const draft = await this.intakes.findDraft(ctx);

    if (!draft) {
      // Re-submission after a successful freeze: return the existing project.
      const submitted = await this.projects.listForOrganization(ctx);
      const existing = submitted[submitted.length - 1];
      if (existing) return { projectId: existing.id, alreadySubmitted: true };
      throw notFound('intake draft');
    }

    const document = {
      schemaVersion: INTAKE_SCHEMA_VERSION,
      ...JSON.parse(draft.data),
      // The accuracy attestation is asserted at submission time, not stored in
      // the draft — it feeds the factual-claims gate (docs/intake-schema.md).
      clientConfirmsAccuracy: input.confirmAccuracy === true,
    };
    const parsed = intakeDocumentSchema.safeParse(document);
    if (!parsed.success) {
      throw new DomainError(
        'validation_failed',
        'The questionnaire is not complete yet — please finish every section',
      );
    }

    // Every referenced file must exist, be stored, and belong to this tenant.
    const fileIds = collectFileIds(parsed.data as unknown as Record<string, unknown>);
    if (fileIds.length > 0) {
      const owned = await this.files.findByIds(ctx, fileIds);
      const ownedStored = new Set(
        owned.filter((file) => file.status === 'stored').map((file) => file.id),
      );
      const missing = fileIds.filter((id) => !ownedStored.has(id));
      if (missing.length > 0) {
        throw new DomainError(
          'validation_failed',
          'Some referenced uploads are missing — remove and re-upload them',
        );
      }
    }

    const now = isoNow(this.clock);

    // Freeze first: the guarded update is the single winner selector under
    // concurrent submissions.
    const frozen = await this.intakes.markSubmitted(ctx, draft.id, principal.userId, now);
    if (!frozen) {
      const existing = await this.projects.findByIntakeId(ctx, draft.id);
      if (existing) return { projectId: existing.id, alreadySubmitted: true };
      throw new DomainError('conflict', 'This questionnaire was just submitted — reload');
    }

    const business = parsed.data.business;
    const projectId = newId();
    const created = await this.projects.createWithInitialStage(
      ctx,
      {
        id: projectId,
        organizationId,
        intakeId: draft.id,
        name: `${business.displayName} website`,
        currentStage: 'created',
        status: 'active',
        health: 'ok',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: newId(),
        projectId,
        organizationId,
        fromStage: null,
        toStage: 'created',
        attempt: 1,
        eventType: 'stage.started',
        actorType: 'user',
        actorId: principal.userId,
        clientVisible: true,
        createdAt: now,
      },
    );
    if (!created) {
      // Freeze won but a project already exists for this intake (retry race).
      const existing = await this.projects.findByIntakeId(ctx, draft.id);
      if (existing) return { projectId: existing.id, alreadySubmitted: true };
      throw new DomainError('conflict', 'Submission raced — reload and try again');
    }

    await this.audit.record({
      action: 'intake.submitted',
      resourceType: 'intake',
      resourceId: draft.id,
      organizationId,
      actor: { type: 'user', id: principal.userId },
      metadata: { projectId },
    });
    await this.startPipeline(ctx, organizationId, projectId);
    return { projectId, alreadySubmitted: false };
  }

  /**
   * Non-fatal workflow start: the submission stands even if Cloudflare is
   * unreachable — the failure is audited and surfaces on the admin dashboard.
   */
  private async startPipeline(
    ctx: ReturnType<typeof tenantContext>,
    organizationId: string,
    projectId: string,
  ): Promise<void> {
    if (!this.workflowStarter) return;
    try {
      const { instanceId } = await this.workflowStarter.start({ projectId, organizationId });
      const now = isoNow(this.clock);
      await this.projects.recordWorkflowRunIfAbsent(ctx, {
        id: newId(),
        projectId,
        organizationId,
        workflowName: 'project-pipeline',
        cfInstanceId: instanceId,
        status: 'running',
        startedAt: now,
        createdAt: now,
      });
      await this.audit.record({
        action: 'workflow.started',
        resourceType: 'project',
        resourceId: projectId,
        organizationId,
        actor: SYSTEM_ACTOR,
        metadata: { instanceId },
      });
    } catch (error) {
      await this.audit.record({
        action: 'workflow.start_failed',
        resourceType: 'project',
        resourceId: projectId,
        organizationId,
        actor: SYSTEM_ACTOR,
        metadata: { message: error instanceof Error ? error.message : 'unknown error' },
      });
    }
  }

  async listForOrganization(principal: Principal, organizationId: string) {
    const ctx = await this.requireAccess(principal, organizationId, 'organization.view');
    const rows = await this.projects.listForOrganization(ctx);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      currentStage: row.currentStage,
      status: row.status,
      createdAt: row.createdAt,
    }));
  }

  /** Client timeline (docs/user-flows.md §4): stages + safe events only. */
  async timeline(
    principal: Principal,
    organizationId: string,
    projectId: string,
  ): Promise<ProjectTimeline> {
    const ctx = await this.requireAccess(principal, organizationId, 'organization.view');
    const project = await this.projects.findById(ctx, projectId);
    if (!project) throw notFound('project');

    const history = await this.projects.listClientVisibleHistory(ctx, projectId);
    const current = isPipelineStage(project.currentStage) ? project.currentStage : 'created';
    const currentIndex = stageIndex(current);

    const stages: TimelineEntry[] = PIPELINE_STAGES.map((stage) => {
      const index = stageIndex(stage);
      const isGateForClient = stage === 'design_review' || stage === 'preview_review';
      return {
        stage,
        title: STAGE_TITLES[stage],
        status: index < currentIndex ? 'done' : index === currentIndex ? 'active' : 'upcoming',
        waitingOnYou: index === currentIndex && isGateForClient && project.status === 'active',
      };
    });

    return {
      project: {
        id: project.id,
        name: project.name,
        status: project.status,
        createdAt: project.createdAt,
      },
      stages,
      events: history.map((row: StageHistoryRow) => ({
        at: row.createdAt,
        description: this.describe(row),
      })),
    };
  }

  private describe(row: StageHistoryRow): string {
    const title = isPipelineStage(row.toStage) ? STAGE_TITLES[row.toStage] : row.toStage;
    switch (row.eventType) {
      case 'stage.started':
        return `${title} started`;
      case 'stage.completed':
        return `${title} completed`;
      case 'approval.requested':
        return `${title} — waiting for your review`;
      default:
        return title;
    }
  }

  async getForAdminOrMember(principal: Principal, organizationId: string, projectId: string) {
    const ctx = await this.requireAccess(principal, organizationId, 'organization.view');
    const project = await this.projects.findById(ctx, projectId);
    if (!project) throw notFound('project');
    return project as ProjectRow;
  }
}
