import type { ApprovalRow, Database } from '@website-factory/db';
import {
  createApprovalsRepository,
  createPipelineRepository,
  tenantContext,
  type TenantContext,
} from '@website-factory/db';

import type { AuditService } from '../audit';
import { requireVerified } from '../authz';
import type { Clock } from '../clock';
import { isoNow } from '../clock';
import { DomainError, forbidden, notFound } from '../errors';
import type { Principal } from '../principal';
import { userActor } from '../principal';
import type { OrganizationService } from './organizations';

/**
 * Human approval decisions (ADR-0010, docs/user-roles.md).
 *
 * This service is the sole writer of approval decisions. It authenticates the
 * principal, checks the gate's authority matrix, records the decision in D1
 * with an audit entry, and only then signals the paused workflow — which
 * re-reads the D1 row and never trusts the event alone. Agents can never hold
 * approval authority: only user principals reach this code path.
 */

export interface WorkflowSignaler {
  signalApproval(
    workflowInstanceId: string,
    payload: { approvalId: string; decision: 'approved' | 'rejected' },
  ): Promise<void>;
}

export interface PendingApprovalView {
  id: string;
  gate: string;
  stageAttempt: number;
  requestedAt: string;
  expiresAt: string;
  /** Whether the calling principal is allowed to decide this approval. */
  canDecide: boolean;
  /**
   * Where the reviewer looks at the work under review (e.g. the Figma file
   * for design_review, ADR-0017). Only the review URL from the referenced
   * artifact is exposed — never node ids or agent metadata.
   */
  reviewUrl?: string;
}

export class ApprovalService {
  private readonly approvals;
  private readonly pipeline;

  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly organizations: OrganizationService,
    private readonly signaler?: WorkflowSignaler,
  ) {
    this.approvals = createApprovalsRepository(db);
    this.pipeline = createPipelineRepository(db);
  }

  /** Resolves the safe, human-facing review URL of the first reviewed artifact. */
  private async reviewUrlFor(ctx: TenantContext, approval: ApprovalRow): Promise<string | null> {
    const refs = JSON.parse(approval.artifactRefs) as Array<{
      artifactId: string;
      version: number;
    }>;
    const ref = refs[0];
    if (!ref) return null;
    const artifact = await this.pipeline.getArtifact(ctx, ref.artifactId, ref.version);
    if (!artifact || artifact.storage !== 'external_ref' || !artifact.externalRef) return null;
    const external = JSON.parse(artifact.externalRef) as { reviewUrl?: unknown };
    return typeof external.reviewUrl === 'string' ? external.reviewUrl : null;
  }

  /**
   * Authority per gate (docs/user-roles.md): the approval row carries its
   * required roles; a client decides through an owner membership, staff
   * through their platform role. Staff decisions on client gates are
   * cross-tenant and therefore explicitly audited as on-behalf.
   */
  private async authority(
    principal: Principal,
    organizationId: string,
    approval: ApprovalRow,
  ): Promise<{ ctx: TenantContext; onBehalf: boolean }> {
    requireVerified(principal);
    const required = JSON.parse(approval.requiredRoles) as string[];

    const membership = await this.organizations.membershipFor(principal, organizationId);
    if (membership && membership.role === 'owner' && required.includes('owner')) {
      return { ctx: tenantContext(organizationId), onBehalf: false };
    }
    if (principal.platformRole && required.includes(principal.platformRole)) {
      return { ctx: tenantContext(organizationId), onBehalf: !membership };
    }
    // Members and unauthorized staff: reveal nothing beyond what they can see.
    if (membership) throw forbidden();
    throw notFound('approval');
  }

  /** Pending gates for the client timeline (organization members only). */
  async listPendingForProject(
    principal: Principal,
    organizationId: string,
    projectId: string,
  ): Promise<PendingApprovalView[]> {
    requireVerified(principal);
    const membership = await this.organizations.membershipFor(principal, organizationId);
    if (!membership) throw notFound('organization');
    const ctx = tenantContext(organizationId);
    const rows = await this.approvals.listPendingForProject(ctx, projectId);
    return Promise.all(
      rows.map(async (row) => {
        const required = JSON.parse(row.requiredRoles) as string[];
        const canDecide =
          (membership.role === 'owner' && required.includes('owner')) ||
          (principal.platformRole !== null && required.includes(principal.platformRole));
        const reviewUrl = await this.reviewUrlFor(ctx, row);
        return {
          id: row.id,
          gate: row.gate,
          stageAttempt: row.stageAttempt,
          requestedAt: row.requestedAt,
          expiresAt: row.expiresAt,
          canDecide,
          ...(reviewUrl ? { reviewUrl } : {}),
        };
      }),
    );
  }

  /** Records the single winning decision, audits it, then wakes the workflow. */
  async decide(
    principal: Principal,
    organizationId: string,
    approvalId: string,
    input: { decision: 'approved' | 'rejected'; reason?: string },
  ): Promise<{ status: 'approved' | 'rejected' }> {
    const probeCtx = tenantContext(organizationId);
    const approval = await this.approvals.findById(probeCtx, approvalId);
    if (!approval) throw notFound('approval');

    const { ctx, onBehalf } = await this.authority(principal, organizationId, approval);

    const reason = input.reason?.trim() || null;
    if (input.decision === 'rejected' && !reason) {
      throw new DomainError(
        'validation_failed',
        'Please tell us what should change — a reason is required when requesting changes',
      );
    }
    if (approval.status !== 'pending') {
      throw new DomainError('conflict', 'This request has already been decided');
    }

    const decided = await this.approvals.decide(ctx, approvalId, {
      status: input.decision,
      decidedBy: principal.userId,
      decisionReason: reason,
      decidedAt: isoNow(this.clock),
    });
    if (!decided) {
      throw new DomainError('conflict', 'This request has already been decided');
    }

    await this.audit.record({
      action: `approval.${input.decision}`,
      resourceType: 'approval',
      resourceId: approvalId,
      organizationId,
      actor: userActor(principal),
      metadata: {
        gate: approval.gate,
        projectId: approval.projectId,
        stageAttempt: approval.stageAttempt,
        ...(reason ? { reason } : {}),
        ...(onBehalf ? { onBehalf: true } : {}),
      },
    });

    // The event is only a wake-up (ADR-0010); if it is lost, the workflow's
    // poll fallback picks the decision up from D1 — so a signal failure is
    // audited, never surfaced as a client error.
    if (this.signaler) {
      try {
        await this.signaler.signalApproval(approval.workflowInstanceId, {
          approvalId,
          decision: input.decision,
        });
      } catch (error) {
        await this.audit.record({
          action: 'workflow.signal_failed',
          resourceType: 'approval',
          resourceId: approvalId,
          organizationId,
          actor: userActor(principal),
          metadata: {
            message: error instanceof Error ? error.message : 'unknown error',
          },
        });
      }
    }

    return { status: input.decision };
  }
}
