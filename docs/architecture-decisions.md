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

**Status: Proposed**

pnpm workspaces + Turborepo. `apps/web` is the Next.js control-plane UI + API,
deployed to Cloudflare Workers via `@opennextjs/cloudflare`. `workers/orchestrator`
is a plain Worker hosting Workflow definitions, queue consumers and scheduled jobs.
Both bind the same D1/R2 and share `packages/*` (schemas, db, core, agents, testing).

Rationale: Workflow classes and queue consumers are cleaner in a dedicated Worker
than inside the OpenNext-generated worker; deploy cadences differ; blast radius
shrinks. Alternative (single worker) rejected for coupling; separate repos rejected
for schema-sharing friction.

## ADR-0003 — Authentication via Better Auth (no custom auth)

**Status: Proposed**

Use **Better Auth** with its D1/Drizzle adapter for email+password, email
verification, sessions and (later) MFA for staff. It is TypeScript-first, runs on
Workers, and keeps session state in our D1.

Alternatives: Auth.js (weaker session/D1 story), Clerk/WorkOS (hosted; vendor cost
and data residency questions; still viable if preferred), Cloudflare Access (good
for staff, wrong for client self-signup). Building on Lucia's guidance directly =
custom auth, prohibited.

**Needs sign-off** because switching later touches session and user tables.

## ADR-0004 — Drizzle ORM + wrangler-applied SQL migrations

**Status: Proposed**

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

**Status: Proposed**

Time-ordered (index-friendly in SQLite), generated without DB round-trips, safe to
create before insert (needed for idempotency keys and R2 keys). Alternative
autoincrement rejected (leaks volume, awkward across D1 + R2 + external systems).

## ADR-0007 — Intake stored as a versioned JSON document, not normalized tables

**Status: Proposed**

`intakes.data` holds the Zod-validated document with `schema_version`; autosave
patches sections and appends `intake_revisions`. Rationale: the intake is an input
artifact consumed whole by the workflow; per-question tables would force a migration
for every question tweak and buy nothing (query needs are status/tenant-level, which
are promoted columns). Files referenced from the document live in `files` rows.
Trade-off: no SQL over answers — acceptable; reporting can JSON-extract later.

## ADR-0008 — Direct-to-R2 uploads via short-lived signed URLs

**Status: Proposed**

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

**Status: Proposed**

Deploy `apps/web` with `@opennextjs/cloudflare` (Workers runtime, bindings available
in route handlers). Risk: OpenNext adapter maturity vs Next.js version churn —
pin versions, keep API routes thin (logic in `packages/core`) so a pivot to
plain Workers + separate static frontend remains cheap. Alternative Cloudflare Pages
+ Functions rejected: Workers is the strategic Cloudflare path and we need
Workflows/Queues bindings alongside.

---

## Decision index

| ADR | Topic | Status |
| --- | --- | --- |
| 0001 | Workflows as orchestrator | Accepted |
| 0002 | Monorepo, two deployables | Proposed |
| 0003 | Better Auth | Proposed (needs sign-off) |
| 0004 | Drizzle + wrangler migrations | Proposed |
| 0005 | Shared Zod schemas | Accepted |
| 0006 | UUIDv7 ids | Proposed |
| 0007 | Intake as JSON document | Proposed |
| 0008 | Direct-to-R2 uploads | Proposed |
| 0009 | Simulated agents behind interface | Accepted |
| 0010 | D1-verified approvals | Accepted |
| 0011 | Staff MFA timing | Open |
| 0012 | Retention policy | Open |
| 0013 | Notification channel | Open |
| 0014 | OpenNext on Workers | Proposed |
