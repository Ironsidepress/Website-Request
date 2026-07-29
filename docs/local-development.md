# Local Development

## Prerequisites

- **Node.js 22** (`.nvmrc` — `nvm use` picks it up)
- **pnpm 10** (`corepack enable` activates the version pinned in
  `package.json#packageManager`)

## First-time setup (fresh clone)

```bash
git clone <repo-url> && cd Website-Request
corepack enable          # ensures the pinned pnpm version
pnpm install             # installs the whole workspace
cp apps/web/.dev.vars.example apps/web/.dev.vars
cp workers/orchestrator/.dev.vars.example workers/orchestrator/.dev.vars
```

`.dev.vars` files are gitignored; fill in values per the comments in the examples.
Never put real secrets in any committed file.

## The two commands

| Purpose                | Command      |
| ---------------------- | ------------ |
| Run local development  | `pnpm dev`   |
| Run all quality checks | `pnpm check` |

- `pnpm dev` runs `turbo run dev`: the Next.js app on `http://localhost:3000` and
  the orchestrator worker via `wrangler dev` (local Miniflare — **never production
  data by default**; connecting to remote resources requires explicitly passing
  `--remote`, which you should not do against production).
- `pnpm check` runs, in order: Prettier check, ESLint, TypeScript (`tsc --noEmit`
  in every package), Vitest unit tests, and builds (Next.js build + orchestrator
  `wrangler deploy --dry-run`). CI runs exactly these same gates.

## Individual commands

```bash
pnpm format         # prettier --write .
pnpm format:check   # verify formatting only
pnpm lint           # eslint across the whole repo
pnpm typecheck      # per-package tsc --noEmit via turbo
pnpm test           # vitest per package via turbo
pnpm build          # per-package builds via turbo
pnpm --filter @website-factory/web e2e   # Playwright E2E (applies local D1 migrations first)

# Scope any turbo task to one package:
pnpm --filter @website-factory/web dev
pnpm --filter @website-factory/schemas test
```

## Workspace layout

See `docs/mvp-implementation-plan.md` for the full annotated tree. Short version:
`apps/web` (Next.js portal + API), `workers/orchestrator` (Workflows/queues/cron),
`packages/{schemas,db,core,agents,testing,config}` (shared code; most are M0
skeletons until their milestone).

## Conventions

- Strict TypeScript everywhere; `any` requires an eslint-disable comment with a
  documented reason.
- Business logic belongs in `packages/core`, never in UI components or route
  handlers.
- All external input is validated with schemas from `packages/schemas`.
- From M1 on: every schema change ships a D1 migration; every tenant-scoped
  endpoint registers in the tenant-isolation test suite.

## Troubleshooting

- **`pnpm install` fails on Node version:** check `node --version` ≥ 22.
- **Stale turbo cache after config changes:** `pnpm exec turbo run build --force`.
- **Wrangler asks for login during `pnpm dev`:** local dev should not need auth;
  make sure you are not passing `--remote`.
