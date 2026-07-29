# Architecture Decision Records

Format: lightweight ADRs, one section each. Status: **Accepted**, **Proposed**
(recommended, needs sign-off) or **Open** (genuinely undecided).

---

## ADR-0001 — Cloudflare Workflows is the authoritative orchestrator

**Status: Accepted (mandated)**

Project progression is owned by a durable Cloudflare Workflow per project.
D1 stage fields are projections; agents perform bounded tasks inside steps; approval
gates pause the instance (`waitForEvent` + timeout). Alternatives (cron-driven state
poller, queue-choreography, Temporal) rejected: mandated platform, and Workflows gives
durability, retries and human-in-the-loop pauses natively.

**Consequences:** step code must be idempotent and deterministic-per-step-name; local
testing needs a runner abstraction (see `docs/testing-strategy.md`); Workflows limits
(instance duration, event payload size, concurrent instances) must be respected —
payloads carry ids, not documents.

## ADR-0002 — Monorepo with two deployables (web app + orchestrator worker)

**Status: Accepted (approved 2026-07-29)**

pnpm workspaces + Turborepo. `apps/web` is the Next.js control-plane UI + API,
deployed to Cloudflare Workers via `@opennextjs/cloudflare`. `workers/orchestrator`
is a plain Worker hosting Workflow definitions, queue consumers and scheduled jobs.
Both bind the same D1/R2 and share `packages/*` (schemas, db, core, agents, testing).

Rationale: Workflow classes and queue consumers are cleaner in a dedicated Worker
than inside the OpenNext-generated worker; deploy cadences differ; blast radius
shrinks. Alternative (single worker) rejected for coupling; separate repos rejected
for schema-sharing friction.

## ADR-0003 — Authentication via Better Auth (no custom auth)

**Status: Accepted (approved 2026-07-29)**

Use **Better Auth** self-hosted with its D1/Drizzle adapter for email+password,
email verification, password reset, secure cookie-based sessions and (later) MFA
for staff. It is TypeScript-first, runs on Workers, and keeps session state in our
D1.

Approved requirements binding this decision:

- Email/password auth, email verification, password reset, secure cookie sessions.
- Organization memberships; client (`owner`/`member`), staff and administrator
  roles; **staff accounts are invitation-only**.
- Rate limiting and abuse protection on auth endpoints.
- Audit logging for authentication and authorization events.
- Tenant-aware authorization enforced in the shared repository and domain-service
  layers, not in UI or route handlers.
- No custom password hashing, cryptography or session implementation.
- **Adapter boundary:** Better Auth sits behind an internal `AuthService`
  interface. Better Auth's own database records are never read or written by
  application code; the auth service maps authenticated identities into our
  `users` / `organizations` / `organization_members` model. Replacing Better Auth
  with a hosted provider must not change domain logic.

Alternatives: Auth.js (weaker session/D1 story), Clerk/WorkOS (hosted; vendor cost
and data residency questions), Cloudflare Access (good for staff, wrong for client
self-signup). Building on Lucia's guidance directly = custom auth, prohibited.

## ADR-0004 — Drizzle ORM + wrangler-applied SQL migrations

**Status: Accepted (approved 2026-07-29; implementation begins in M1 — M0 ships no
database tables or migrations by explicit instruction)**

Drizzle schema in `packages/db`; `drizzle-kit generate` produces SQL migrations
committed to the repo and applied with `wrangler d1 migrations apply` (local and CI
against fresh D1, production via deploy pipeline). Satisfies "a migration for every
schema change" with drift checking in CI. Alternatives: raw SQL only (loses typed
queries), Prisma (heavier on Workers/D1), Kysely (fine, but Drizzle's D1 support and
codegen fit better).

## ADR-0005 — Zod schemas in one shared package are the single source of truth

**Status: Accepted (mandated direction)**

`packages/schemas` holds versioned Zod schemas for: intake sections/document, API
requests/responses, workflow event envelope + per-type payloads, agent contracts
(inputs/outputs), and artifact content types. Client, server, workflow and dispatcher
all import from here. DB rows are validated at the data-layer boundary when they
carry JSON columns.

## ADR-0006 — IDs are UUIDv7 strings generated in application code

**Status: Accepted (approved 2026-07-29)**

Time-ordered (index-friendly in SQLite), generated without DB round-trips, safe to
create before insert (needed for idempotency keys and R2 keys). Alternative
autoincrement rejected (leaks volume, awkward across D1 + R2 + external systems).

## ADR-0007 — Intake stored as a versioned JSON document, not normalized tables

**Status: Accepted (approved 2026-07-29)**

`intakes.data` holds the Zod-validated document with `schema_version`; autosave
patches sections and appends `intake_revisions`. Rationale: the intake is an input
artifact consumed whole by the workflow; per-question tables would force a migration
for every question tweak and buy nothing (query needs are status/tenant-level, which
are promoted columns). Files referenced from the document live in `files` rows.
Trade-off: no SQL over answers — acceptable; reporting can JSON-extract later.

## ADR-0008 — Direct-to-R2 uploads via short-lived signed URLs

**Status: Accepted (approved 2026-07-29); amended in M3 — fallback transport in
effect.** The MVP ships the documented fallback: worker-proxied uploads behind
the same slot → upload → confirm API (25 MB/file, per-tenant quota), because
presigned S3-compat URLs require extra credential management and do not work
against local Miniflare R2 (breaking dev and E2E). The transport can move to
presigned PUTs later without changing the API surface. Downloads are served by
authenticated, tenant-checked routes rather than signed URLs — same guarantee
(bucket never public), simpler key management.

Server validates and issues a presigned PUT (S3-compat API); the browser uploads
directly; server verifies and marks `stored`. Workers never proxy file bytes
(CPU/memory limits, cost). Trade-off: presigned-URL credentials management for the
S3 API — held as Worker secrets. Fallback if unacceptable: Worker-proxied multipart
for MVP file sizes.

## ADR-0009 — Simulated production plane behind an `AgentExecutor` interface

**Status: Accepted (mandated by MVP scope)**

The MVP implements dispatcher, contracts, artifacts, agent_runs and the workflow with
a `SimulatedExecutor`. Real executors (Claude Agent SDK in Cloudflare Sandbox, Figma,
GitHub) are post-MVP and must slot in behind the same interface without schema
changes — this is an acceptance criterion.

## ADR-0010 — Approval events verify against D1, not the event alone

**Status: Accepted**

The API route that records a decision is the sole writer; the workflow, on receiving
an approval event (or on poll fallback), re-reads the `approvals` row and acts only
on a valid, authorized, matching decision. Prevents forged/duplicated events from
advancing the pipeline. See `docs/workflow-state-machine.md`.

## ADR-0011 — Staff MFA

**Status: Open (fast-follow)**

Staff accounts should require MFA (TOTP/passkeys via the auth library). Decide
whether it blocks MVP launch or lands immediately after. Leaning: required before
any real client data at production scale.

## ADR-0012 — Data retention and deletion policy

**Status: Open**

Retention for audit logs, intake revisions, workflow events and uploaded files;
org offboarding/purge flow; any regulatory constraints (target market is US small
business — confirm no additional requirements). Not MVP-blocking (soft-delete only),
but must be decided before general availability.

## ADR-0013 — Notification channel for approvals

**Status: Open**

Gates need to reach humans. MVP baseline: in-app indicators only. Email (which
provider — e.g. Resend/SES/Mailchannels?) is likely required for real usage since
clients won't poll the portal. Decision affects `docs/user-flows.md` steps 6–8 but
not the schema (notification events already exist).

## ADR-0014 — Next.js on Workers via OpenNext

**Status: Accepted (approved 2026-07-29)**

Deploy `apps/web` with `@opennextjs/cloudflare` (Workers runtime, bindings available
in route handlers). Risk: OpenNext adapter maturity vs Next.js version churn —
pin versions, keep API routes thin (logic in `packages/core`) so a pivot to
plain Workers + separate static frontend remains cheap. Alternative Cloudflare Pages

- Functions rejected: Workers is the strategic Cloudflare path and we need
  Workflows/Queues bindings alongside.

## ADR-0015 — Initial administrator bootstrap (no seeded credentials)

**Status: Accepted (approved 2026-07-29)**

A single internal administrator suffices for the MVP. No administrator password is
ever seeded or committed. Bootstrap works as follows:

1. The initial administrator **email** is read from an environment variable
   (`INITIAL_ADMIN_EMAIL`), set per environment as configuration — never committed.
2. That person registers through the normal registration flow and completes email
   verification like any user.
3. On (and only on) successful verification, a bootstrap check promotes the
   matching account to `platform_role = 'admin'`.
4. The promotion is **idempotent**: if the account is already an administrator, the
   check is a no-op; it never demotes and never touches any other account.
5. The promotion writes an audit event (`auth.admin_bootstrapped`, actor `system`,
   including the source of authority).
6. All subsequent staff accounts are created by invitation only — the bootstrap
   path applies to at most this one account.
7. Promotion never triggers on unverified email input: the match is evaluated only
   against a **verified** address, and only at verification time or by an explicit
   idempotent re-check — never at registration submission.

**Decommissioning:** once the first administrator exists, unset
`INITIAL_ADMIN_EMAIL` (remove the var/secret from the environment). The bootstrap
check is skipped when the variable is absent, and it logs a warning if the variable
is set while an administrator already exists. Procedure documented in
`docs/environments.md`.

## ADR-0016 — Environment isolation and resource naming

**Status: Accepted (approved 2026-07-29)**

One Cloudflare account with three environments: **local development**, **staging**,
**production**. Each remote environment uses strictly separate resources: D1
database, R2 bucket, Workflow bindings, Queues, secrets (including authentication
secrets) and allowed origins. Staging and production must never share a D1
database, R2 bucket or authentication secret.

Naming convention:

| Resource            | Staging                                | Production                                |
| ------------------- | -------------------------------------- | ----------------------------------------- |
| Web worker          | `website-factory-staging`              | `website-factory-production`              |
| Orchestrator worker | `website-factory-orchestrator-staging` | `website-factory-orchestrator-production` |
| D1 database         | `website-factory-db-staging`           | `website-factory-db-production`           |
| R2 bucket           | `website-factory-assets-staging`       | `website-factory-assets-production`       |
| Queue               | `website-factory-events-staging`       | `website-factory-events-production`       |

Rules:

- Staging is served from `workers.dev` initially; custom domains are optional and
  documented for later (`docs/environments.md`).
- Local development runs on Wrangler/Miniflare local resources and **must not
  connect to production data by default**; remote bindings require explicit,
  deliberate flags.
- No real resource IDs or secrets in committed files — wrangler configs carry
  documented placeholders; `.dev.vars.example` documents required local variables.
- Production resources are provisioned only by explicit human-confirmed commands
  (documented in `docs/environments.md`), never automatically by tooling or CI.

---

## Decision index

| ADR  | Topic                                        | Status               |
| ---- | -------------------------------------------- | -------------------- |
| 0001 | Workflows as orchestrator                    | Accepted             |
| 0002 | Monorepo, two deployables                    | Accepted             |
| 0003 | Better Auth behind internal adapter          | Accepted             |
| 0004 | Drizzle + wrangler migrations                | Accepted (starts M1) |
| 0005 | Shared Zod schemas                           | Accepted             |
| 0006 | UUIDv7 ids                                   | Accepted             |
| 0007 | Intake as JSON document                      | Accepted             |
| 0008 | Direct-to-R2 uploads                         | Accepted             |
| 0009 | Simulated agents behind interface            | Accepted             |
| 0010 | D1-verified approvals                        | Accepted             |
| 0011 | Staff MFA timing                             | Open                 |
| 0012 | Retention policy                             | Open                 |
| 0013 | Notification channel                         | Open                 |
| 0014 | OpenNext on Workers                          | Accepted             |
| 0015 | Admin bootstrap via verified email promotion | Accepted             |
| 0016 | Environment isolation and naming             | Accepted             |
