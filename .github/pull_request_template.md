## Summary

<!-- What does this change do, and why? Link the milestone/issue. -->

## Changes

<!-- Bullet list of material changes. -->

## Testing

<!-- How was this verified? Reference added/updated tests. -->

## Risks and follow-ups

<!-- Known risks, deferred work, or "none". -->

## Checklist

- [ ] `pnpm check` passes locally (format, lint, typecheck, tests, build).
- [ ] New/changed behavior is covered by tests.
- [ ] Every schema change ships a database migration (from M1 on).
- [ ] Tenant-scoped endpoints are registered in the tenant-isolation suite (from M1 on).
- [ ] No secrets, real resource IDs or internal prompts in committed files.
- [ ] Relevant `/docs` documents updated if behavior or architecture changed.
