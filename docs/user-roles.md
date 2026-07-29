# User Roles and Permissions

## Principals

There are three kinds of principal in the system. Every action is attributed to exactly
one of them in audit logs (`actor_type` + `actor_id`).

| Actor type | Description |
| --- | --- |
| `user` | A human authenticated through the auth layer. |
| `agent` | A bounded agent task executed by the orchestrator (recorded via `agent_runs`). |
| `system` | The workflow orchestrator or scheduled jobs acting deterministically. |

## Tenancy model

- An **organization** is the tenant. It represents one client business.
- A **user** may belong to one or more organizations through a **membership** with a
  tenant-scoped role.
- **Staff roles are platform-scoped**, not tenant-scoped. Staff users have no
  membership rows in client organizations; their access is granted by their platform
  role and always cross-tenant, and always audited.

## Roles

### Tenant-scoped roles (client side)

| Role | Description | Key permissions |
| --- | --- | --- |
| `owner` | The client who created the organization. | Everything `member` can, plus: manage organization profile, invite/remove members, submit intake, grant client-side approvals (preview approval), cancel a project. |
| `member` | Additional client user (e.g. office manager). | View projects and timeline, edit intake drafts, upload files. Cannot submit intake, approve, or manage members. |

### Platform-scoped roles (staff side)

| Role | Description | Key permissions |
| --- | --- | --- |
| `admin` | Platform administrator / producer. | Everything: cross-tenant dashboard, all approvals, force stage transitions (audited "manual override"), manage staff accounts, view audit logs, view agent-run metadata (cost, timing, status). |
| `reviewer` | Staff member who reviews stage outputs. | View assigned projects cross-tenant, grant/reject stage approvals (design approval, production approval, factual-claim approval), add review notes. Cannot manage accounts or force transitions. |
| `operator` | Engineering/on-call. | Read-only cross-tenant access to workflow runs, retries, errors, agent cost metrics and audit logs. Can retry a failed workflow step. Cannot approve stage outputs. |

A staff user holds at most one platform role. `admin` ⊃ `reviewer` ⊃ `operator` is
**not** assumed — permissions are checked explicitly per action, not by rank.

## Approval authority matrix

Human approval is mandatory at these gates. Who may approve:

| Gate | `owner` (client) | `reviewer` | `admin` |
| --- | --- | --- | --- |
| Design approval (Figma → development) | ✅ (required) | ✅ (internal QA pass, in addition to client) | ✅ |
| Preview approval (client sign-off on staging site) | ✅ (required) | — | ✅ (may record on client's documented behalf, audited) |
| Production deployment | — | ✅ | ✅ |
| Domain purchase | ✅ (consents to cost) | — | ✅ (executes) |
| DNS record changes | — | ✅ | ✅ |
| Publication of unverified factual claims | ✅ (verifies claims about own business) | ✅ | ✅ |

Rules:

- An approval decision always records: gate, project, decider, decision, reason,
  timestamp and the artifact versions being approved.
- **Separation of duties:** a principal may not approve an artifact it produced.
  Concretely: tester agents never approve their own fixes; a staff user who manually
  edited an artifact cannot be the sole approver of that artifact.
- Agents can never hold approval authority. An agent may *recommend* approval; only
  `user` principals decide.

## Permission enforcement

- Every API handler resolves the session to a principal and derives an explicit
  permission set; handlers check permissions, never role names scattered in UI code.
- Every tenant-scoped database query filters by `organization_id` derived from the
  authenticated context — never from client-supplied input alone
  (see `docs/security-model.md`).
- Staff cross-tenant reads are allowed by role but individually audit-logged.
- Clients never see: internal agent prompts, raw agent logs, other tenants' data,
  cost/token metrics, or staff-only review notes marked internal.

## MVP scope

The MVP implements: `owner`, `member`, `admin`. `reviewer` and `operator` are defined
in the schema (role enum) but staff accounts beyond `admin` may be deferred. The
approval matrix above is implemented for the gates the MVP simulates: design approval,
preview approval and production approval.
