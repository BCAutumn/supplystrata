## What changed

Describe the change in plain language.

## Evidence and data boundary

- [ ] No `.env`, API keys, raw PDFs, raw HTML, database files, or generated reports are included.
- [ ] If this touches a data source, ToS/license notes were checked and docs were updated.
- [ ] If this changes relation extraction, outputs remain cite-backed and reviewable.
- [ ] If this changes graph writes, Postgres remains the truth store and Neo4j remains rebuildable.

## Checks

- [ ] `pnpm type-check`
- [ ] `pnpm test:unit`
- [ ] `pnpm test:integration`
- [ ] `pnpm lint`
- [ ] `pnpm dep-check`

## Docs

- [ ] Docs updated, or this change does not need docs.
