# Testing Strategy

## Goals

1. Every material feature ships with tests (repository standard).
2. The riskiest surfaces get the deepest coverage: tenant isolation, workflow
   idempotency, approval gates and intake validation.
3. Tests run the same way locally and in CI, against real-enough Cloudflare
   emulation (Miniflare/workerd via Vitest pool-workers), not hand-rolled mocks of
   platform APIs.

## Toolchain

| Layer | Tool | Notes |
| --- | --- | --- |
| Unit + integration | Vitest + `@cloudflare/vitest-pool-workers` | Runs inside workerd with real D1 (SQLite), R2 and Queues emulation; per-test isolated storage. |
| Workflow tests | Vitest + workflow harness | See "Testing Cloudflare Workflows" below. |
| E2E | Playwright (Chromium) | Against `wrangler dev`/`next dev` full stack with seeded D1. |
| Schema tests | Vitest | Zod schema fixtures: valid/invalid/boundary cases, version-migration round-trips. |
| Static | TypeScript `--strict`, ESLint, Prettier | CI-blocking. |
| Secrets | gitleaks in CI | CI-blocking. |

## Test pyramid and what lives where

### Unit (fast, pure)

- Zod schemas: every intake section — strict vs draft mode, conditional branches
  (`ownsDomain`, `hasBrandAssets`, `contentReadiness`, feature-dependent rules),
  size caps, cross-field refinements.
- State machine: transition table as data — every legal transition allowed, every
  illegal transition rejected, rework attempt caps, gate → rework routing.
- Event envelope: versioned payload validation, unknown type/version rejection.
- Permission checks: role × action matrix (including separation-of-duties).
- Pure services: timeline projection from stage history, approval authority
  resolution, cost/token aggregation.

### Integration (workerd, real D1/R2 emulation)

- **Tenant isolation (the flagship suite):** a parameterized suite that, for every
  tenant-scoped endpoint, creates two organizations and asserts org B's credentials
  can neither read nor mutate org A's resources (404), and that list endpoints never
  leak cross-tenant rows. New endpoints must register in this suite — enforced by a
  test that diffs the route manifest against the registered list.
- Intake API: autosave merge semantics, optimistic-concurrency 409s, revision
  append, one-active-draft constraint, submit validation failures, submit →
  project + workflow start.
- Files API: upload slot validation (type/size/quota), pending → stored transitions,
  tenant-checked signed downloads, orphan cleanup.
- Approvals API: authority matrix enforcement, rejection-requires-reason, decision
  idempotency (double-submit is a no-op), audit log emission.
- Repository layer: guarded stage-projection updates, idempotent event inserts
  (UNIQUE-key replay), append-only enforcement.

### Workflow tests

Cloudflare Workflows code is structured for testability:

- Each step body is a plain function `(deps, input) → output` — unit-testable
  without the Workflows runtime.
- A thin `WorkflowRunner` interface abstracts `step.do/sleep/waitForEvent`. Tests use
  an in-memory deterministic runner that: executes steps, records step names,
  simulates retries by re-invoking steps (asserting idempotency — same DB state after
  1 and N executions), fast-forwards sleeps, and injects approval events/timeouts.
- Scenarios covered:
  - Full happy path: created → … → live, with correct stage history and events.
  - Design rejection → rework loop → re-approval, attempt counters, artifact
    versioning (v1 superseded, v2 approved).
  - Preview rejection → development rework.
  - Gate timeout → `on_hold`; admin resume re-opens gate.
  - Step failure → retry with backoff → success; retry exhaustion →
    `health=needs_attention` + `stage.failed` event.
  - Duplicate event delivery and replayed steps produce no duplicate rows
    (idempotency-key conflicts observed and absorbed).
  - Forged/unauthorized approval events are ignored (D1 row verification).
- A smoke test also runs the real workflow on Miniflare's Workflows emulation to
  catch API-surface drift between the harness and the platform.

### End-to-end (Playwright)

1. Register → verify → create organization → land on portal.
2. Fill intake across sections with autosave: reload mid-way and assert state
   restored; exercise both branches of one conditional section.
3. Upload a logo (direct-to-R2 flow) and see it attached to the branding section.
4. Submit intake → project appears with timeline at first simulated stage.
5. Timeline advances (test-mode short sleeps) to design review; approve as client
   where required, and as staff via admin login; assert workflow resumes.
6. Reject preview with a reason → timeline shows rework; approve on second pass →
   production approval → live.
7. Admin dashboard: project list, filters, approvals queue, audit trail visible.
8. Security assertions: client B cannot open client A's project URL; client never
   sees internal events, costs or error details in any response payload
   (assert on network responses, not just UI).

## Determinism and fixtures

- Factories (`packages/testing`) build tenants, users, intakes (per-section valid
  fixtures), projects and events; no shared mutable seed data between tests.
- Time is injected (`Clock` interface) — no real waiting; timeout tests fast-forward.
- Simulated stage durations and failure injection are configuration, so integration
  tests run in milliseconds.

## CI pipeline (GitHub Actions)

1. Install + typecheck (`tsc --noEmit` strict) + lint + format check.
2. Unit + integration tests (vitest pool-workers) with coverage.
3. Workflow scenario suite.
4. Migration check: apply all migrations to a fresh D1 (local) and diff against the
   Drizzle schema — drift fails CI.
5. E2E (Playwright) on the built app.
6. gitleaks secret scan.

Merging to `main` requires all checks green plus one human review — the same
branch-protection discipline the platform will later impose on generated site repos.

## Coverage expectations

No blanket percentage gate; instead, enforced-by-review requirements:

- Every new endpoint: integration tests + tenant-isolation registration.
- Every state-machine change: transition-table tests updated in the same PR.
- Every schema change: fixture updates + (if versioned) migration round-trip test.
- Every bug fix: a regression test that fails before the fix.
