import { eq, and, isNull, isNotNull, count } from 'drizzle-orm';

import type { Database } from '../client';
import { users, type PlatformRole } from '../schema/app';

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

export function createUsersRepository(db: Database) {
  return {
    /** Idempotent on auth_subject: replaying an auth hook never duplicates. */
    async createIfAbsent(row: NewUserRow): Promise<UserRow> {
      await db.insert(users).values(row).onConflictDoNothing({ target: users.authSubject });
      const created = await db.query.users.findFirst({
        where: eq(users.authSubject, row.authSubject),
      });
      if (!created) throw new Error('users.createIfAbsent: row missing after insert');
      return created;
    },

    async findById(id: string): Promise<UserRow | undefined> {
      return db.query.users.findFirst({ where: eq(users.id, id) });
    },

    async findByAuthSubject(authSubject: string): Promise<UserRow | undefined> {
      return db.query.users.findFirst({ where: eq(users.authSubject, authSubject) });
    },

    async findByEmail(email: string): Promise<UserRow | undefined> {
      return db.query.users.findFirst({ where: eq(users.email, email) });
    },

    async setEmailVerified(id: string, updatedAt: string): Promise<void> {
      await db.update(users).set({ emailVerified: true, updatedAt }).where(eq(users.id, id));
    },

    /**
     * Guarded promotion: only sets the role when the user currently has none,
     * so replays converge (ADR-0015). Returns true when a row was changed.
     */
    async promoteToPlatformRole(
      id: string,
      role: PlatformRole,
      updatedAt: string,
    ): Promise<boolean> {
      const result = await db
        .update(users)
        .set({ platformRole: role, updatedAt })
        .where(and(eq(users.id, id), eq(users.emailVerified, true), isNull(users.platformRole)))
        .returning({ id: users.id });
      return result.length > 0;
    },

    async countPlatformStaff(): Promise<number> {
      const rows = await db.select({ n: count() }).from(users).where(isNotNull(users.platformRole));
      return rows[0]?.n ?? 0;
    },
  };
}

export type UsersRepository = ReturnType<typeof createUsersRepository>;
