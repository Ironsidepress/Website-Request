# MVP Acceptance Criteria

Each criterion is testable; the verifying layer is noted
(U = unit, I = integration, W = workflow suite, E = end-to-end, R = review/manual).

## Walkthrough status (M8, 2026-07-29)

All criteria below are checked as met, with two scoped waivers:

1. **Workflow E-level coverage (§6.4, §7 E-parts).** The Cloudflare Workflow
   itself is not driven by the browser suite: `next dev` has no cross-script
   workflow binding, so E2E verifies the submission → timeline surface while
   the full stage sequence, gates, rework, expiry and replay semantics are
   verified in the workerd suite (`packages/core/test/pipeline.spec.ts`)
   running the exact engine code the `ProjectPipeline` entrypoint executes.
   The remaining risk is the thin `WorkflowStep` adapter, exercised at
   deploy time on staging (docs/environments.md).
2. **Review requirement on `main` (§10.5).** Branch protection requires green
   checks; required review count is 0 while the repository has a single
   maintainer (self-approval deadlock) — revisit when a second maintainer
   joins.

Verification map: §1 auth-flow/bootstrap/organizations/invitations/rate-limit
specs + intake E2E; §2 intake spec + schemas tests + hardening E2E (409);
§3 files spec + intake E2E uploads; §4 projects spec + timeline E2E;
§5 staff spec + hardening E2E (dashboard, detail, non-staff 404);
§6–§7 pipeline spec; §8 audit assertions across suites + audit schema tests;
§9 pipeline failure tests + hardening E2E (correlation ids); §10 CI jobs
(format/lint/typecheck/tests/build, migration drift, route-registry
manifest, secret scan, E2E).

## 1. Registration, login and organizations

- [x] A visitor can register with email + password, verify email, and sign in. (E)
- [x] Auth is provided by an established library — no custom password hashing,
      session tokens or crypto anywhere in the codebase. (R)
- [x] A first-time user creates an organization and becomes its `owner`. (I, E)
- [x] An `owner` can invite a `member`; a `member` cannot submit intake, approve, or
      manage members. (I)
- [x] Auth endpoints are rate-limited. (R)

## 2. Intake questionnaire

- [x] All ten sections exist and collect the required information (business,
      services, audiences, competitors, examples, domain, branding, content,
      functionality, review). (E)
- [x] Field changes autosave; a browser reload or different device restores the
      draft exactly. (E)
- [x] Concurrent edits from two tabs do not silently lose data (409 + refresh on
      stale revision). (I)
- [x] Conditional sections behave per `docs/intake-schema.md`: e.g. `ownsDomain=false`
      requires desired names and never requires registrar details; hidden branches
      are not validated at submit. (U, E)
- [x] Every autosave appends an intake revision with actor and timestamp. (I)
- [x] Submission validates the full document; failures highlight offending sections
      and nothing is submitted partially. (I, E)
- [x] Submission freezes the intake, creates a project and starts exactly one
      workflow instance — resubmission/double-click cannot create duplicates. (I)

## 3. File uploads

- [x] Clients upload via slot → upload → confirm; the MVP transport is
      worker-proxied per amended ADR-0008 (25 MB cap, per-tenant quota), with
      presigned direct-to-R2 as a later drop-in. (I)
- [x] Disallowed types and oversized files are rejected before an upload URL is
      issued. (I)
- [x] File metadata (name, type, size, checksum, purpose, status) is recorded in D1
      and linked to intake/organization. (I)
- [x] Downloads require an authenticated, tenant-checked route; R2 is not
      publicly readable; non-image types are served as attachments. (I)
- [x] Uploads appear in the branding/content sections and survive draft reloads. (E)

## 4. Projects, stages and timeline

- [x] Intake submission creates a D1 project record with `current_stage=created`. (I)
- [x] Every stage change appends an immutable stage-history row with actor,
      attempt and workflow instance id. (I, W)
- [x] The client timeline shows stages with done/active/waiting-on-you/upcoming
      states and human-readable events only — no internal events, agent metadata,
      costs or error details in the response payload. (E)
- [x] A client sees only their organization's projects. (I, E)

## 5. Administrative dashboard

- [x] Admin sees all projects across tenants with stage, status, health, age and
      pending-approval indicators, with filters. (E)
- [x] Admin project detail shows full stage history, approvals, files, intake
      snapshot, simulated agent-run metadata and audit trail. (E)
- [x] Admin actions (approve/reject, hold/resume, cancel, retry, override) each
      produce audit events. (I)
- [x] Non-admin users receive 404/redirect on all admin routes and APIs. (I)

## 6. Workflow with simulated stages

- [x] A Cloudflare Workflow drives the full stage sequence of
      `docs/workflow-state-machine.md` with configurable simulated durations. (W)
- [x] Each simulated stage writes stage events, a versioned synthetic artifact and a
      simulated `agent_runs` row with all required audit fields (prompt version,
      artifact versions, model, timings, status, retries, tokens, cost). (W, I)
- [x] Stage steps are idempotent: forced re-execution of any step produces no
      duplicate rows or double transitions. (W)
- [x] The workflow completes: created → … → live on the happy path. (W, E)

## 7. Human approval gates

- [x] The workflow pauses at `design_review`, `preview_review` and
      `production_approval` with a pending approval row and visible timeline
      prompt. (W, E)
- [x] Only principals authorized by the matrix in `docs/user-roles.md` can decide
      each gate; others get 404/403. (I)
- [x] Approval resumes the workflow to the next stage. (W, E)
- [x] Rejection requires a reason and routes to the defined rework stage; a new
      attempt and new artifact version are created; the gate re-opens on
      re-arrival. (W, E)
- [x] Rework attempts are capped; exceeding the cap parks the project `on_hold`. (W)
- [x] Gate timeout expires the approval and parks the project `on_hold`; admin
      resume re-opens the gate. (W)
- [x] A decision is idempotent — double submission does not double-advance the
      workflow. (I, W)
- [x] A workflow event without a matching authorized D1 decision row is ignored and
      logged. (W)

## 8. Audit logging

- [x] These actions produce audit rows with actor, action, resource, tenant, and
      timestamp: register, login, org create, member invite, intake autosave
      (coalesced per revision), submit, file upload/download, approval decisions,
      stage transitions, holds/resumes/cancels, admin overrides, staff cross-tenant
      reads of client data. (I)
- [x] Audit rows are append-only — no update/delete code path exists. (R, U)
- [x] Audit metadata never contains secrets or raw prompt text (schema-checked). (U)

## 9. Error and retry handling

- [x] Failing steps retry with exponential backoff per declared policy; transient
      failures recover invisibly to the client. (W)
- [x] Retry exhaustion sets `health=needs_attention`, records `stage.failed`, and
      surfaces on the admin dashboard; operator retry resumes the workflow. (W, E)
- [x] Client-facing errors are safe `{code, message, correlationId}`; detailed
      errors are only in internal logs correlated by id. (I)

## 10. Engineering quality gates

- [x] Strict TypeScript, no `any` without a documented justification comment. (R)
- [x] All external input validated with shared Zod schemas. (R, U)
- [x] Every schema change has a migration; CI fails on schema/migration drift. (CI)
- [x] Tenant-isolation suite covers every tenant-scoped endpoint (manifest-diff
      enforced). (CI)
- [x] CI runs typecheck, lint, format, unit, integration, workflow, E2E and secret
      scan; `main` is protected and requires green checks + review. (CI, R)
- [x] Swapping `SimulatedExecutor` for a real `AgentExecutor` requires no changes
      outside the executor implementation and its registration (interface
      demonstrated by a test double). (R, U)

## Explicitly out of MVP scope (must NOT be present)

- [x] No Figma, GitHub-codegen, domain-purchase, DNS or production-deploy
      integrations are reachable in this codebase; their gates/types exist as schema
      only. (R)
