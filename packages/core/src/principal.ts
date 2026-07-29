import type { OrganizationRole, PlatformRole } from '@website-factory/db';

/** An authenticated human, mapped into the application's user model. */
export interface Principal {
  /** Application user id (users.id) — never the auth-layer subject. */
  userId: string;
  email: string;
  name: string;
  emailVerified: boolean;
  platformRole: PlatformRole | null;
}

export interface Membership {
  organizationId: string;
  role: OrganizationRole;
}

export type Actor =
  { type: 'user'; id: string } | { type: 'agent'; id: string } | { type: 'system'; id: string };

export function userActor(principal: Principal): Actor {
  return { type: 'user', id: principal.userId };
}

export const SYSTEM_ACTOR: Actor = { type: 'system', id: 'platform' };
