# Security Model

## Principles

1. **No custom auth or cryptography.** Authentication, session management, password
   hashing and token generation come from an established library (ADR-0003) plus
   platform primitives (Web Crypto for checksums only).
2. **Tenant isolation is enforced in one place.** A repository/data-access layer is
   the only code allowed to touch D1; every tenant-scoped method takes a
   `TenantContext` and injects `organization_id` into the query. Handlers and UI
   never build tenant filters themselves.
3. **Deny by default.** Permissions are explicit allowlists (roles → permissions →
   handler checks; agent contracts → dispatcher enforcement).
4. **Everything is attributable.** Every mutation records an actor
   (`user` / `agent` / `system`) in the audit log.
5. **Secrets never enter source, docs, logs or artifacts.**

## Authentication

- Email + password with verification, via the chosen auth library configured for
  Workers + D1. Password policy, hashing, session rotation and reset flows are the
  library's, not ours.
- Sessions: HTTP-only, `Secure`, `SameSite=Lax` cookies; server-side session state in
  D1 (library-managed). No JWTs in localStorage.
- Staff accounts use the same auth system but are flagged by `users.platform_role`;
  staff signup is invite-only (no self-serve staff registration). MFA for staff is a
  fast-follow (ADR-0011).

## Authorization

- **Session → principal → permission set** resolution happens in one middleware.
  Route handlers declare required permissions; a central check enforces them.
- Tenant-scoped requests resolve the organization from the authenticated
  membership — never solely from a URL or body parameter. A client-supplied org id
  that doesn't match an authenticated membership is a 404 (not 403, to avoid
  existence leaks).
- Staff cross-tenant access is permitted by platform role, and each cross-tenant read
  of client data is audit-logged.
- Approval decisions additionally check the gate's `required_roles` and the
  separation-of-duties rule (an approver cannot be the creator of the artifact under
  review). See `docs/user-roles.md`.

## Tenant isolation checklist (enforced by code review + tests)

- [ ] Every table with `organization_id` is only accessed through tenant-scoped
      repository methods.
- [ ] Repository methods for tenant tables require `TenantContext` in their type
      signature — untyped/raw D1 access is lint-banned outside the data layer.
- [ ] Integration tests assert cross-tenant reads/writes fail for every endpoint
      (see `docs/testing-strategy.md`).
- [ ] List endpoints paginate and filter by tenant before any other predicate.
- [ ] R2 keys are prefixed `{organization_id}/…` and download URLs are minted only
      after a tenant-checked D1 lookup of the `files` row — bucket contents are never
      listed to clients, and R2 is never publicly readable.

## Input validation

- All external input (API bodies, query params, webhook payloads, workflow event
  payloads) is validated with shared Zod schemas before use. Unvalidated data does
  not cross the boundary into business logic.
- File uploads: server-side allowlist of content types
  (images, PDF, common document formats), size caps (default 25 MB/file,
  per-tenant quota), randomized R2 keys (no user-controlled paths), and
  `Content-Disposition: attachment` on download of anything not an image.
  Files are served via short-lived signed URLs, never public buckets.
- HTML output is escaped by default (React); any rich-text rendering (post-MVP)
  requires sanitization — no `dangerouslySetInnerHTML` of user content.

## Workflow & approval integrity

- Approval decisions are recorded **only** by the authenticated API route, which
  writes D1 + audit log, then signals the workflow. The workflow verifies the D1 row
  (status, gate, authorized decider) before acting on any received event — a forged
  or replayed event without a matching row is ignored and logged.
- Workflow event payloads are schema-validated; unknown types/versions are rejected
  to a dead-letter log, never partially processed.
- Admin overrides require reason strings and produce `override.*` audit events.

## Agent containment (design now, enforce when agents go live)

- Agents run only via the dispatcher, under contract allowlists
  (`docs/agent-contracts.md`); code-executing agents run in isolated Cloudflare
  Sandboxes with no ambient credentials.
- Scoped, short-lived tokens per run: GitHub tokens are branch-scoped and cannot
  merge; Figma tokens are file-scoped. Protected `main` branches with required
  reviews are configured on every generated site repo.
- Intake content, uploaded files and web research results are **untrusted data** to
  agents: prompts must treat them as data, never as instructions
  (prompt-injection posture), and agent outputs are schema-validated before storage.
- Clients never see prompts, transcripts, `error_detail`, token counts or costs.

## Secrets management

- Runtime secrets live in Cloudflare secrets (`wrangler secret put`) / dashboard —
  never in `wrangler.toml` vars committed with values, never in code or docs.
- `.dev.vars` for local development is gitignored; `.dev.vars.example` documents
  required keys with placeholder values.
- Structured logs use a serializer that redacts known-sensitive keys; audit-log
  `metadata` is schema-checked to exclude secrets and raw prompt text.
- Automated secret scanning runs in CI (e.g. gitleaks) and on the GitHub repo.

## Error handling

- Client-facing errors are safe, generic and correlation-id tagged
  (`{ code, message, correlationId }`).
- Detailed errors (stack, step, cause chain) go to structured internal logs keyed by
  the same correlation id. `agent_runs.error_detail` and workflow step errors are
  internal-only fields.

## Platform protections

- Cloudflare in front of everything: WAF managed rules, bot fight mode, and rate
  limiting on auth endpoints (login, register, reset) and upload-slot creation.
- CSRF: the auth library's CSRF protection for cookie-based sessions; state-changing
  routes reject cross-origin requests (origin check middleware).
- Security headers: CSP (no third-party scripts in the portal), HSTS,
  `X-Content-Type-Options`, referrer policy — set in one shared middleware.

## Data lifecycle

- Intake revisions, audit logs, workflow events: retained indefinitely for MVP
  (small volume); retention policy is a documented open decision (ADR-0012).
- Organization deletion (post-MVP): soft-delete + scheduled purge of D1 rows and R2
  prefixes; audit logs are retained with the org id but purged of personal data.
