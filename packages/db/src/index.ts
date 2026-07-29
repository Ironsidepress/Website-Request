/**
 * @website-factory/db — Drizzle schema, migrations and tenant-scoped repositories.
 *
 * Rules (docs/security-model.md):
 * - This package is the only code allowed to touch D1.
 * - Tenant-owned tables are only reachable through repository methods that
 *   require a TenantContext.
 * - Better Auth tables (schema/auth.ts) are owned by the auth library and are
 *   exported solely so the auth adapter in @website-factory/core can hand them
 *   to Better Auth — application code must never query them.
 */
export { createDb, type Database } from './client';
export { tenantContext, type TenantContext } from './tenant';
export * as schema from './schema';
export {
  PLATFORM_ROLES,
  ORGANIZATION_ROLES,
  INVITATION_KINDS,
  INVITATION_STATUSES,
  INTAKE_STATUSES,
  FILE_PURPOSES,
  FILE_STATUSES,
  PROJECT_STATUSES,
  PROJECT_HEALTH,
  ARTIFACT_STATUSES,
  AGENT_RUN_STATUSES,
  APPROVAL_GATE_TYPES,
  APPROVAL_STATUSES,
  ACTOR_TYPES,
  type PlatformRole,
  type OrganizationRole,
  type InvitationKind,
  type InvitationStatus,
  type IntakeStatus,
  type FilePurpose,
  type FileStatus,
  type ProjectStatus,
  type ProjectHealth,
  type ArtifactStatus,
  type AgentRunStatus,
  type ApprovalGateType,
  type ApprovalStatus,
  type ActorType,
} from './schema/app';
export {
  createUsersRepository,
  type UsersRepository,
  type UserRow,
  type NewUserRow,
} from './repositories/users';
export {
  createOrganizationsRepository,
  type OrganizationsRepository,
  type OrganizationRow,
  type NewOrganizationRow,
  type MembershipRow,
} from './repositories/organizations';
export {
  createInvitationsRepository,
  type InvitationsRepository,
  type InvitationRow,
  type NewInvitationRow,
} from './repositories/invitations';
export {
  createAuditRepository,
  type AuditRepository,
  type AuditLogRow,
  type NewAuditLogRow,
} from './repositories/audit';
export {
  createFilesRepository,
  type FilesRepository,
  type FileRow,
  type NewFileRow,
} from './repositories/files';
export {
  createIntakesRepository,
  IntakeConflictError,
  type IntakesRepository,
  type IntakeRow,
  type NewIntakeRow,
  type IntakeRevisionRow,
  type NewIntakeRevisionRow,
} from './repositories/intakes';
export {
  createProjectsRepository,
  type ProjectsRepository,
  type ProjectRow,
  type NewProjectRow,
  type StageHistoryRow,
  type NewStageHistoryRow,
  type WorkflowEventRow,
  type NewWorkflowEventRow,
  type WorkflowRunRow,
  type NewWorkflowRunRow,
} from './repositories/projects';
export {
  createApprovalsRepository,
  type ApprovalsRepository,
  type ApprovalRow,
  type NewApprovalRow,
} from './repositories/approvals';
export {
  createPipelineRepository,
  type PipelineRepository,
  type ArtifactRow,
  type NewArtifactRow,
  type AgentRunRow,
  type NewAgentRunRow,
} from './repositories/pipeline';
