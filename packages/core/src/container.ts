import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { createDb, type Database } from '@website-factory/db';
import { parseEnv, webEnvSchema, type WebEnv } from '@website-factory/schemas';

import { AuditService } from './audit';
import { ApprovalService, type WorkflowSignaler } from './services/approvals';
import { createAuthService, type AuthService } from './auth/service';
import { systemClock, type Clock } from './clock';
import { ConsoleEmailSender, type EmailSender } from './email';
import { FileService } from './services/files';
import { IntakeService } from './services/intake';
import { ProjectService, type WorkflowStarter } from './services/projects';
import { InvitationService } from './services/invitations';
import { OrganizationService } from './services/organizations';

export interface CoreServicesConfig {
  d1: D1Database;
  r2: R2Bucket;
  /** Raw environment (validated here with webEnvSchema). */
  env: Record<string, unknown>;
  clock?: Clock;
  emailSender?: EmailSender;
  /** Test-only escape hatch; real deployments always rate limit. */
  rateLimitEnabled?: boolean;
  /** Starts the ProjectPipeline workflow on submission; absent in local dev. */
  workflowStarter?: WorkflowStarter;
  /** Wakes a paused gate after a decision is recorded; absent in local dev. */
  workflowSignaler?: WorkflowSignaler;
}

export interface CoreServices {
  db: Database;
  env: WebEnv;
  clock: Clock;
  audit: AuditService;
  auth: AuthService;
  organizations: OrganizationService;
  invitations: InvitationService;
  intake: IntakeService;
  files: FileService;
  projects: ProjectService;
  approvals: ApprovalService;
}

/**
 * Composition root for the web app (and tests). Route handlers call this with
 * the request's Cloudflare bindings and use the returned services — they never
 * construct repositories or touch D1 directly.
 */
export function createCoreServices(config: CoreServicesConfig): CoreServices {
  const env = parseEnv(webEnvSchema, config.env);
  const clock = config.clock ?? systemClock;
  const emailSender = config.emailSender ?? new ConsoleEmailSender();

  const db = createDb(config.d1);
  const audit = new AuditService(db, clock);
  const auth = createAuthService({
    db,
    clock,
    emailSender,
    audit,
    secret: env.BETTER_AUTH_SECRET,
    baseUrl: env.APP_BASE_URL,
    allowedOrigins: env.ALLOWED_ORIGINS,
    initialAdminEmail: env.INITIAL_ADMIN_EMAIL,
    rateLimitEnabled: config.rateLimitEnabled,
  });
  const organizations = new OrganizationService(db, clock, audit);
  const invitations = new InvitationService(
    db,
    clock,
    audit,
    emailSender,
    organizations,
    env.APP_BASE_URL,
  );
  const intake = new IntakeService(db, clock, audit, organizations);
  const files = new FileService(db, config.r2, clock, audit, organizations);
  const projects = new ProjectService(db, clock, audit, organizations, config.workflowStarter);
  const approvals = new ApprovalService(db, clock, audit, organizations, config.workflowSignaler);

  return {
    db,
    env,
    clock,
    audit,
    auth,
    organizations,
    invitations,
    intake,
    files,
    projects,
    approvals,
  };
}
