# Agent Contracts

Agents perform **bounded tasks** dispatched by the workflow. They never control the
pipeline, never transition stages, never hold approval authority, and never push to
protected branches. In the MVP all agents are **simulated**, but the contracts,
tables and schemas below are implemented for real so the production plane can be
added without schema churn.

## Contract shape

Every agent task is defined by a versioned contract in
`packages/schemas/src/agents/<agentType>/`:

```ts
type AgentContract = {
  agentType: AgentType;
  contractVersion: number; // bump on any input/output schema change
  input: z.ZodType; // references to artifact versions, never raw blobs
  output: z.ZodType; // structured output, validated before acceptance
  permissions: AgentPermissions; // explicit allowlist (see below)
  successCriteria: string[]; // machine-checkable where possible
  timeoutSeconds: number;
  maxRetries: number;
};
```

Inputs and outputs reference **artifacts by id + version** (`artifacts` table, content
in R2). Agents read approved artifact versions; they write new artifact versions.
They never mutate existing artifact versions.

An output that fails schema validation is a failed run — the orchestrator retries or
escalates; invalid output is never partially accepted.

## Agent run record

Every run writes an `agent_runs` row (see `docs/data-model.md`) capturing, as required
by project rules: project id, agent type, prompt version, input artifact versions,
output artifact versions, model, start time, completion time, status, retry count,
token usage, estimated cost and error details. Raw transcripts (when real agents
exist) go to R2 under a staff-only prefix — never exposed to clients.

## Permission model

`AgentPermissions` is an explicit allowlist evaluated by the dispatcher:

```ts
type AgentPermissions = {
  readArtifacts: ArtifactType[]; // e.g. ['intake','research_report']
  writeArtifacts: ArtifactType[];
  network: 'none' | 'research_allowlist' | 'figma' | 'github';
  sandbox: boolean; // must run in an isolated Cloudflare Sandbox
  github?: { repoScope: 'project_repo'; branches: 'feature_only'; canMerge: false };
};
```

Hard rules enforced by the dispatcher regardless of contract contents:

- No agent can write to `approvals`, `projects.current_stage`, `audit_logs`
  (agents are _subjects_ of audit logs, written by the dispatcher).
- No agent receives credentials broader than its contract's allowlist.
- GitHub-capable agents get branch-scoped tokens; merging is impossible
  (`canMerge: false` is not configurable).

## The agent roster

| Agent type           | Stage                | Input artifacts                                         | Output artifacts                                         | Key constraints                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | -------------------- | ------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project_manager`    | cross-stage          | intake, stage outputs                                   | status summaries, task lists                             | Recommends only; cannot transition stages or approve.                                                                                                                                                                                                                                                                                                                                             |
| `research`           | `research`           | intake                                                  | `research_report` + **source log**                       | Every factual claim must carry a source entry; unverifiable claims are flagged, and flagged claims route to the factual-claims approval gate before publication.                                                                                                                                                                                                                                  |
| `content_strategy`   | `content_strategy`   | intake, research_report                                 | `sitemap`, `content_plan`, `draft_copy` + source log     | May not invent facts absent from research/intake; unverified claims flagged, never published without human approval.                                                                                                                                                                                                                                                                              |
| `creative_direction` | `creative_direction` | intake, research_report, content_plan                   | `creative_brief`                                         | Style/mood/direction only.                                                                                                                                                                                                                                                                                                                                                                        |
| `uiux_design`        | `design`             | creative_brief, sitemap, content_plan, branding files   | `figma_design` (Figma file/node refs + snapshot)         | Works via Figma MCP/REST; output is a referenced Figma artifact version that the design gate reviews.                                                                                                                                                                                                                                                                                             |
| `developer`          | `development`        | **approved** figma_design, content_plan, creative_brief | `code_change` (generated site + branch/PR reference)     | Enforced in code: the input loader refuses to run unless the latest `figma_design` version is `approved` (ADR-0018). Emits one stylesheet plus per-page body fragments — never whole documents, scripts, forms or remote resources; violations fail the run. Pushes `site/attempt-N` to the project's own repository and opens a pull request; never pushes to a default branch and never merges. |
| `tester`             | `testing`            | code_change, content_plan                               | `test_report`                                            | May write failing-test reproductions. **May not approve or merge its own fixes**; fixes go back through `developer`, and the next `tester` run must be a distinct run evaluating the new change.                                                                                                                                                                                                  |
| `seo_aeo`            | `seo_review`         | code_change, content artifacts                          | `seo_report`, optional `code_change` (recommendation PR) | May recommend or open PRs; **may not deploy or merge**.                                                                                                                                                                                                                                                                                                                                           |

## Dispatch protocol

```
Workflow step → dispatcher.run({
  agentType, contractVersion,
  projectId, organizationId,
  inputs: [{artifactId, version}, …],
  idempotencyKey: (instanceId, stepName, attempt),
})
  1. Validates inputs exist, are the pinned versions, and (where required) are approved.
  2. Creates agent_runs row (status=running) — idempotent on the key.
  3. Executes (MVP: simulator; later: Claude Agent SDK in Cloudflare Sandbox).
  4. Validates output against the contract's output schema (Zod).
  5. Persists output artifacts (new versions) + updates agent_runs
     (status, timings, tokens, cost, error details).
  6. Returns {agentRunId, outputArtifacts} to the workflow step.
```

The dispatcher is the **only** code path that executes agents. It owns audit logging,
permission enforcement, cost accounting and retry bookkeeping, so these cannot be
skipped by any individual agent implementation.

## Prompt versioning

Prompts are code: stored in the repo (`packages/agents/prompts/<agentType>/vN.md`),
reviewed via PR, and referenced by version in every run. Prompts are never exposed to
clients. Changing a prompt bumps its version; `agent_runs.prompt_version` makes every
historical run reproducible and comparable.

## Source logs and factual claims

Research and content agents must produce a `source_log` alongside their artifact:
`[{ claim, sourceUrl | 'client_intake' | 'unverified', confidence }]`. Any
`unverified` entry marks the artifact as containing unverified claims; such artifacts
cannot pass the pre-publication gates until a human approves or the claim is removed.
This implements the "no unsupported factual claims" and "unverified claims need
approval" rules mechanically rather than by convention.

## MVP simulation

The MVP ships the dispatcher, contracts, schemas and tables with a `SimulatedExecutor`
that sleeps, fabricates schema-valid outputs and realistic run metadata. Swapping in
the real executor (Claude Agent SDK in a Sandbox) is a bounded change behind the
`AgentExecutor` interface — an explicit acceptance criterion of the MVP.
