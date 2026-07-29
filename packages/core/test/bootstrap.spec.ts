import { describe, expect, it } from 'vitest';

import { runAdminBootstrap } from '../src/auth/bootstrap';
import { createTestWorld, registerVerifiedUser } from './helpers';

describe('initial administrator bootstrap (ADR-0015)', () => {
  it('promotes the matching verified account exactly once, with one audit event', async () => {
    const world = createTestWorld({ initialAdminEmail: 'admin@ironsidepress.net' });
    const { principal } = await registerVerifiedUser(world, {
      name: 'First Admin',
      email: 'admin@ironsidepress.net',
      password: 'a-strong-password',
    });

    expect(principal.platformRole).toBe('admin');

    const bootstrapEvents = (await world.services.audit.listAll(100)).filter(
      (event) => event.action === 'auth.admin_bootstrapped',
    );
    expect(bootstrapEvents).toHaveLength(1);
    expect(bootstrapEvents[0]?.actorType).toBe('system');

    // Replaying the check is a no-op: no second promotion, no second audit row.
    const outcome = await runAdminBootstrap({
      db: world.services.db,
      audit: world.services.audit,
      clock: world.clock,
      initialAdminEmail: 'admin@ironsidepress.net',
      user: {
        id: principal.userId,
        email: principal.email,
        emailVerified: true,
        platformRole: 'admin',
      },
    });
    expect(outcome).toBe('already_promoted');
    const after = (await world.services.audit.listAll(100)).filter(
      (event) => event.action === 'auth.admin_bootstrapped',
    );
    expect(after).toHaveLength(1);
  });

  it('never promotes a non-matching account', async () => {
    const world = createTestWorld({ initialAdminEmail: 'admin@ironsidepress.net' });
    const { principal } = await registerVerifiedUser(world, {
      name: 'Ordinary Client',
      email: 'client@example.com',
      password: 'a-strong-password',
    });
    expect(principal.platformRole).toBeNull();
  });

  it('does nothing when INITIAL_ADMIN_EMAIL is not configured', async () => {
    const world = createTestWorld();
    const { principal } = await registerVerifiedUser(world, {
      name: 'Would-be Admin',
      email: 'no-bootstrap-configured@example.com',
      password: 'a-strong-password',
    });
    expect(principal.platformRole).toBeNull();
    const events = (await world.services.audit.listAll(100)).filter(
      (event) =>
        event.action === 'auth.admin_bootstrapped' && event.resourceId === principal.userId,
    );
    expect(events).toHaveLength(0);
  });

  it('matches the email case-insensitively but only when verified', async () => {
    const world = createTestWorld({ initialAdminEmail: 'Bootstrap-Case@Example.com' });
    const { principal } = await registerVerifiedUser(world, {
      name: 'Case Test',
      email: 'bootstrap-case@example.com',
      password: 'a-strong-password',
    });
    expect(principal.platformRole).toBe('admin');
  });

  it('promotes an already-verified account when INITIAL_ADMIN_EMAIL is set later', async () => {
    // Ops scenario: the account existed and verified before the variable was
    // configured; the ADR-0015 re-check in getPrincipal must still converge.
    const before = createTestWorld();
    await registerVerifiedUser(before, {
      name: 'Late Admin',
      email: 'late-admin@example.com',
      password: 'a-strong-password',
    });

    const after = createTestWorld({ initialAdminEmail: 'late-admin@example.com' });
    const { signIn, principalFor } = await import('./helpers');
    const { cookie } = await signIn(after, {
      email: 'late-admin@example.com',
      password: 'a-strong-password',
    });
    const principal = await principalFor(after, cookie);
    expect(principal?.platformRole).toBe('admin');

    const events = (await after.services.audit.listAll(200)).filter(
      (event) =>
        event.action === 'auth.admin_bootstrapped' && event.resourceId === principal?.userId,
    );
    expect(events).toHaveLength(1);
  });
});
