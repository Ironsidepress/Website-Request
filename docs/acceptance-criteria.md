# MVP Acceptance Criteria

Each criterion is testable; the verifying layer is noted
(U = unit, I = integration, W = workflow suite, E = end-to-end, R = review/manual).

## 1. Registration, login and organizations

- [ ] A visitor can register with email + password, verify email, and sign in. (E)
- [ ] Auth is provided by an established library — no custom password hashing,
      session tokens or crypto anywhere in the codebase. (R)
- [ ] A first-time user creates an organization and becomes its `owner`. (I, E)
- [ ] An `owner` can invite a `member`; a `member` cannot submit intake, approve, or
      manage members. (I)
- [ ] Auth endpoints are rate-limited. (R)

## 2. Intake questionnaire

- [ ] All ten sections exist and collect the required information (business,
      services, audiences, competitors, examples, domain, branding, content,
      functionality, review). (E)
- [ ] Field changes autosave; a browser reload or different device restores the
      draft exactly. (E)
- [ ] Concurrent edits from two tabs do not silently lose data (409 + refresh on
      stale revision). (I)
- [ ] Conditional sections behave per `docs/intake-schema.md`: e.g. `ownsDomain=false`
      requires desired names and never requires registrar details; hidden branches
      are not validated at submit. (U, E)
- [ ] Every autosave appends an intake revision with actor and timestamp. (I)
- [ ] Submission validates the full document; failures highlight offending sections
      and nothing is submitted partially. (I, E)
- [ ] Submission freezes the intake, creates a project and starts exactly one
      workflow instance — resubmission/double-click cannot create duplicates. (I)

## 3. File uploads

- [ ] Clients upload via slot → upload → confirm; the MVP transport is
      worker-proxied per amended ADR-0008 (25 MB cap, per-tenant quota), with
      presigned direct-to-R2 as a later drop-in. (I)
- [ ] Disallowed types and oversized files are rejected before an upload URL is
      issued. (I)
- [ ] File metadata (name, type, size, checksum, purpose, status) is recorded in D1
      and linked to intake/organization. (I)
- [ ] Downloads require an authenticated, tenant-checked route; R2 is not
      publicly readable; non-image types are served as attachments. (I)
- [ ] Uploads appear in the branding/content sections and survive draft reloads. (E)

## 4. Projects, stages and timeline

- [ ] Intake submission creates a D1 project record with `current_stage=created`. (I)
- [ ] Every stage change appends an immutable stage-history row with actor,
      attempt and workflow instance id. (I, W)
- [ ] The client timeline shows stages with done/active/waiting-on-you/upcoming
      states and human-readable events only — no internal events, agent metadata,
      costs or error details in the response payload. (E)
- [ ] A client sees only their organization's projects. (I, E)

## 5. Administrative dashboard

- [ ] Admin sees all projects across tenants with stage, status, health, age and
      pending-approval indicators, with filters. (E)
- [ ] Admin project detail shows full stage history, approvals, files, intake
      snapshot, simulated agent-run metadata and audit trail. (E)
- [ ] Admin actions (approve/reject, hold/resume, cancel, retry, override) each
      produce audit events. (I)
- [ ] Non-admin users receive 404/redirect on all admin routes and APIs. (I)

## 6. Workflow with simulated stages

- [ ] A Cloudflare Workflow drives the full stage sequence of
      `docs/workflow-state-machine.md` with configurable simulated durations. (W)
- [ ] Each simulated stage writes stage events, a versioned synthetic artifact and a
      simulated `agent_runs` row with all required audit fields (prompt version,
      artifact versions, model, timings, status, retries, tokens, cost). (W, I)
- [ ] Stage steps are idempotent: forced re-execution of any step produces no
      duplicate rows or double transitions. (W)
- [ ] The workflow completes: created → … → live on the happy path. (W, E)

## 7. Human approval gates

- [ ] The workflow pauses at `design_review`, `preview_review` and
      `production_approval` with a pending approval row and visible timeline
      prompt. (W, E)
- [ ] Only principals authorized by the matrix in `docs/user-roles.md` can decide
      each gate; others get 404/403. (I)
- [ ] Approval resumes the workflow to the next stage. (W, E)
- [ ] Rejection requires a reason and routes to the defined rework stage; a new
      attempt and new artifact version are created; the gate re-opens on
      re-arrival. (W, E)
- [ ] Rework attempts are capped; exceeding the cap parks the project `on_hold`. (W)
- [ ] Gate timeout expires the approval and parks the project `on_hold`; admin
      resume re-opens the gate. (W)
- [ ] A decision is idempotent — double submission does not double-advance the
      workflow. (I, W)
- [ ] A workflow event without a matching authorized D1 decision row is ignored and
      logged. (W)

## 8. Audit logging

- [ ] These actions produce audit rows with actor, action, resource, tenant, and
      timestamp: register, login, org create, member invite, intake autosave
      (coalesced per revision), submit, file upload/download, approval decisions,
      stage transitions, holds/resumes/cancels, admin overrides, staff cross-tenant
      reads of client data. (I)
- [ ] Audit rows are append-only — no update/delete code path exists. (R, U)
- [ ] Audit metadata never contains secrets or raw prompt text (schema-checked). (U)

## 9. Error and retry handling

- [ ] Failing steps retry with exponential backoff per declared policy; transient
      failures recover invisibly to the client. (W)
- [ ] Retry exhaustion sets `health=needs_attention`, records `stage.failed`, and
      surfaces on the admin dashboard; operator retry resumes the workflow. (W, E)
- [ ] Client-facing errors are safe `{code, message, correlationId}`; detailed
      errors are only in internal logs correlated by id. (I)

## 10. Engineering quality gates

- [ ] Strict TypeScript, no `any` without a documented justification comment. (R)
- [ ] All external input validated with shared Zod schemas. (R, U)
- [ ] Every schema change has a migration; CI fails on schema/migration drift. (CI)
- [ ] Tenant-isolation suite covers every tenant-scoped endpoint (manifest-diff
      enforced). (CI)
- [ ] CI runs typecheck, lint, format, unit, integration, workflow, E2E and secret
      scan; `main` is protected and requires green checks + review. (CI, R)
- [ ] Swapping `SimulatedExecutor` for a real `AgentExecutor` requires no changes
      outside the executor implementation and its registration (interface
      demonstrated by a test double). (R, U)

## Explicitly out of MVP scope (must NOT be present)

- [ ] No Figma, GitHub-codegen, domain-purchase, DNS or production-deploy
      integrations are reachable in this codebase; their gates/types exist as schema
      only. (R)
