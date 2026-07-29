import { eq, and } from 'drizzle-orm';

import type { Database } from '../client';
import type { TenantContext } from '../tenant';
import { organizations, organizationMembers, users, type OrganizationRole } from '../schema/app';

export type OrganizationRow = typeof organizations.$inferSelect;
export type NewOrganizationRow = typeof organizations.$inferInsert;
export type MembershipRow = typeof organizationMembers.$inferSelect;

export function createOrganizationsRepository(db: Database) {
  return {
    /** Atomic create: organization + owner membership in one D1 batch. */
    async createWithOwner(
      org: NewOrganizationRow,
      ownerUserId: string,
      createdAt: string,
    ): Promise<void> {
      await db.batch([
        db.insert(organizations).values(org),
        db.insert(organizationMembers).values({
          organizationId: org.id,
          userId: ownerUserId,
          role: 'owner',
          createdAt,
        }),
      ]);
    },

    async findById(ctx: TenantContext): Promise<OrganizationRow | undefined> {
      return db.query.organizations.findFirst({
        where: eq(organizations.id, ctx.organizationId),
      });
    },

    async listForUser(
      userId: string,
    ): Promise<Array<{ organization: OrganizationRow; role: OrganizationRole }>> {
      const rows = await db
        .select({ organization: organizations, role: organizationMembers.role })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
        .where(eq(organizationMembers.userId, userId));
      return rows;
    },

    async findMembership(
      organizationId: string,
      userId: string,
    ): Promise<MembershipRow | undefined> {
      return db.query.organizationMembers.findFirst({
        where: and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.userId, userId),
        ),
      });
    },

    async addMember(
      ctx: TenantContext,
      userId: string,
      role: OrganizationRole,
      createdAt: string,
    ): Promise<void> {
      await db
        .insert(organizationMembers)
        .values({ organizationId: ctx.organizationId, userId, role, createdAt })
        .onConflictDoNothing();
    },

    async listMembers(
      ctx: TenantContext,
    ): Promise<Array<{ userId: string; role: OrganizationRole; name: string; email: string }>> {
      return db
        .select({
          userId: organizationMembers.userId,
          role: organizationMembers.role,
          name: users.name,
          email: users.email,
        })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(eq(organizationMembers.organizationId, ctx.organizationId));
    },
  };
}

export type OrganizationsRepository = ReturnType<typeof createOrganizationsRepository>;
