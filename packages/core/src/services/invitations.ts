import type { Database, InvitationRow, PlatformRole } from '@website-factory/db';
import {
  createInvitationsRepository,
  createOrganizationsRepository,
  createUsersRepository,
  tenantContext,
} from '@website-factory/db';
import {
  createMemberInvitationInputSchema,
  createStaffInvitationInputSchema,
  type CreateMemberInvitationInput,
  type CreateStaffInvitationInput,
} from '@website-factory/schemas';

import type { AuditService } from '../audit';
import { requirePlatformPermission, requireTenantPermission, requireVerified } from '../authz';
import type { Clock } from '../clock';
import { isoNow } from '../clock';
import type { EmailSender } from '../email';
import { DomainError, forbidden, notFound } from '../errors';
import { newId } from '../ids';
import type { Principal } from '../principal';
import type { OrganizationService } from './organizations';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Invitation tokens: 32 random bytes (WebCrypto CSPRNG), sent as hex in the
 * accept link; only the SHA-256 hash is stored. This is standard primitive
 * usage, not custom cryptography — no hand-rolled algorithms or comparisons
 * beyond an exact hash lookup.
 */
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function newInvitationToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class InvitationService {
  private readonly invitations;
  private readonly organizations;
  private readonly users;

  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly emailSender: EmailSender,
    private readonly organizationService: OrganizationService,
    private readonly appBaseUrl: string,
  ) {
    this.invitations = createInvitationsRepository(db);
    this.organizations = createOrganizationsRepository(db);
    this.users = createUsersRepository(db);
  }

  private acceptUrl(token: string): string {
    return `${this.appBaseUrl.replace(/\/$/, '')}/invitations/accept?token=${token}`;
  }

  /** Owner invites an additional member into their organization. */
  async inviteMember(
    principal: Principal,
    organizationId: string,
    input: CreateMemberInvitationInput,
  ): Promise<{ invitationId: string }> {
    requireVerified(principal);
    const membership = await this.organizationService.membershipFor(principal, organizationId);
    requireTenantPermission(membership, 'organization.manage_members');
    const data = createMemberInvitationInputSchema.parse(input);

    const token = newInvitationToken();
    const now = this.clock.now();
    const id = newId();
    await this.invitations.create({
      id,
      kind: 'organization_member',
      organizationId,
      email: data.email.toLowerCase(),
      role: data.role,
      tokenHash: await sha256Hex(token),
      status: 'pending',
      invitedBy: principal.userId,
      expiresAt: new Date(now.getTime() + INVITATION_TTL_MS).toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });

    const org = await this.organizations.findById(tenantContext(organizationId));
    await this.emailSender.send({
      to: data.email,
      subject: `You have been invited to ${org?.name ?? 'an organization'} on Website Factory`,
      text: `${principal.name} invited you to join ${org?.name ?? 'their organization'} on Website Factory.\n\nAccept the invitation:\n\n${this.acceptUrl(token)}\n\nThis link expires in 7 days. You will need an account with this email address (${data.email}).`,
    });

    await this.audit.record({
      action: 'invitation.created',
      resourceType: 'invitation',
      resourceId: id,
      organizationId,
      actor: { type: 'user', id: principal.userId },
      metadata: { kind: 'organization_member', role: data.role },
    });
    return { invitationId: id };
  }

  /** Administrator invites a staff account (invitation-only staff, ADR-0003/0015). */
  async inviteStaff(
    principal: Principal,
    input: CreateStaffInvitationInput,
  ): Promise<{ invitationId: string }> {
    requireVerified(principal);
    requirePlatformPermission(principal, 'platform.manage_staff');
    const data = createStaffInvitationInputSchema.parse(input);

    const token = newInvitationToken();
    const now = this.clock.now();
    const id = newId();
    await this.invitations.create({
      id,
      kind: 'staff',
      organizationId: null,
      email: data.email.toLowerCase(),
      role: data.role,
      tokenHash: await sha256Hex(token),
      status: 'pending',
      invitedBy: principal.userId,
      expiresAt: new Date(now.getTime() + INVITATION_TTL_MS).toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });

    await this.emailSender.send({
      to: data.email,
      subject: 'You have been invited to the Website Factory staff',
      text: `${principal.name} invited you to join Website Factory as staff (${data.role}).\n\nAccept the invitation:\n\n${this.acceptUrl(token)}\n\nThis link expires in 7 days. You will need an account with this email address (${data.email}).`,
    });

    await this.audit.record({
      action: 'invitation.created',
      resourceType: 'invitation',
      resourceId: id,
      organizationId: null,
      actor: { type: 'user', id: principal.userId },
      metadata: { kind: 'staff', role: data.role },
    });
    return { invitationId: id };
  }

  /**
   * Accepts an invitation. The caller must be authenticated with a VERIFIED
   * email that exactly matches the invitation's email — a forwarded link is
   * useless to anyone else.
   */
  async accept(
    principal: Principal,
    token: string,
  ): Promise<{ kind: 'organization_member'; organizationId: string } | { kind: 'staff' }> {
    requireVerified(principal);

    const invitation = await this.invitations.findByTokenHash(await sha256Hex(token));
    if (!invitation || invitation.status === 'revoked') throw notFound('invitation');
    if (invitation.status === 'accepted') {
      throw new DomainError('conflict', 'This invitation has already been used');
    }

    const now = this.clock.now();
    if (invitation.expiresAt <= now.toISOString()) {
      await this.invitations.markExpired(invitation.id, now.toISOString());
      throw new DomainError('expired', 'This invitation has expired');
    }
    if (invitation.email !== principal.email.toLowerCase()) {
      throw forbidden('This invitation was issued to a different email address');
    }

    const transitioned = await this.invitations.markAccepted(
      invitation.id,
      principal.userId,
      now.toISOString(),
    );
    if (!transitioned) {
      throw new DomainError('conflict', 'This invitation has already been used');
    }

    if (invitation.kind === 'organization_member') {
      const organizationId = invitation.organizationId;
      if (!organizationId) throw notFound('invitation');
      await this.organizations.addMember(
        tenantContext(organizationId),
        principal.userId,
        'member',
        now.toISOString(),
      );
      await this.audit.record({
        action: 'invitation.accepted',
        resourceType: 'invitation',
        resourceId: invitation.id,
        organizationId,
        actor: { type: 'user', id: principal.userId },
        metadata: { kind: invitation.kind },
      });
      return { kind: 'organization_member', organizationId };
    }

    // Staff invitation: assign the platform role recorded on the invitation.
    // The guarded update only applies to verified accounts without an existing
    // platform role — accepting a staff invite never overwrites a role.
    await this.users.promoteToPlatformRole(
      principal.userId,
      invitation.role as PlatformRole,
      now.toISOString(),
    );
    await this.audit.record({
      action: 'invitation.accepted',
      resourceType: 'invitation',
      resourceId: invitation.id,
      organizationId: null,
      actor: { type: 'user', id: principal.userId },
      metadata: { kind: invitation.kind, role: invitation.role },
    });
    return { kind: 'staff' };
  }

  async revoke(principal: Principal, organizationId: string, invitationId: string): Promise<void> {
    const membership = await this.organizationService.membershipFor(principal, organizationId);
    requireTenantPermission(membership, 'organization.manage_members');
    const revoked = await this.invitations.revoke(
      tenantContext(organizationId),
      invitationId,
      isoNow(this.clock),
    );
    if (!revoked) throw notFound('invitation');
    await this.audit.record({
      action: 'invitation.revoked',
      resourceType: 'invitation',
      resourceId: invitationId,
      organizationId,
      actor: { type: 'user', id: principal.userId },
    });
  }

  async listForOrganization(
    principal: Principal,
    organizationId: string,
  ): Promise<InvitationRow[]> {
    const membership = await this.organizationService.membershipFor(principal, organizationId);
    requireTenantPermission(membership, 'organization.manage_members');
    return this.invitations.listForOrganization(tenantContext(organizationId));
  }
}
