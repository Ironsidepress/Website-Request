# Branch Protection

`main` is the protected default branch. Configure the following in GitHub
(**Settings → Branches → Add branch protection rule**, pattern `main`) or via a
repository ruleset. This must be done manually by a repository administrator —
document completion in the PR that lands M0.

## Required settings

- **Require a pull request before merging** — no direct pushes to `main`, for
  humans and agents alike (platform rule: agents never push to protected main).
  - Required approvals: **1**.
  - Dismiss stale approvals when new commits are pushed: **on**.
- **Require status checks to pass before merging**, with these checks required:
  - `Format, lint, typecheck, test, build` (CI quality job)
  - `Secret scan` (gitleaks job)
  - Require branches to be up to date before merging: **on**.
- **Block force pushes**: on.
- **Restrict deletions**: on.
- **Do not allow bypassing the above settings** (include administrators).

## Recommended settings

- Require linear history (squash or rebase merges only).
- Require conversation resolution before merging.
- Once `.github/CODEOWNERS` has real owners: enable
  **Require review from Code Owners**.

## Why these checks

The CI workflow (`.github/workflows/ci.yml`) fails on any formatting, linting,
type, test or build error — making those the merge gate satisfies the M0 quality
requirements. The same discipline (protected main, PR-only, required checks) is
the model the platform later imposes on generated client-site repositories
(`docs/agent-contracts.md`).

## Verification checklist

- [ ] Direct push to `main` is rejected for an admin account.
- [ ] A PR with a failing check cannot be merged.
- [ ] Force push to `main` is rejected.
- [ ] Both CI checks appear and are marked "required" on a test PR.
