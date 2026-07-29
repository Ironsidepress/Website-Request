# Data Model (Cloudflare D1)

Conventions:

- SQLite dialect (D1). IDs are UUIDv7 strings generated in application code
  (time-ordered, index-friendly). Timestamps are ISO-8601 UTC strings
  (`TEXT`), named `*_at`.
- Every tenant-owned table carries `organization_id` and every query on it filters by
  it (see `docs/security-model.md`).
- Schema lives in Drizzle ORM definitions (`packages/db`); migrations are generated
  SQL applied with `wrangler d1 migrations apply`. **Every schema change ships a
  migration.**
- JSON columns (`TEXT` + Zod validation at the boundary) are used for versioned
  documents and payloads, marked `-- json` below.
- Auth-library tables (users' credentials, sessions, verification tokens) are owned by
  the chosen auth library (ADR-0003) and omitted here except `users`, which we extend.

## Entity overview

```
users ──< organization_members >── organizations
users/organizations ──< invitations (member + invitation-only staff)
organizations ──< intakes ──< intake_revisions
organizations ──< files
organizations ──< projects ──< project_stage_history
projects ──< workflow_runs ──< workflow_events
projects ──< approvals
projects ──< artifacts (versioned)
projects ──< agent_runs
audit_logs (global, tenant-tagged)
```

## DDL

```sql
-- ============ identity & tenancy ============

CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  auth_subject   TEXT NOT NULL UNIQUE,     -- auth-layer subject id; the ONLY link to
                                           -- the auth library (ADR-0003 adapter boundary)
  email          TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  platform_role  TEXT CHECK (platform_role IN ('admin','reviewer','operator')), -- NULL = client
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
  -- credential/session columns live in the auth library's own tables (ba_*),
  -- which application code never reads or writes.
);

CREATE TABLE organizations (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  phone        TEXT,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE organization_members (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id         TEXT NOT NULL REFERENCES users(id),
  role            TEXT NOT NULL CHECK (role IN ('owner','member')),
  created_at      TEXT NOT NULL,
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX idx_members_user ON organization_members(user_id);

CREATE TABLE invitations (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('organization_member','staff')),
  organization_id TEXT REFERENCES organizations(id),  -- NULL for staff invitations
  email           TEXT NOT NULL,
  role            TEXT NOT NULL,            -- org role (member) or platform role (staff)
  token_hash      TEXT NOT NULL UNIQUE,     -- SHA-256 of the token; raw token never stored
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','accepted','revoked','expired')),
  invited_by      TEXT NOT NULL REFERENCES users(id),
  expires_at      TEXT NOT NULL,
  accepted_at     TEXT,
  accepted_by     TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_invitations_org ON invitations(organization_id, status);
CREATE INDEX idx_invitations_email ON invitations(email, status);

-- ============ auth library tables (ba_*) ============
-- ba_user, ba_session, ba_account, ba_verification, ba_rate_limit are owned by
-- the auth library via its adapter (ADR-0003). They are defined in
-- packages/db/src/schema/auth.ts solely so migrations cover them; application
-- code accesses identity exclusively through the AuthService adapter.

-- ============ intake ============

CREATE TABLE intakes (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','submitted','archived')),
  schema_version  INTEGER NOT NULL,
  data            TEXT NOT NULL,            -- json IntakeDocument (draft-relaxed until submit)
  current_revision INTEGER NOT NULL DEFAULT 0,
  submitted_at    TEXT,
  submitted_by    TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_intakes_org ON intakes(organization_id, status);
-- one active draft per org, enforced by partial unique index:
CREATE UNIQUE INDEX idx_intakes_one_draft
  ON intakes(organization_id) WHERE status = 'draft';

CREATE TABLE intake_revisions (
  id          TEXT PRIMARY KEY,
  intake_id   TEXT NOT NULL REFERENCES intakes(id),
  revision    INTEGER NOT NULL,
  section_id  TEXT NOT NULL,
  section_data TEXT NOT NULL,               -- json snapshot of the section after the write
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  UNIQUE (intake_id, revision)
);

-- ============ files (R2 metadata) ============

CREATE TABLE files (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  intake_id       TEXT REFERENCES intakes(id),
  project_id      TEXT REFERENCES projects(id),
  r2_key          TEXT NOT NULL UNIQUE,     -- {org_id}/{file_id}/{sanitized_name}
  original_name   TEXT NOT NULL,
  content_type    TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  checksum_sha256 TEXT,
  purpose         TEXT NOT NULL CHECK (purpose IN
                    ('logo','brand_guide','photo','copy_document','other')),
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','stored','failed','deleted')),
  uploaded_by     TEXT NOT NULL REFERENCES users(id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_files_org ON files(organization_id, status);
CREATE INDEX idx_files_intake ON files(intake_id);

-- ============ projects & history ============

CREATE TABLE projects (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  intake_id       TEXT NOT NULL REFERENCES intakes(id),
  name            TEXT NOT NULL,
  current_stage   TEXT NOT NULL DEFAULT 'created',   -- projection; workflow is authoritative
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','on_hold','cancelled','completed')),
  health          TEXT NOT NULL DEFAULT 'ok' CHECK (health IN ('ok','needs_attention')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_projects_org ON projects(organization_id);
CREATE INDEX idx_projects_stage ON projects(current_stage, status);

CREATE TABLE project_stage_history (       -- append-only
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  from_stage    TEXT,
  to_stage      TEXT NOT NULL,
  attempt       INTEGER NOT NULL DEFAULT 1,
  event_type    TEXT NOT NULL,             -- stage.started|stage.completed|stage.failed|override.transition|…
  actor_type    TEXT NOT NULL CHECK (actor_type IN ('user','agent','system')),
  actor_id      TEXT NOT NULL,
  workflow_instance_id TEXT,
  client_visible INTEGER NOT NULL DEFAULT 1,  -- 0 = internal-only event
  metadata      TEXT,                      -- json, schema-versioned per event_type
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_history_project ON project_stage_history(project_id, created_at);

-- ============ workflow runs & events ============

CREATE TABLE workflow_runs (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  workflow_name   TEXT NOT NULL,           -- 'project-pipeline'
  cf_instance_id  TEXT NOT NULL UNIQUE,    -- Cloudflare Workflows instance id
  status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running','paused','completed','failed','terminated')),
  started_at      TEXT NOT NULL,
  ended_at        TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_wfruns_project ON workflow_runs(project_id);

CREATE TABLE workflow_events (             -- append-only, the audit spine of orchestration
  id              TEXT PRIMARY KEY,        -- eventId from the envelope
  project_id      TEXT NOT NULL REFERENCES projects(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  workflow_run_id TEXT REFERENCES workflow_runs(id),
  type            TEXT NOT NULL,
  schema_version  INTEGER NOT NULL,
  actor_type      TEXT NOT NULL,
  actor_id        TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,    -- (instance, step, purpose) — retry-safe inserts
  payload         TEXT NOT NULL,           -- json, validated by versioned per-type schema
  occurred_at     TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_wfevents_project ON workflow_events(project_id, occurred_at);

-- ============ approvals ============

CREATE TABLE approvals (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  gate            TEXT NOT NULL CHECK (gate IN
                    ('design_review','preview_review','production_approval',
                     'domain_purchase','dns_change','factual_claims')),
  stage_attempt   INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected','expired','superseded')),
  required_roles  TEXT NOT NULL,           -- json, e.g. ["owner"] or ["reviewer","admin"]
  artifact_refs   TEXT NOT NULL,           -- json [{artifactId, version}] under review
  requested_at    TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  decided_at      TEXT,
  decided_by      TEXT REFERENCES users(id),
  decision_reason TEXT,                    -- required for rejections
  workflow_instance_id TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_approvals_pending ON approvals(status, expires_at);
CREATE INDEX idx_approvals_project ON approvals(project_id);
-- at most one pending approval per (project, gate):
CREATE UNIQUE INDEX idx_approvals_one_pending
  ON approvals(project_id, gate) WHERE status = 'pending';

-- ============ artifacts (versioned outputs) ============

CREATE TABLE artifacts (
  id              TEXT NOT NULL,
  version         INTEGER NOT NULL,
  project_id      TEXT NOT NULL REFERENCES projects(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  type            TEXT NOT NULL,           -- research_report|sitemap|content_plan|draft_copy|
                                           -- creative_brief|figma_design|code_change|test_report|
                                           -- seo_report|source_log|…
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','approved','rejected','superseded')),
  storage         TEXT NOT NULL CHECK (storage IN ('inline','r2','external_ref')),
  content         TEXT,                    -- json when inline; else NULL
  r2_key          TEXT,                    -- when storage='r2'
  external_ref    TEXT,                    -- json: figma file/node ids, github pr url, …
  has_unverified_claims INTEGER NOT NULL DEFAULT 0,
  created_by_type TEXT NOT NULL CHECK (created_by_type IN ('user','agent','system')),
  created_by_id   TEXT NOT NULL,           -- agent_run id or user id
  created_at      TEXT NOT NULL,
  PRIMARY KEY (id, version)
);
CREATE INDEX idx_artifacts_project ON artifacts(project_id, type, status);

-- ============ agent runs (audit; simulated in MVP) ============

CREATE TABLE agent_runs (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id),
  organization_id  TEXT NOT NULL REFERENCES organizations(id),
  agent_type       TEXT NOT NULL,
  contract_version INTEGER NOT NULL,
  prompt_version   TEXT NOT NULL,
  input_artifacts  TEXT NOT NULL,          -- json [{artifactId, version}]
  output_artifacts TEXT,                   -- json [{artifactId, version}]
  model            TEXT NOT NULL,          -- 'simulated' in MVP
  status           TEXT NOT NULL DEFAULT 'running'
                     CHECK (status IN ('running','succeeded','failed','timed_out','cancelled')),
  retry_count      INTEGER NOT NULL DEFAULT 0,
  started_at       TEXT NOT NULL,
  completed_at     TEXT,
  input_tokens     INTEGER,
  output_tokens    INTEGER,
  estimated_cost_usd REAL,
  error_detail     TEXT,                   -- internal only; never sent to clients
  idempotency_key  TEXT NOT NULL UNIQUE,
  transcript_r2_key TEXT,                  -- staff-only prefix; NULL in MVP
  created_at       TEXT NOT NULL
);
CREATE INDEX idx_agent_runs_project ON agent_runs(project_id, started_at);

-- ============ audit log ============

CREATE TABLE audit_logs (                  -- append-only; no UPDATE/DELETE path in code
  id              TEXT PRIMARY KEY,
  organization_id TEXT,                    -- NULL for platform-level actions
  actor_type      TEXT NOT NULL CHECK (actor_type IN ('user','agent','system')),
  actor_id        TEXT NOT NULL,
  action          TEXT NOT NULL,           -- 'intake.submitted','approval.approved',
                                           -- 'file.uploaded','override.transition','auth.login',…
  resource_type   TEXT NOT NULL,
  resource_id     TEXT NOT NULL,
  ip_address      TEXT,
  metadata        TEXT,                    -- json; MUST NOT contain secrets or raw prompts
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_audit_org ON audit_logs(organization_id, created_at);
CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id);
```

## Design notes

- **`projects.current_stage` is a projection.** The workflow (and audited admin
  overrides) are its only writers; guarded updates keep retries convergent
  (see `docs/workflow-state-machine.md`).
- **Append-only tables** (`project_stage_history`, `workflow_events`, `audit_logs`,
  `intake_revisions`): the data layer exposes only insert/select for these.
- **Artifacts are immutable per version.** Rework creates version N+1; approvals pin
  exact versions, which is what makes "developer works only from approved design"
  enforceable.
- **Client-visible filtering** happens at query level: timeline queries select
  `client_visible = 1` history rows and never join `agent_runs` or `error_detail`.
- **Idempotency keys** on `workflow_events` and `agent_runs` make workflow-step
  retries safe: replays hit the UNIQUE constraint and read back the existing row.
- **D1 constraints to respect:** no row > ~2 MB in practice (keep large payloads in
  R2), 10 GB per database; per-tenant data volumes here are small, but file bytes
  always live in R2 with only metadata in D1.
- **Future sharding escape hatch:** all tenant tables key by `organization_id`
  first in composite indexes, so a later split into per-tenant or sharded D1
  databases (D1's horizontal scaling story) doesn't require query rewrites.
