import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/sqlite-core';

/**
 * Application tables (docs/data-model.md, M1 subset).
 *
 * Conventions: UUIDv7 string ids generated in application code (ADR-0006);
 * ISO-8601 UTC TEXT timestamps named *_at; every tenant-owned table carries
 * organization_id and is only reachable through tenant-scoped repositories.
 */

export const PLATFORM_ROLES = ['admin', 'reviewer', 'operator'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const ORGANIZATION_ROLES = ['owner', 'member'] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    /** Better Auth subject id — the only link to the auth layer (ADR-0003). */
    authSubject: text('auth_subject').notNull(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    platformRole: text('platform_role', { enum: PLATFORM_ROLES }),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_users_auth_subject').on(table.authSubject),
    uniqueIndex('idx_users_email').on(table.email),
  ],
);

export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  contactEmail: text('contact_email').notNull(),
  phone: text('phone'),
  status: text('status', { enum: ['active', 'suspended'] })
    .notNull()
    .default('active'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const organizationMembers = sqliteTable(
  'organization_members',
  {
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role', { enum: ORGANIZATION_ROLES }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId] }),
    index('idx_members_user').on(table.userId),
  ],
);

export const INVITATION_KINDS = ['organization_member', 'staff'] as const;
export type InvitationKind = (typeof INVITATION_KINDS)[number];

export const INVITATION_STATUSES = ['pending', 'accepted', 'revoked', 'expired'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const invitations = sqliteTable(
  'invitations',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: INVITATION_KINDS }).notNull(),
    /** NULL for staff invitations; required for organization_member. */
    organizationId: text('organization_id').references(() => organizations.id),
    email: text('email').notNull(),
    /** organization role for member invites; platform role for staff invites. */
    role: text('role').notNull(),
    /** SHA-256 hex of the invitation token; the raw token is never stored. */
    tokenHash: text('token_hash').notNull(),
    status: text('status', { enum: INVITATION_STATUSES }).notNull().default('pending'),
    invitedBy: text('invited_by')
      .notNull()
      .references(() => users.id),
    expiresAt: text('expires_at').notNull(),
    acceptedAt: text('accepted_at'),
    acceptedBy: text('accepted_by').references(() => users.id),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_invitations_token_hash').on(table.tokenHash),
    index('idx_invitations_org').on(table.organizationId, table.status),
    index('idx_invitations_email').on(table.email, table.status),
  ],
);

export const FILE_PURPOSES = ['logo', 'brand_guide', 'photo', 'copy_document', 'other'] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

export const FILE_STATUSES = ['pending', 'stored', 'failed', 'deleted'] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

export const files = sqliteTable(
  'files',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    intakeId: text('intake_id').references(() => intakes.id),
    projectId: text('project_id'),
    /** {organization_id}/{file_id}/{sanitized_name} — never user-controlled paths. */
    r2Key: text('r2_key').notNull(),
    originalName: text('original_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    checksumSha256: text('checksum_sha256'),
    purpose: text('purpose', { enum: FILE_PURPOSES }).notNull(),
    status: text('status', { enum: FILE_STATUSES }).notNull().default('pending'),
    uploadedBy: text('uploaded_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_files_r2_key').on(table.r2Key),
    index('idx_files_org').on(table.organizationId, table.status),
    index('idx_files_intake').on(table.intakeId),
  ],
);

export const INTAKE_STATUSES = ['draft', 'submitted', 'archived'] as const;
export type IntakeStatus = (typeof INTAKE_STATUSES)[number];

export const intakes = sqliteTable(
  'intakes',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    status: text('status', { enum: INTAKE_STATUSES }).notNull().default('draft'),
    schemaVersion: integer('schema_version').notNull(),
    /** JSON IntakeDocument (draft-relaxed until submission freezes it). */
    data: text('data').notNull(),
    currentRevision: integer('current_revision').notNull().default(0),
    submittedAt: text('submitted_at'),
    submittedBy: text('submitted_by').references(() => users.id),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_intakes_org').on(table.organizationId, table.status),
    // One active draft per organization.
    uniqueIndex('idx_intakes_one_draft')
      .on(table.organizationId)
      .where(sql`status = 'draft'`),
  ],
);

/** Append-only autosave history; UNIQUE(intake_id, revision) doubles as the
 *  optimistic-concurrency guard for autosave writes. */
export const intakeRevisions = sqliteTable(
  'intake_revisions',
  {
    id: text('id').primaryKey(),
    intakeId: text('intake_id')
      .notNull()
      .references(() => intakes.id),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    revision: integer('revision').notNull(),
    sectionId: text('section_id').notNull(),
    /** JSON snapshot of the section after this write. */
    sectionData: text('section_data').notNull(),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_intake_revisions_unique').on(table.intakeId, table.revision),
    index('idx_intake_revisions_org').on(table.organizationId),
  ],
);

export const ACTOR_TYPES = ['user', 'agent', 'system'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const ARTIFACT_STATUSES = ['draft', 'approved', 'rejected', 'superseded'] as const;
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];

/** Immutable per version; rework creates version N+1 (docs/data-model.md). */
export const artifacts = sqliteTable(
  'artifacts',
  {
    artifactId: text('artifact_id').notNull(),
    version: integer('version').notNull(),
    projectId: text('project_id').notNull(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    type: text('type').notNull(),
    status: text('status', { enum: ARTIFACT_STATUSES }).notNull().default('draft'),
    storage: text('storage', { enum: ['inline', 'r2', 'external_ref'] }).notNull(),
    content: text('content'),
    r2Key: text('r2_key'),
    externalRef: text('external_ref'),
    hasUnverifiedClaims: integer('has_unverified_claims', { mode: 'boolean' })
      .notNull()
      .default(false),
    createdByType: text('created_by_type', { enum: ['user', 'agent', 'system'] }).notNull(),
    createdById: text('created_by_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.artifactId, table.version] }),
    index('idx_artifacts_project').on(table.projectId, table.type, table.status),
  ],
);

export const AGENT_RUN_STATUSES = [
  'running',
  'succeeded',
  'failed',
  'timed_out',
  'cancelled',
] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

/** Every agent execution's audit record — all fields mandated by CLAUDE.md. */
export const agentRuns = sqliteTable(
  'agent_runs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    agentType: text('agent_type').notNull(),
    contractVersion: integer('contract_version').notNull(),
    promptVersion: text('prompt_version').notNull(),
    inputArtifacts: text('input_artifacts').notNull(),
    outputArtifacts: text('output_artifacts'),
    model: text('model').notNull(),
    status: text('status', { enum: AGENT_RUN_STATUSES }).notNull().default('running'),
    retryCount: integer('retry_count').notNull().default(0),
    startedAt: text('started_at').notNull(),
    completedAt: text('completed_at'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    estimatedCostUsd: real('estimated_cost_usd'),
    /** Internal only; never sent to clients. */
    errorDetail: text('error_detail'),
    idempotencyKey: text('idempotency_key').notNull(),
    transcriptR2Key: text('transcript_r2_key'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_agent_runs_idempotency').on(table.idempotencyKey),
    index('idx_agent_runs_project').on(table.projectId, table.startedAt),
  ],
);

export const PROJECT_STATUSES = ['active', 'on_hold', 'cancelled', 'completed'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_HEALTH = ['ok', 'needs_attention'] as const;
export type ProjectHealth = (typeof PROJECT_HEALTH)[number];

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    intakeId: text('intake_id')
      .notNull()
      .references(() => intakes.id),
    name: text('name').notNull(),
    /** Projection of workflow progress; the workflow is authoritative (ADR-0001). */
    currentStage: text('current_stage').notNull().default('created'),
    status: text('status', { enum: PROJECT_STATUSES }).notNull().default('active'),
    health: text('health', { enum: PROJECT_HEALTH }).notNull().default('ok'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_projects_org').on(table.organizationId),
    index('idx_projects_stage').on(table.currentStage, table.status),
    // One project per intake — makes submission idempotent at the schema level.
    uniqueIndex('idx_projects_intake').on(table.intakeId),
  ],
);

/** Append-only. */
export const projectStageHistory = sqliteTable(
  'project_stage_history',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    fromStage: text('from_stage'),
    toStage: text('to_stage').notNull(),
    attempt: integer('attempt').notNull().default(1),
    eventType: text('event_type').notNull(),
    actorType: text('actor_type', { enum: ACTOR_TYPES }).notNull(),
    actorId: text('actor_id').notNull(),
    workflowInstanceId: text('workflow_instance_id'),
    clientVisible: integer('client_visible', { mode: 'boolean' }).notNull().default(true),
    /** JSON, schema-versioned per event type. */
    metadata: text('metadata'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_history_project').on(table.projectId, table.createdAt)],
);

export const workflowRuns = sqliteTable(
  'workflow_runs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    workflowName: text('workflow_name').notNull(),
    cfInstanceId: text('cf_instance_id').notNull(),
    status: text('status', {
      enum: ['running', 'paused', 'completed', 'failed', 'terminated'],
    })
      .notNull()
      .default('running'),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_wfruns_instance').on(table.cfInstanceId),
    index('idx_wfruns_project').on(table.projectId),
  ],
);

/** Append-only audit spine of orchestration; idempotency_key makes retries safe. */
export const workflowEvents = sqliteTable(
  'workflow_events',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    workflowRunId: text('workflow_run_id').references(() => workflowRuns.id),
    type: text('type').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    actorType: text('actor_type', { enum: ACTOR_TYPES }).notNull(),
    actorId: text('actor_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    payload: text('payload').notNull(),
    occurredAt: text('occurred_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_wfevents_idempotency').on(table.idempotencyKey),
    index('idx_wfevents_project').on(table.projectId, table.occurredAt),
  ],
);

/** Append-only: the data layer exposes insert/select only for this table. */
export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id'),
    actorType: text('actor_type', { enum: ACTOR_TYPES }).notNull(),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    ipAddress: text('ip_address'),
    /** JSON, validated by auditMetadataSchema — must never contain secrets. */
    metadata: text('metadata'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_audit_org').on(table.organizationId, table.createdAt),
    index('idx_audit_resource').on(table.resourceType, table.resourceId),
  ],
);
