/**
 * @website-factory/core — domain services, authorization and the auth adapter.
 * Business logic lives here, never in UI components or route handlers.
 */
export { newId } from './ids';
export { systemClock, isoNow, FixedClock, type Clock } from './clock';
export { DomainError, notFound, forbidden, unauthenticated, type DomainErrorCode } from './errors';
export {
  ConsoleEmailSender,
  InMemoryEmailSender,
  type EmailSender,
  type OutboundEmail,
} from './email';
export { AuditService } from './audit';
export {
  requirePrincipal,
  requireVerified,
  requireTenantPermission,
  requirePlatformPermission,
  type TenantPermission,
  type PlatformPermission,
} from './authz';
export { userActor, SYSTEM_ACTOR, type Principal, type Membership, type Actor } from './principal';
export { createAuthService, type AuthService, type AuthServiceConfig } from './auth/service';
export { runAdminBootstrap, type BootstrapOutcome } from './auth/bootstrap';
export { OrganizationService } from './services/organizations';
export { InvitationService } from './services/invitations';
export { IntakeService, type IntakeView } from './services/intake';
export { FileService, type FileDownload } from './services/files';
export { ProjectService, type ProjectTimeline, type TimelineEntry } from './services/projects';
export * from './state-machine';
export { createCoreServices, type CoreServices, type CoreServicesConfig } from './container';
