import { env } from 'cloudflare:test';

import { FixedClock } from '../src/clock';
import { InMemoryEmailSender } from '../src/email';
import { createCoreServices, type CoreServices } from '../src/container';
import type { Principal } from '../src/principal';

export const BASE_URL = 'http://localhost:3000';
const AUTH_BASE = `${BASE_URL}/api/auth`;

export interface TestWorld {
  services: CoreServices;
  emails: InMemoryEmailSender;
  clock: FixedClock;
}

/**
 * Builds the full service graph against the test D1 database, with captured
 * email and a controllable clock. Everything auth-related goes through the
 * public AuthService interface — no Better Auth internals in tests.
 */
export function createTestWorld(options?: {
  initialAdminEmail?: string;
  rateLimitEnabled?: boolean;
}): TestWorld {
  const emails = new InMemoryEmailSender();
  const clock = new FixedClock('2026-07-29T12:00:00.000Z');
  const services = createCoreServices({
    d1: env.DB,
    rateLimitEnabled: options?.rateLimitEnabled ?? false,
    env: {
      APP_ENV: 'development',
      LOG_LEVEL: 'error',
      ALLOWED_ORIGINS: BASE_URL,
      APP_BASE_URL: BASE_URL,
      // Deliberately low-entropy, computed test-only value (min 32 chars) —
      // never a real credential, and shaped so secret scanners stay quiet.
      BETTER_AUTH_SECRET: 'insecure-test-only-'.padEnd(40, 'x'),
      ...(options?.initialAdminEmail ? { INITIAL_ADMIN_EMAIL: options.initialAdminEmail } : {}),
    },
    clock,
    emailSender: emails,
  });
  return { services, emails, clock };
}

function extractUrl(text: string): string {
  const match = text.match(/https?:\/\/\S+/);
  if (!match) throw new Error(`no URL found in email body:\n${text}`);
  return match[0];
}

function cookiesFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .filter((pair): pair is string => Boolean(pair))
    .join('; ');
}

async function authRequest(
  world: TestWorld,
  path: string,
  body: unknown,
  cookie?: string,
): Promise<Response> {
  return world.services.auth.handleRequest(
    new Request(`${AUTH_BASE}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: BASE_URL,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

export async function register(
  world: TestWorld,
  user: { name: string; email: string; password: string },
): Promise<Response> {
  return authRequest(world, '/sign-up/email', user);
}

/** Follows the verification link from the captured email; returns the response. */
export async function verifyEmailFromInbox(world: TestWorld, email: string): Promise<Response> {
  const message = world.emails.lastTo(email);
  if (!message) throw new Error(`no email captured for ${email}`);
  const url = extractUrl(message.text);
  return world.services.auth.handleRequest(new Request(url, { redirect: 'manual' }));
}

export async function signIn(
  world: TestWorld,
  credentials: { email: string; password: string },
): Promise<{ response: Response; cookie: string }> {
  const response = await authRequest(world, '/sign-in/email', credentials);
  return { response, cookie: cookiesFrom(response) };
}

export async function principalFor(world: TestWorld, cookie: string): Promise<Principal | null> {
  return world.services.auth.getPrincipal(new Headers({ cookie }));
}

/** Register → verify → sign in; returns the session cookie and principal. */
export async function registerVerifiedUser(
  world: TestWorld,
  user: { name: string; email: string; password: string },
): Promise<{ cookie: string; principal: Principal }> {
  const signUpResponse = await register(world, user);
  if (!signUpResponse.ok) {
    throw new Error(`sign-up failed: ${signUpResponse.status} ${await signUpResponse.text()}`);
  }
  await verifyEmailFromInbox(world, user.email);
  const { response, cookie } = await signIn(world, user);
  if (!response.ok) {
    throw new Error(`sign-in failed: ${response.status} ${await response.text()}`);
  }
  const principal = await principalFor(world, cookie);
  if (!principal) throw new Error('no principal after sign-in');
  return { cookie, principal };
}

export function extractInvitationToken(world: TestWorld, email: string): string {
  const message = world.emails.lastTo(email);
  if (!message) throw new Error(`no invitation email captured for ${email}`);
  const url = new URL(extractUrl(message.text));
  const token = url.searchParams.get('token');
  if (!token) throw new Error(`invitation email URL has no token: ${url}`);
  return token;
}
