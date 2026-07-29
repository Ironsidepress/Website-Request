# Environments and Secrets

ADR-0016 governs this document. One Cloudflare account, three environments:

| Environment    | Where                              | Data                                                           | Address                                              |
| -------------- | ---------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------- |
| **local**      | Wrangler/Miniflare on your machine | Local emulated D1/R2/queues — never production data by default | `localhost`                                          |
| **staging**    | Cloudflare, `--env staging`        | `*-staging` resources only                                     | `workers.dev` (initially)                            |
| **production** | Cloudflare, `--env production`     | `*-production` resources only                                  | `workers.dev` initially; custom domain later (below) |

**Hard rule:** staging and production never share a D1 database, R2 bucket,
queue, workflow binding, secret or allowed-origin list.

## Resource naming

| Resource            | Staging                                    | Production                                    |
| ------------------- | ------------------------------------------ | --------------------------------------------- |
| Web worker          | `website-factory-staging`                  | `website-factory-production`                  |
| Orchestrator worker | `website-factory-orchestrator-staging`     | `website-factory-orchestrator-production`     |
| D1 database         | `website-factory-db-staging`               | `website-factory-db-production`               |
| R2 bucket           | `website-factory-assets-staging`           | `website-factory-assets-production`           |
| Queue               | `website-factory-events-staging`           | `website-factory-events-production`           |
| Workflow            | `website-factory-project-pipeline-staging` | `website-factory-project-pipeline-production` |

## Provisioning (manual, human-confirmed — never automated)

Nothing in this repository, CI or any agent provisions Cloudflare resources
automatically. A human runs these commands deliberately, starting in M1 when the
first binding is needed. Production commands should be run only after staging
works and with explicit confirmation of each command.

```bash
# Staging (run when M1 needs them)
wrangler d1 create website-factory-db-staging
wrangler r2 bucket create website-factory-assets-staging
wrangler queues create website-factory-events-staging

# Production (run later, deliberately — each command confirmed by a human)
wrangler d1 create website-factory-db-production
wrangler r2 bucket create website-factory-assets-production
wrangler queues create website-factory-events-production
```

After provisioning, paste the returned IDs into the **placeholder blocks** in
`apps/web/wrangler.jsonc` and `workers/orchestrator/wrangler.jsonc`.

> **Committed-ID policy.** D1 `database_id` values are configuration, not
> secrets, and Wrangler requires them in the config file; committing them is
> acceptable. Anything credential-like (tokens, auth secrets, API keys) must
> never be committed — those go through `wrangler secret put`. When in doubt,
> treat it as a secret.

## Secrets

Secrets are set per worker **and per environment**; staging and production values
must be generated independently (never reuse an authentication secret across
environments):

```bash
# examples for M1 (from the app directory):
wrangler secret put BETTER_AUTH_SECRET --env staging
wrangler secret put BETTER_AUTH_SECRET --env production
```

Rules:

- Never in `wrangler.jsonc` `vars`, source, docs, logs or generated artifacts.
- Local values live in `.dev.vars` (gitignored); `.dev.vars.example` documents
  the required keys with placeholders.
- Rotation: set the new value with `wrangler secret put` and redeploy; sessions
  invalidated by an auth-secret rotation are an accepted consequence.
- CI never holds Cloudflare credentials in M0 (no deploys). When deploys are
  added, use a scoped API token stored as a GitHub Actions secret.

## Environment variables (non-secret)

Validated at startup by `packages/schemas/src/env.ts`:

| Variable              | Scope | Notes                                                                      |
| --------------------- | ----- | -------------------------------------------------------------------------- |
| `APP_ENV`             | all   | `development` / `staging` / `production`; set in `wrangler.jsonc` per env. |
| `LOG_LEVEL`           | all   | defaults to `info`.                                                        |
| `ALLOWED_ORIGINS`     | web   | comma-separated, explicit per environment (never shared).                  |
| `INITIAL_ADMIN_EMAIL` | web   | bootstrap only — see below.                                                |

## Initial administrator bootstrap (ADR-0015)

1. Set the variable for the target environment (staging first):
   `wrangler secret put INITIAL_ADMIN_EMAIL --env staging` (treated as a secret to
   keep it out of committed config, even though it is only an email address).
2. The administrator registers through the normal flow and **verifies their
   email**.
3. On verification, the bootstrap check promotes the matching verified account to
   `admin`, idempotently, and writes an `auth.admin_bootstrapped` audit event.
4. **Decommission after success:** delete the variable —
   `wrangler secret delete INITIAL_ADMIN_EMAIL --env staging` — and redeploy.
   With the variable absent the bootstrap code path is skipped entirely. If the
   variable is present while an administrator already exists, the check no-ops
   and logs a warning reminding operators to remove it.
5. Every further staff account is created by invitation from an administrator.

## Local development isolation

- `wrangler dev` and `opennextjs-cloudflare preview` run against **local**
  Miniflare state by default; the configs in this repo never point local dev at
  remote resources.
- Do not use `--remote` against production. If a remote debugging session is ever
  genuinely required, use staging, announce it, and prefer read-only queries.

## Custom domains (optional, later)

Staging stays on `workers.dev`. When production gets a custom domain:

1. Add the zone to the Cloudflare account.
2. In `apps/web/wrangler.jsonc` under `env.production`, replace `workers_dev: true`
   with a `routes` entry (`{ "pattern": "www.example.com", "custom_domain": true }`).
3. Update production `ALLOWED_ORIGINS` accordingly.
4. DNS changes for **client** sites are a different matter entirely — they go
   through the platform's human-approval gates (`dns_change`), never through this
   file.
