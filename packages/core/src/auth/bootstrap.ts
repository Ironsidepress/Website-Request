import type { Database, UserRow } from '@website-factory/db';
import { createUsersRepository } from '@website-factory/db';

import type { AuditService } from '../audit';
import type { Clock } from '../clock';
import { isoNow } from '../clock';
import { SYSTEM_ACTOR } from '../principal';

export type BootstrapOutcome = 'promoted' | 'no_match' | 'already_promoted' | 'disabled';

/**
 * Initial administrator bootstrap (ADR-0015).
 *
 * Called after a user's email address is verified (and re-checked lazily on
 * session resolution, which makes lost hooks harmless). Only ever promotes a
 * VERIFIED account whose email matches INITIAL_ADMIN_EMAIL; never demotes,
 * never touches other accounts, and is idempotent — the guarded update in the
 * repository ensures exactly one promotion (and one audit event) even under
 * concurrent invocation.
 *
 * Decommissioning: remove INITIAL_ADMIN_EMAIL from the environment after the
 * first administrator exists (docs/environments.md); with it absent this
 * function is a no-op.
 */
export async function runAdminBootstrap(options: {
  db: Database;
  audit: AuditService;
  clock: Clock;
  initialAdminEmail: string | undefined;
  user: Pick<UserRow, 'id' | 'email' | 'emailVerified' | 'platformRole'>;
}): Promise<BootstrapOutcome> {
  const { db, audit, clock, initialAdminEmail, user } = options;

  if (!initialAdminEmail) return 'disabled';
  if (!user.emailVerified) return 'no_match';
  if (user.email.trim().toLowerCase() !== initialAdminEmail.trim().toLowerCase()) {
    return 'no_match';
  }

  const users = createUsersRepository(db);
  const promoted = await users.promoteToPlatformRole(user.id, 'admin', isoNow(clock));

  if (!promoted) {
    console.warn(
      JSON.stringify({
        event: 'auth.bootstrap_noop',
        message:
          'INITIAL_ADMIN_EMAIL is set but the matching account already holds a platform role. ' +
          'Remove the variable — bootstrap is complete (docs/environments.md).',
      }),
    );
    return 'already_promoted';
  }

  await audit.record({
    action: 'auth.admin_bootstrapped',
    resourceType: 'user',
    resourceId: user.id,
    organizationId: null,
    actor: SYSTEM_ACTOR,
    metadata: { source: 'initial_admin_email_bootstrap' },
  });
  return 'promoted';
}
