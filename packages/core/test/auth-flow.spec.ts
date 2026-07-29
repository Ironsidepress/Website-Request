import { describe, expect, it } from 'vitest';

import {
  createTestWorld,
  principalFor,
  register,
  registerVerifiedUser,
  signIn,
  verifyEmailFromInbox,
} from './helpers';

describe('authentication flow (through the AuthService adapter)', () => {
  it('registers, sends a verification email, blocks sign-in until verified, then signs in', async () => {
    const world = createTestWorld();
    const user = { name: 'Dana Client', email: 'dana@example.com', password: 'a-strong-password' };

    const signUpResponse = await register(world, user);
    expect(signUpResponse.ok).toBe(true);

    const verificationEmail = world.emails.lastTo(user.email);
    expect(verificationEmail).toBeDefined();
    expect(verificationEmail?.subject).toContain('Verify');

    // Unverified sign-in must be rejected (requireEmailVerification).
    const blocked = await signIn(world, user);
    expect(blocked.response.status).toBe(403);

    await verifyEmailFromInbox(world, user.email);

    const { response, cookie } = await signIn(world, user);
    expect(response.ok).toBe(true);

    const principal = await principalFor(world, cookie);
    expect(principal).not.toBeNull();
    expect(principal?.email).toBe(user.email);
    expect(principal?.emailVerified).toBe(true);
    expect(principal?.platformRole).toBeNull();
  });

  it('records audit events for registration, verification and login', async () => {
    const world = createTestWorld();
    await registerVerifiedUser(world, {
      name: 'Audit Subject',
      email: 'audit@example.com',
      password: 'a-strong-password',
    });

    const events = await world.services.audit.listAll(50);
    const actions = events.map((event) => event.action);
    expect(actions).toContain('auth.user_registered');
    expect(actions).toContain('auth.email_verified');
    expect(actions).toContain('auth.login');
  });

  it('returns no principal for garbage or missing cookies', async () => {
    const world = createTestWorld();
    expect(await principalFor(world, 'better-auth.session_token=forged')).toBeNull();
    expect(await world.services.auth.getPrincipal(new Headers())).toBeNull();
  });

  it('supports the password reset flow end to end', async () => {
    const world = createTestWorld();
    const user = { name: 'Reset Me', email: 'reset@example.com', password: 'original-password' };
    await registerVerifiedUser(world, user);

    const resetRequest = await world.services.auth.handleRequest(
      new Request('http://localhost:3000/api/auth/request-password-reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({ email: user.email, redirectTo: '/reset-password' }),
      }),
    );
    expect(resetRequest.ok).toBe(true);

    const resetEmail = world.emails.lastTo(user.email);
    expect(resetEmail?.subject).toContain('Reset');
    const url = new URL(resetEmail!.text.match(/https?:\/\/\S+/)![0]);
    const token =
      url.pathname.split('/').pop() === 'reset-password'
        ? url.searchParams.get('token')
        : (url.pathname.split('/').pop() ?? null);

    expect(token).toBeTruthy();

    const reset = await world.services.auth.handleRequest(
      new Request('http://localhost:3000/api/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({ newPassword: 'brand-new-password', token }),
      }),
    );
    expect(reset.ok).toBe(true);

    const oldPassword = await signIn(world, user);
    expect(oldPassword.response.ok).toBe(false);
    const newPassword = await signIn(world, { email: user.email, password: 'brand-new-password' });
    expect(newPassword.response.ok).toBe(true);
  });
});
