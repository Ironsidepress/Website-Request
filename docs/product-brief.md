# Product Brief

## One-line summary

A multi-tenant "website factory" that takes a small business owner from a guided intake
questionnaire to a launched website through a deterministic, human-supervised,
agent-assisted production pipeline.

## Problem

Small business owners without a website face three obstacles:

1. They do not know what information a website project needs from them.
2. Traditional agencies are slow, expensive and opaque.
3. Pure self-service builders push all the work back onto the owner.

## Solution

The platform splits the work into two planes:

- **Control plane (this repository's MVP focus):** client accounts, guided intake with
  autosave, file uploads, project records, a durable workflow orchestrator, human
  approval gates, a client-facing timeline and an administrative dashboard.
- **Production plane (later phases):** specialized agents for project management,
  research, content strategy, creative direction, UI/UX design (Figma), development
  (GitHub, isolated sandboxes), testing, and SEO/AEO review — each performing bounded
  tasks inside the orchestrated workflow.

The orchestrator is authoritative. Agents never own the pipeline; they execute bounded
tasks with structured, versioned inputs and outputs, and every action is audited.

## Target users

| User | Need |
| --- | --- |
| Small business owner (client) | Answer questions once, upload what they have, watch progress, approve key milestones. |
| Platform administrator / producer | Monitor all projects, intervene, approve or reject stage outputs, manage rework. |
| Reviewer (staff) | Approve designs, previews, deployments and factual claims. |
| Operator (engineering) | Observe workflow health, retries, agent cost and audit trails. |

## What the product must do (full vision)

1. Client registration, login and organization (tenant) management.
2. Guided intake questionnaire covering: business information, service offerings,
   target audiences, competitors, website examples, domain ownership, desired domain
   suggestions, branding assets, content availability and required website functionality.
3. Draft autosave and conditional sections in the questionnaire.
4. File uploads (logos, brand guides, photos, copy documents) stored in R2.
5. Project creation with durable stage tracking in D1.
6. A Cloudflare Workflow that drives each project through:
   research → content development → creative direction → Figma design →
   **human design approval** → website development → automated testing →
   SEO/AEO review → preview deployment → **human preview approval** →
   **human production approval** → final deployment.
7. Human approval is mandatory before: sending an approved Figma design to development,
   any production deployment, any domain purchase, any DNS change, and publication of
   unverified factual claims.
8. Client-facing project timeline and notifications.
9. Administrative dashboard with cross-tenant visibility, approvals queue and audit log.
10. Full auditability of every agent run: prompt version, artifact versions, model,
    timing, status, retries, token usage and estimated cost.

## What the MVP includes (current priority)

Control-plane only, with **simulated** production stages:

- Client registration and login (no custom auth/crypto — use an established library).
- Business organization (tenant) records.
- Draft intake questionnaire with autosave and conditional sections.
- R2 file uploads.
- Project creation, D1 project records and stage history.
- Client project timeline.
- Administrative project dashboard.
- A Cloudflare Workflow with simulated project stages that pauses for human approval.
- Approval and rejection events.
- Audit logs.
- Error and retry handling.
- Automated unit, integration and end-to-end tests.

## Explicit non-goals for the MVP

- Autonomous Figma design generation.
- Autonomous website coding, real GitHub PR automation, or agent sandboxes.
- Domain purchase, DNS management or production deployment of client sites.
- Billing and payments.
- Publishing any factual claim about a client's business.

These remain design constraints (the schema, state machine and contracts must
accommodate them) but no production-plane feature code ships in the MVP.

## Success criteria for the MVP

1. A client can register, complete the intake with autosave across sessions, upload
   files and submit.
2. Submission creates a project and starts a Cloudflare Workflow instance.
3. The workflow advances through simulated stages, pauses at approval gates, and
   resumes on approval or routes to rework on rejection.
4. The client sees an accurate timeline; the administrator sees all projects, pending
   approvals and audit history.
5. Every stage transition, approval decision and simulated agent run is recorded and
   idempotent under retry.
6. The automated test suite covers the intake, workflow transitions, approval gates
   and tenant isolation.

## Related documents

- Roles and permissions: `docs/user-roles.md`
- End-to-end flows: `docs/user-flows.md`
- Questionnaire contents: `docs/intake-schema.md`
- Orchestration: `docs/workflow-state-machine.md`
- Agent boundaries: `docs/agent-contracts.md`
- Persistence: `docs/data-model.md`
- Security: `docs/security-model.md`
- Testing: `docs/testing-strategy.md`
- Acceptance: `docs/acceptance-criteria.md`
- Decisions: `docs/architecture-decisions.md`
- Build order: `docs/mvp-implementation-plan.md`
