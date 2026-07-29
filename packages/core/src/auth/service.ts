import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { Database } from '@website-factory/db';
import { createUsersRepository, schema } from '@website-factory/db';

import type { AuditService } from '../audit';
import type { Clock } from '../clock';
import { isoNow } from '../clock';
import type { EmailSender } from '../email';
import { newId } from './../ids';
import type { Principal } from '../principal';
import { SYSTEM_ACTOR } from '../principal';
import { runAdminBootstrap } from './bootstrap';

/**
 * AuthService — the internal adapter boundary mandated by ADR-0003.
 *
 * Everything auth-related flows through this interface. Better Auth is an
 * implementation detail behind it: its database records are never read or
 * written by application code, and swapping in a hosted provider must only
 * require a new implementation of this interface.
 */
export interface AuthService {
  /** Mounts the auth HTTP endpoints (sign-up, sign-in, verify, reset, …). */
  handleRequest(request: Request): Promise<Response>;
  /** Resolves the request's session into an application Principal. */
  getPrincipal(headers: Headers): Promise<Principal | null>;
}

export interface AuthServiceConfig {
  db: Database;
  clock: Clock;
  emailSender: EmailSender;
  audit: AuditService;
  secret: string;
  baseUrl: string;
  allowedOrigins: string[];
  initialAdminEmail?: string | undefined;
  /**
   * Rate limiting is always on in real deployments; tests may disable it to
   * keep fixtures deterministic (a dedicated spec covers the limiter itself).
   */
  rateLimitEnabled?: boolean | undefined;
}

export function createAuthService(config: AuthServiceConfig): AuthService {
  const { db, clock, emailSender, audit } = config;
  const users = createUsersRepository(db);

  const auth = betterAuth({
    secret: config.secret,
    baseURL: config.baseUrl,
    basePath: '/api/auth',
    trustedOrigins: config.allowedOrigins,
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema: {
        user: schema.baUser,
        session: schema.baSession,
        account: schema.baAccount,
        verification: schema.baVerification,
        rateLimit: schema.baRateLimit,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        await emailSender.send({
          to: user.email,
          subject: 'Reset your Website Factory password',
          text: `Reset your password using this link:\n\n${url}\n\nIf you did not request this, you can ignore this email.`,
        });
        await audit.record({
          action: 'auth.password_reset_requested',
          resourceType: 'auth_user',
          resourceId: user.id,
          organizationId: null,
          actor: SYSTEM_ACTOR,
        });
      },
      onPasswordReset: async ({ user }) => {
        await audit.record({
          action: 'auth.password_reset',
          resourceType: 'auth_user',
          resourceId: user.id,
          organizationId: null,
          actor: SYSTEM_ACTOR,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await emailSender.send({
          to: user.email,
          subject: 'Verify your Website Factory email address',
          text: `Welcome to Website Factory. Verify your email address using this link:\n\n${url}`,
        });
      },
      afterEmailVerification: async (baUser) => {
        const appUser = await ensureAppUser(baUser.id, baUser.email, baUser.name);
        await users.setEmailVerified(appUser.id, isoNow(clock));
        await audit.record({
          action: 'auth.email_verified',
          resourceType: 'user',
          resourceId: appUser.id,
          organizationId: null,
          actor: { type: 'user', id: appUser.id },
        });
        await runAdminBootstrap({
          db,
          audit,
          clock,
          initialAdminEmail: config.initialAdminEmail,
          user: { ...appUser, emailVerified: true },
        });
      },
    },
    rateLimit: {
      enabled: config.rateLimitEnabled ?? true,
      storage: 'database',
      window: 60,
      max: 60,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 5 },
        '/forget-password': { window: 300, max: 3 },
        '/reset-password': { window: 300, max: 5 },
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (baUser) => {
            const appUser = await ensureAppUser(baUser.id, baUser.email, baUser.name);
            await audit.record({
              action: 'auth.user_registered',
              resourceType: 'user',
              resourceId: appUser.id,
              organizationId: null,
              actor: { type: 'user', id: appUser.id },
            });
          },
        },
      },
      session: {
        create: {
          after: async (session) => {
            const appUser = await users.findByAuthSubject(session.userId);
            if (appUser) {
              await audit.record({
                action: 'auth.login',
                resourceType: 'user',
                resourceId: appUser.id,
                organizationId: null,
                actor: { type: 'user', id: appUser.id },
              });
            }
          },
        },
      },
    },
  });

  /** Idempotent identity mapping: auth subject → application user row. */
  async function ensureAppUser(authSubject: string, email: string, name: string) {
    const now = isoNow(clock);
    return users.createIfAbsent({
      id: newId(),
      authSubject,
      email,
      name: name || email,
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  return {
    handleRequest: (request) => auth.handler(request),

    async getPrincipal(headers) {
      const session = await auth.api.getSession({ headers });
      if (!session) return null;

      const baUser = session.user;
      let appUser = await users.findByAuthSubject(baUser.id);
      if (!appUser) {
        appUser = await ensureAppUser(baUser.id, baUser.email, baUser.name);
      }

      // Lazy re-sync: if verification happened but the hook was lost, converge
      // here.
      if (baUser.emailVerified && !appUser.emailVerified) {
        await users.setEmailVerified(appUser.id, isoNow(clock));
        appUser = { ...appUser, emailVerified: true };
      }

      // ADR-0015 "explicit idempotent re-check": promote the verified matching
      // account even when INITIAL_ADMIN_EMAIL was set after verification. The
      // bootstrap short-circuits on mismatch and never demotes or re-promotes.
      if (
        config.initialAdminEmail &&
        appUser.emailVerified &&
        appUser.platformRole === null &&
        appUser.email.trim().toLowerCase() === config.initialAdminEmail.trim().toLowerCase()
      ) {
        await runAdminBootstrap({
          db,
          audit,
          clock,
          initialAdminEmail: config.initialAdminEmail,
          user: appUser,
        });
        const refreshed = await users.findById(appUser.id);
        if (refreshed) appUser = refreshed;
      }

      return {
        userId: appUser.id,
        email: appUser.email,
        name: appUser.name,
        emailVerified: baUser.emailVerified,
        platformRole: appUser.platformRole,
      };
    },
  };
}
