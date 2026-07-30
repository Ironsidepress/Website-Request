# Workflow State Machine

Cloudflare Workflows is the **authoritative orchestrator**. The project's current
stage in D1 is a _projection_ of workflow progress, written by the workflow itself
(and by explicitly-audited admin overrides). Agents never transition stages; they
complete bounded tasks inside a stage.

## States

| State                 | Kind     | Description                                                                         | MVP behavior                                                       |
| --------------------- | -------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `created`             | normal   | Project exists; workflow instance starting.                                         | real                                                               |
| `research`            | normal   | Business/market research task.                                                      | real (Claude) when `ANTHROPIC_API_KEY` is set; simulated otherwise |
| `content_strategy`    | normal   | Sitemap + content plan + draft copy.                                                | real (Claude) when `ANTHROPIC_API_KEY` is set; simulated otherwise |
| `creative_direction`  | normal   | Creative brief (mood, style, direction).                                            | simulated                                                          |
| `design`              | normal   | Figma design production.                                                            | simulated                                                          |
| `design_review`       | **gate** | Human approval of design before development.                                        | real gate                                                          |
| `development`         | normal   | Website implementation (branch + PR, never main).                                   | simulated                                                          |
| `testing`             | normal   | Automated tests against the built site.                                             | simulated                                                          |
| `seo_review`          | normal   | SEO/AEO recommendations applied via PR.                                             | simulated                                                          |
| `preview_deploy`      | normal   | Cloudflare preview deployment.                                                      | simulated                                                          |
| `preview_review`      | **gate** | Client approval of the preview site.                                                | real gate                                                          |
| `production_approval` | **gate** | Staff approval to deploy to production.                                             | real gate                                                          |
| `production_deploy`   | normal   | Final deployment (domain/DNS steps have their own gates, post-MVP).                 | simulated                                                          |
| `live`                | terminal | Site launched.                                                                      | real                                                               |
| `on_hold`             | paused   | Waiting on out-of-band resolution (expired gate, client request, repeated failure). | real                                                               |
| `cancelled`           | terminal | Abandoned; audited reason required.                                                 | real                                                               |

`needs_attention` is **not** a state — it is a project _status flag_
(`projects.health = ok | needs_attention`) set when a step exhausts retries, so the
stage remains truthful while the dashboard surfaces the problem.

## Transitions

```
created            → research
research           → content_strategy
content_strategy   → creative_direction
creative_direction → design
design             → design_review
design_review      → development           (approval.granted)
design_review      → design                (approval.rejected → rework, feedback attached)
development        → testing
testing            → development           (test failures → bounded fix loop, max N iterations)
testing            → seo_review
seo_review         → preview_deploy
preview_deploy     → preview_review
preview_review     → production_approval   (approval.granted)
preview_review     → development           (approval.rejected → rework)
production_approval→ production_deploy     (approval.granted)
production_approval→ on_hold               (approval.rejected — staff blocks launch)
production_deploy  → live

any non-terminal   → on_hold               (gate timeout, admin hold, retry exhaustion + admin decision)
on_hold            → (previous state)      (admin resume; re-opens the gate if one was pending)
any non-terminal   → cancelled             (owner/admin cancel, reason required)
```

Rework loops carry an `attempt` counter per stage. Attempts are capped
(default 3 per gate) — exceeding the cap forces `on_hold` for human triage rather
than unbounded agent loops.

## Approval gates

At each gate the workflow:

1. Creates an `approvals` row (`status=pending`, gate type, project, stage attempt,
   the artifact versions under review, required approver roles per
   `docs/user-roles.md`).
2. Emits a client/staff-visible timeline event and a notification event.
3. Pauses using `step.waitForEvent()` with a timeout (default 30 days).
4. On event: validates the event payload (versioned schema, expected approval id),
   verifies the decision was recorded in D1 by an authorized principal, then resumes
   on the matching transition.
5. On timeout: marks the approval `expired`, transitions to `on_hold`.

The API route that records a decision is the only writer of approval decisions:
it authenticates the principal, checks the authority matrix, updates the row,
writes the audit log, then sends the workflow event
(`instance.sendEvent({ type: 'approval.decision', payload })`). The workflow treats
the D1 row as the source of truth and the event as a wake-up signal — if the event
is lost, a poll fallback inside the same step re-checks the row on a coarse timer.

## Event envelope (versioned)

All workflow events, stage-history writes and agent outputs share one envelope:

```ts
const EventEnvelope = z.object({
  eventId: z.string().uuid(),
  type: z.string(), // e.g. 'stage.started', 'stage.completed',
  // 'approval.requested', 'approval.decision',
  // 'agent.run.completed', 'project.held'
  schemaVersion: z.number().int(), // version of the payload schema for this type
  occurredAt: z.string().datetime(),
  projectId: z.string(),
  organizationId: z.string(),
  workflowInstanceId: z.string().optional(),
  actor: z.object({ type: z.enum(['user', 'agent', 'system']), id: z.string() }),
  idempotencyKey: z.string(), // unique; see idempotency rules
  payload: z.unknown(), // validated by the per-type versioned schema
});
```

Payload schemas live in `packages/schemas/src/events/` and are versioned per type;
consumers must handle at least the current and previous version.

## Idempotency and retry rules

Every workflow step follows these rules so it is safe to retry:

1. **Deterministic step names**: `step.do('stage:design:attempt:2', …)` — the name
   encodes stage and attempt so Workflows' built-in memoization replays completed
   steps without re-executing them.
2. **Idempotency keys on writes**: every D1 mutation performed by a step uses an
   idempotency key derived from `(workflowInstanceId, stepName, purpose)`.
   `workflow_events.idempotency_key` is UNIQUE; inserts use
   `INSERT … ON CONFLICT DO NOTHING`, and dependent writes run in the same
   transaction keyed on the event insert succeeding.
3. **Stage history is append-only.** The projection `projects.current_stage` is
   updated with a guarded write (`WHERE current_stage = :expectedFrom OR current_stage = :to`)
   so a retried step converges instead of double-transitioning.
4. **External side effects** (post-MVP: Figma, GitHub, deployments) must be
   idempotent at the boundary: create-if-absent by deterministic external key,
   or record the external id in D1 before use and reuse it on retry.
5. **Retries**: each step declares its retry policy
   (default: 5 attempts, exponential backoff starting at 10s, capped). Non-retryable
   errors (validation failures, permission errors) are marked terminal immediately.
6. **Retry exhaustion**: the step records a `stage.failed` event, sets
   `projects.health = needs_attention`, and the workflow parks in a wait loop that an
   operator can release (retry step / hold / cancel). Nothing is silently dropped.

## Simulated stages (MVP)

Each simulated stage step:

1. Appends `stage.started` (idempotent insert) and updates the stage projection.
2. `step.sleep()` for a configurable duration (seconds in tests, minutes in demos).
3. Writes a synthetic `artifacts` row (e.g. `type='research_report', version=attempt`)
   and a simulated `agent_runs` row with plausible metadata — exercising the exact
   tables and schemas the real agents will use.
4. Appends `stage.completed`.

A test-only configuration can inject deterministic failures per stage to exercise
retry, exhaustion and `needs_attention` paths in integration tests.

## Manual overrides

Admins may force a transition only through a dedicated endpoint that:
records an `override.transition` audit event with reason, cancels or signals the
running instance as needed, and starts a new instance from the target stage.
Overrides are expected to be rare and are visually flagged in stage history.
