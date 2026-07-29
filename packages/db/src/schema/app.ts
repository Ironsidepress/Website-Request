import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
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
