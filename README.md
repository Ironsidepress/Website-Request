# Website Factory

Multi-tenant platform that takes a small business owner from a guided intake
questionnaire to a launched website through a deterministic, human-supervised,
agent-assisted production pipeline.

Built on TypeScript, Next.js and Cloudflare (Workers, D1, R2, Workflows, Queues),
with Cloudflare Workflows as the authoritative project orchestrator.

## Quick start

```bash
corepack enable
pnpm install
pnpm dev     # local development (Next.js + orchestrator worker, local resources)
pnpm check   # all quality gates: format, lint, typecheck, tests, builds
```

Full instructions: [`docs/local-development.md`](docs/local-development.md).

## Repository layout

| Path                   | Purpose                                                           |
| ---------------------- | ----------------------------------------------------------------- |
| `apps/web`             | Control-plane web app: client portal, admin dashboard, API routes |
| `workers/orchestrator` | Cloudflare Workflow definitions, queue consumers, cron            |
| `packages/schemas`     | Versioned Zod schemas (env, intake, events, agents, API)          |
| `packages/db`          | Drizzle schema, migrations, tenant-scoped repositories (M1+)      |
| `packages/core`        | Domain services and state machine (M1+)                           |
| `packages/agents`      | Agent contracts, prompts, simulated executor (M5+)                |
| `packages/testing`     | Test factories and harnesses (M1+)                                |
| `packages/config`      | Shared TypeScript configuration                                   |
| `docs/`                | Architecture and product documentation                            |

## Documentation

Start with [`docs/product-brief.md`](docs/product-brief.md), then
[`docs/architecture-decisions.md`](docs/architecture-decisions.md) and
[`docs/mvp-implementation-plan.md`](docs/mvp-implementation-plan.md).
Environment/secret setup: [`docs/environments.md`](docs/environments.md).
Branch protection: [`docs/branch-protection.md`](docs/branch-protection.md).

## Status

**M0 (scaffolding and CI quality gates) — complete.** No authentication, database
tables or product features yet; those begin with M1
([`docs/mvp-implementation-plan.md`](docs/mvp-implementation-plan.md)).
