# User Flows

Flows are grouped by actor. Steps marked **[MVP-sim]** exist in the MVP but the
underlying production work is simulated by the workflow.

## 1. Client onboarding

```
Visit marketing page → Register (email + password via auth library)
→ Verify email → Create organization (business name, contact info)
→ Land on client portal dashboard (empty state: "Start your website request")
```

Notes:

- Registration creates a `user`; the guided first-run creates an `organization` and an
  `owner` membership in one transaction.
- A returning user with memberships lands on an organization picker (or straight into
  their single organization).

## 2. Intake questionnaire (draft, autosave, conditional sections)

```
Start intake → Section-by-section wizard:
  1. Business profile
  2. Services & offerings
  3. Target audiences
  4. Competitors
  5. Website examples / inspiration
  6. Domain (owns one? → details; else → desired name suggestions)
  7. Branding (has assets? → upload; else → brand preference questions)
  8. Content availability (has copy/photos? → upload; else → flag for content creation)
  9. Required functionality (contact forms, booking, e-commerce, etc.)
 10. Review & submit
```

Behavior:

- Every field change autosaves (debounced) via `PATCH /api/intake/:id` with the section
  payload; the server validates against the versioned section schema (Zod), stores the
  draft and appends a revision.
- Conditional sections render and validate based on earlier answers
  (see `docs/intake-schema.md`). Hidden sections are not required for submission.
- Drafts survive logout/login and device changes.
- File uploads inside sections 7–8 follow flow 3.
- Submission runs full-document validation. On success the intake becomes immutable
  (`submitted`), a project is created and the workflow starts (flow 5).

## 3. File upload

```
Client picks file → App requests upload slot (POST /api/uploads: filename, size, type, purpose)
→ Server validates (type allowlist, size limit, tenant quota), creates `files` row
  (status=pending), returns a short-lived direct-to-R2 upload URL
→ Browser uploads directly to R2 → Client confirms (or server verifies object exists)
→ Server marks file `stored`, records checksum/size, audit-logs the upload
```

Failure paths: abandoned pending uploads are garbage-collected; oversized or
disallowed types are rejected before any URL is issued.

## 4. Client tracks project (timeline)

```
Portal → Project page → Timeline view:
  - Ordered stage list with status (done / active / waiting-on-you / upcoming)
  - Human-readable events derived from stage history (no internal details)
  - Pending client actions surfaced at top ("Your design is ready for review")
```

The timeline reads `project_stage_history` + `approvals`, filtered to
client-safe event types. Internal errors, retries, agent runs and costs never appear.

## 5. Project lifecycle (system flow)

```
Intake submitted → project created (stage: created) → Workflow instance started
→ [MVP-sim] research → [MVP-sim] content_strategy → [MVP-sim] creative_direction
→ [MVP-sim] design → PAUSE: design_review (approval gate)
→ [MVP-sim] development → [MVP-sim] testing → [MVP-sim] seo_review
→ [MVP-sim] preview_deploy → PAUSE: preview_review (client approval gate)
→ PAUSE: production_approval (staff gate) → [MVP-sim] production_deploy → live
```

Each simulated stage: writes a stage-started event, sleeps a configurable duration,
writes a synthetic artifact record and an `agent_runs` row (simulated), then writes a
stage-completed event. All steps are idempotent (see `docs/workflow-state-machine.md`).

## 6. Approval — happy path (e.g. design review)

```
Workflow reaches gate → creates `approvals` row (status=pending) + notification event
→ Workflow pauses (waits for approval event, with timeout)
→ Client (and/or reviewer per the authority matrix) opens approval screen:
   sees artifact (MVP: simulated artifact summary), Approve / Request changes
→ Approve: approval row updated, audit-logged, workflow event delivered
→ Workflow resumes to next stage
```

## 7. Approval — rejection / rework

```
→ Request changes: rejection recorded with required reason
→ Workflow receives rejection event → transitions project back to the rework stage
  defined by the state machine (design_review → design; preview_review → development)
→ Rework stage re-runs (new attempt number, prior artifacts versioned, not overwritten)
→ Gate is re-created on the next arrival (a fresh approvals row per attempt)
```

## 8. Approval — timeout

```
Gate pending > TTL (configurable, default 30 days)
→ Workflow marks approval expired, project moves to on_hold
→ Admin can resume (re-opens the same gate) or cancel
```

## 9. Administrator flows

Dashboard:

```
Admin portal → All projects table (tenant, stage, status, waiting-on, age, last event)
→ Filters: stage, status, pending-approval
→ Project detail: full stage history, approvals, files, intake snapshot,
  agent-run metadata (status, timing, retries, simulated cost), audit trail
```

Approvals queue:

```
Admin portal → Approvals queue (all pending gates across tenants, oldest first)
→ Open item → review context → Approve / Reject with reason
```

Interventions (all audited as manual overrides):

- Retry a failed step.
- Put a project on hold / resume.
- Cancel a project (confirmation required; terminal).

## 10. Error and retry (system flow)

```
Step fails → Workflows retries with exponential backoff (bounded attempts)
→ Still failing → step marked failed, project status=needs_attention,
  operator/admin notified on dashboard → manual retry or hold/cancel
```

Every attempt is recorded; retries reuse idempotency keys so duplicated side effects
are impossible (see `docs/workflow-state-machine.md`).

## Flow-to-requirement traceability

| MVP requirement | Flow(s) |
| --- | --- |
| Registration & login | 1 |
| Organization records | 1 |
| Draft intake + autosave + conditional sections | 2 |
| R2 uploads | 3 |
| Project creation, D1 records, stage history | 5 |
| Client timeline | 4 |
| Admin dashboard | 9 |
| Workflow with simulated stages | 5 |
| Pause for human approval, approve/reject | 6, 7, 8 |
| Audit logs | all (cross-cutting) |
| Error & retry handling | 10 |
