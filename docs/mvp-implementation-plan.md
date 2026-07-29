# MVP Implementation Plan

Vertical slices, each independently shippable, tested and demoable. Every slice ends
green on: format, lint, typecheck, unit/integration tests, and (from M3 on) E2E.

## Repository structure

```
.
├── apps/
│   └── web/                    # Next.js (App Router) — client portal + admin + API routes
│       ├── src/app/(client)/   # portal: intake wizard, timeline, uploads
│       ├── src/app/(admin)/    # dashboard, approvals queue, audit views
│       ├── src/app/api/        # thin route handlers → packages/core services
│       └── wrangler.jsonc      # OpenNext worker config, D1/R2/Workflows bindings
├── workers/
│   └── orchestrator/           # Workflow definitions, queue consumers, cron
│       ├── src/workflows/project-pipeline.ts
│       ├── src/steps/          # step bodies as plain testable functions
│       └── wrangler.jsonc
├── packages/
│   ├── schemas/                # Zod: intake, events, agents, api, artifacts (versioned)
│   ├── db/                     # Drizzle schema, migrations/, repositories (tenant-scoped)
│   ├── core/                   # domain services: intake, projects, approvals, audit,
│   │                           # state machine, timeline projection, dispatcher
│   ├── agents/                 # contracts, prompts/ (versioned), SimulatedExecutor
│   ├── testing/                # factories, fixtures, in-memory WorkflowRunner, clock
│   └── config/                 # shared tsconfig, eslint, prettier
├── docs/                       # this documentation set
├── .github/workflows/ci.yml
├── package.json                # pnpm workspaces + turborepo
└── README.md
```

Principles embodied: business logic in `packages/core` (not UI), schemas shared from
one package, tenant-scoped repositories as the only D1 access, step bodies separated
from Workflow plumbing for testability.

## Milestones

### M0 — Foundations (scaffolding, CI, quality gates)

Monorepo scaffolding (pnpm + turborepo), strict tsconfig, ESLint/Prettier,
`apps/web` via OpenNext template, `workers/orchestrator` skeleton, D1/R2 bindings,
Drizzle + first empty migration, Vitest pool-workers wiring, Playwright wiring,
GitHub Actions CI (typecheck/lint/test/migration-drift/gitleaks), branch protection.
**Done when:** CI green on a trivial schema + one repository round-trip test in workerd.

### M1 — Auth and organizations

Better Auth integration (email+password, verification), `users`,
`organizations`, `organization_members`, TenantContext middleware, permission
checks, org creation flow, member invites, audit rows for auth/org actions,
rate limiting on auth routes. Tenant-isolation test harness (two-tenant fixture)
established here.
**Done when:** flows 1 of `docs/user-flows.md` pass E2E; isolation suite runs in CI.

### M2 — Intake draft with autosave + conditional sections

`packages/schemas` intake v1 (draft + strict), `intakes`/`intake_revisions` tables,
autosave PATCH with optimistic concurrency, wizard UI for all 10 sections with
conditional branches, revision audit.
**Done when:** acceptance criteria §2 (except submission→project) pass.

### M3 — File uploads to R2

`files` table, upload-slot API with validation/quota, direct-to-R2 presigned PUT,
confirm/verify step, signed downloads, wiring into branding/content sections,
orphan cleanup job (cron in orchestrator worker).
**Done when:** acceptance criteria §3 pass.

### M4 — Projects, submission and stage history

Strict-validation submit endpoint, intake freeze, `projects` +
`project_stage_history` + `workflow_runs`/`workflow_events` tables, idempotent
submission (one project + one workflow instance), client timeline page (projection
from history), audit rows.
**Done when:** submission produces a project with `created` stage visible on the
timeline; double-submit cannot duplicate; criteria §4 pass (workflow may still be a
stub that only writes the first stage).

### M5 — Workflow with simulated stages

`project-pipeline` Workflow in `workers/orchestrator`: full stage sequence with
`step.sleep` simulation, idempotent step bodies, stage events + projections,
synthetic `artifacts` + simulated `agent_runs` rows via the dispatcher +
`SimulatedExecutor`, retry policies, failure injection hooks, in-memory
WorkflowRunner test harness + Miniflare smoke test.
**Done when:** happy path created→live runs end-to-end in tests; criteria §6 pass;
step re-execution proves idempotent.

### M6 — Approval gates

`approvals` table, gate steps with `waitForEvent` + timeout + D1 verification
(ADR-0010), decision API with authority matrix + separation of duties, client
approval UI (design/preview), rejection→rework routing with attempt caps, expiry →
`on_hold`, resume, audit rows.
**Done when:** criteria §7 pass, including timeout, idempotent decisions and
forged-event rejection.

### M7 — Administrative dashboard

Cross-tenant project table with filters/health, project detail (history, approvals,
files, intake snapshot, simulated agent-run metadata), approvals queue, manual
actions (retry, hold/resume, cancel, audited override), audit log views, staff
cross-tenant read auditing.
**Done when:** criteria §5 pass.

### M8 — Hardening and release readiness

Error taxonomy + correlation ids end-to-end, structured logging + redaction,
security headers/CSP, full E2E suite (flows 1–10), load sanity on autosave
(debounce + 409 behavior), docs refreshed against as-built,
acceptance-criteria checklist walked and signed off.
**Done when:** every item in `docs/acceptance-criteria.md` is checked or explicitly
waived with reason.

## Sequencing notes

- M1→M4 are strictly ordered (each depends on the previous slice's tables/context).
- M3 can proceed in parallel with M2 after its API shape is fixed.
- M5 and M6 are the risk core — schedule spike time in M0/M4 to validate
  `waitForEvent`, instance limits and the pool-workers Workflow harness early
  (de-risking ADR-0001/0014 assumptions).
- M7 consumes everything but is UI-heavy and can start once M5 emits real data.

## Post-MVP roadmap (direction only, not committed)

1. Notifications (ADR-0013) and staff MFA (ADR-0011).
2. Real research/content agents (Claude Agent SDK in Cloudflare Sandbox) with source
   logs and the factual-claims gate.
3. Figma integration (MCP/REST) for design artifacts feeding `design_review`.
4. GitHub integration: per-project site repos, protected main, agent PRs,
   preview deployments.
5. Domain purchase + DNS gates; production deployment of client sites.
