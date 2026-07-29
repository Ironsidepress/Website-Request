import type {
  AgentRunRow,
  ApprovalRow,
  ArtifactRow,
  AuditLogRow,
  Database,
  FileRow,
  IntakeRow,
  ProjectRow,
  StaffProjectListRow,
  StageHistoryRow,
  WorkflowRunRow,
} from '@website-factory/db';
import {
  createApprovalsRepository,
  createFilesRepository,
  createIntakesRepository,
  createPipelineRepository,
  createProjectsRepository,
  createStaffRepository,
  tenantContext,
} from '@website-factory/db';

import type { AuditService } from '../audit';
import { requirePlatformPermission, requireVerified } from '../authz';
import type { Clock } from '../clock';
import { isoNow } from '../clock';
import { DomainError, notFound } from '../errors';
import { newId } from '../ids';
import type { Principal } from '../principal';
import { userActor } from '../principal';
import type { WorkflowStarter } from './projects';

export type StaffProjectAction = 'hold' | 'resume' | 'cancel' | 'retry';

export interface StaffProjectDetail {
  project: ProjectRow;
  organizationName: string;
  history: StageHistoryRow[];
  approvals: ApprovalRow[];
  agentRuns: AgentRunRow[];
  artifacts: Array<Omit<ArtifactRow, 'content'>>;
  workflowRuns: WorkflowRunRow[];
  intake: { status: string; data: Record<string, unknown> } | null;
  files: FileRow[];
  audit: AuditLogRow[];
}

/**
 * Staff platform surface (docs/user-roles.md, acceptance criteria §5).
 *
 * Every method checks an explicit platform permission and audit-logs the
 * cross-tenant read or action. Manual actions are guarded state transitions —
 * never silent overrides — and resume/retry restart the durable pipeline via
 * a fresh workflow instance (the engine's guarded projections and gate
 * re-requests make that safe; docs/workflow-state-machine.md).
 */
export class StaffService {
  private readonly staff;
  private readonly projects;
  private readonly pipeline;
  private readonly approvals;
  private readonly intakes;
  private readonly files;

  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly workflowStarter?: WorkflowStarter,
  ) {
    this.staff = createStaffRepository(db);
    this.projects = createProjectsRepository(db);
    this.pipeline = createPipelineRepository(db);
    this.approvals = createApprovalsRepository(db);
    this.intakes = createIntakesRepository(db);
    this.files = createFilesRepository(db);
  }

  private async auditRead(
    principal: Principal,
    resourceType: string,
    resourceId: string,
    organizationId: string | null,
  ): Promise<void> {
    await this.audit.record({
      action: 'staff.read',
      resourceType,
      resourceId,
      organizationId,
      actor: userActor(principal),
    });
  }

  async listProjects(
    principal: Principal,
    filters: { status?: string; health?: string } = {},
  ): Promise<StaffProjectListRow[]> {
    requireVerified(principal);
    requirePlatformPermission(principal, 'platform.view_all_projects');
    await this.auditRead(principal, 'project_list', 'all', null);
    return this.staff.listProjects(filters);
  }

  async listPendingApprovals(principal: Principal) {
    requireVerified(principal);
    requirePlatformPermission(principal, 'platform.view_all_projects');
    await this.auditRead(principal, 'approval_queue', 'pending', null);
    return this.staff.listPendingApprovals();
  }

  /** Full internal view — includes what clients must never see. */
  async projectDetail(principal: Principal, projectId: string): Promise<StaffProjectDetail> {
    requireVerified(principal);
    requirePlatformPermission(principal, 'platform.view_all_projects');
    const found = await this.staff.findProjectWithOrg(projectId);
    if (!found) throw notFound('project');
    const { project, organizationName } = found;
    const ctx = tenantContext(project.organizationId);
    await this.auditRead(principal, 'project', projectId, project.organizationId);

    const [history, approvals, agentRuns, artifacts, workflowRuns, files, audit] =
      await Promise.all([
        this.projects.listAllHistory(ctx, projectId),
        this.approvals.listForProject(ctx, projectId),
        this.pipeline.listAgentRuns(ctx, projectId),
        this.pipeline.listArtifacts(ctx, projectId),
        this.projects.listWorkflowRuns(ctx, projectId),
        this.files.listForOrganization(ctx),
        this.audit.listForOrganization({ organizationId: project.organizationId }),
      ]);

    const intakeRow: IntakeRow | undefined = await this.intakes.findById(ctx, project.intakeId);
    return {
      project,
      organizationName,
      history,
      approvals,
      agentRuns,
      // Artifact content can be large; the list view ships metadata only.
      artifacts: artifacts.map(({ content: _content, ...rest }) => rest),
      workflowRuns,
      intake: intakeRow
        ? { status: intakeRow.status, data: JSON.parse(intakeRow.data) as Record<string, unknown> }
        : null,
      files,
      audit,
    };
  }

  /**
   * Manual actions (acceptance §5): guarded transitions, each audited.
   * Cancel requires a reason; resume and retry restart the pipeline when a
   * workflow starter is configured.
   */
  async performAction(
    principal: Principal,
    projectId: string,
    input: { action: StaffProjectAction; reason?: string },
  ): Promise<{ status: string }> {
    requireVerified(principal);
    requirePlatformPermission(
      principal,
      input.action === 'retry' ? 'platform.retry_workflow' : 'platform.manage_projects',
    );
    const project = await this.staff.findProjectById(projectId);
    if (!project) throw notFound('project');
    const ctx = tenantContext(project.organizationId);
    const now = isoNow(this.clock);
    const reason = input.reason?.trim() || null;

    switch (input.action) {
      case 'hold': {
        if (project.status !== 'active') {
          throw new DomainError('conflict', 'Only active projects can be put on hold');
        }
        await this.pipeline.setProjectStatus(ctx, projectId, 'on_hold', now);
        break;
      }
      case 'resume': {
        if (project.status !== 'on_hold') {
          throw new DomainError('conflict', 'Only on-hold projects can be resumed');
        }
        await this.pipeline.setProjectStatus(ctx, projectId, 'active', now);
        await this.pipeline.setProjectHealth(ctx, projectId, 'ok', now);
        await this.restartPipeline(principal, ctx, project, now);
        break;
      }
      case 'cancel': {
        if (project.status === 'completed' || project.status === 'cancelled') {
          throw new DomainError('conflict', 'This project is already closed');
        }
        if (!reason) {
          throw new DomainError('validation_failed', 'Cancelling requires an audited reason');
        }
        await this.pipeline.setProjectStatus(ctx, projectId, 'cancelled', now);
        break;
      }
      case 'retry': {
        if (project.status !== 'active' || project.health !== 'needs_attention') {
          throw new DomainError('conflict', 'Retry applies to active projects needing attention');
        }
        await this.pipeline.setProjectHealth(ctx, projectId, 'ok', now);
        await this.restartPipeline(principal, ctx, project, now);
        break;
      }
    }

    await this.audit.record({
      action: `staff.project_${input.action}`,
      resourceType: 'project',
      resourceId: projectId,
      organizationId: project.organizationId,
      actor: userActor(principal),
      metadata: reason ? { reason } : undefined,
    });
    return { status: 'ok' };
  }

  /** New instance re-drives the pipeline; failures are audited, non-fatal. */
  private async restartPipeline(
    principal: Principal,
    ctx: ReturnType<typeof tenantContext>,
    project: ProjectRow,
    now: string,
  ): Promise<void> {
    if (!this.workflowStarter) return;
    try {
      const { instanceId } = await this.workflowStarter.start({
        projectId: project.id,
        organizationId: project.organizationId,
      });
      await this.projects.recordWorkflowRunIfAbsent(ctx, {
        id: newId(),
        projectId: project.id,
        organizationId: project.organizationId,
        workflowName: 'project-pipeline',
        cfInstanceId: instanceId,
        status: 'running',
        startedAt: now,
        createdAt: now,
      });
      await this.audit.record({
        action: 'workflow.restarted',
        resourceType: 'project',
        resourceId: project.id,
        organizationId: project.organizationId,
        actor: userActor(principal),
        metadata: { instanceId },
      });
    } catch (error) {
      await this.audit.record({
        action: 'workflow.start_failed',
        resourceType: 'project',
        resourceId: project.id,
        organizationId: project.organizationId,
        actor: userActor(principal),
        metadata: { message: error instanceof Error ? error.message : 'unknown error' },
      });
    }
  }
}
