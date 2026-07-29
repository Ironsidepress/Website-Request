import { eq, and } from 'drizzle-orm';

import type { Database } from '../client';
import type { TenantContext } from '../tenant';
import { invitations } from '../schema/app';

export type InvitationRow = typeof invitations.$inferSelect;
export type NewInvitationRow = typeof invitations.$inferInsert;

export function createInvitationsRepository(db: Database) {
  return {
    async create(row: NewInvitationRow): Promise<void> {
      await db.insert(invitations).values(row);
    },

    async findByTokenHash(tokenHash: string): Promise<InvitationRow | undefined> {
      return db.query.invitations.findFirst({ where: eq(invitations.tokenHash, tokenHash) });
    },

    /**
     * Guarded acceptance: transitions pending → accepted exactly once.
     * Returns true when this call performed the transition.
     */
    async markAccepted(id: string, acceptedBy: string, acceptedAt: string): Promise<boolean> {
      const result = await db
        .update(invitations)
        .set({ status: 'accepted', acceptedBy, acceptedAt, updatedAt: acceptedAt })
        .where(and(eq(invitations.id, id), eq(invitations.status, 'pending')))
        .returning({ id: invitations.id });
      return result.length > 0;
    },

    async markExpired(id: string, updatedAt: string): Promise<void> {
      await db
        .update(invitations)
        .set({ status: 'expired', updatedAt })
        .where(and(eq(invitations.id, id), eq(invitations.status, 'pending')));
    },

    async revoke(ctx: TenantContext, id: string, updatedAt: string): Promise<boolean> {
      const result = await db
        .update(invitations)
        .set({ status: 'revoked', updatedAt })
        .where(
          and(
            eq(invitations.id, id),
            eq(invitations.organizationId, ctx.organizationId),
            eq(invitations.status, 'pending'),
          ),
        )
        .returning({ id: invitations.id });
      return result.length > 0;
    },

    async listForOrganization(ctx: TenantContext): Promise<InvitationRow[]> {
      return db.query.invitations.findMany({
        where: eq(invitations.organizationId, ctx.organizationId),
      });
    },
  };
}

export type InvitationsRepository = ReturnType<typeof createInvitationsRepository>;
