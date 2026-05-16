# Contributing to SupplyStrata

SupplyStrata is an evidence-first supply-chain graph. Contributions are welcome, but the project has a few hard boundaries.

## Principles

- Public, lawful sources only.
- Every relation needs provenance: source URL, source date, cite text, evidence level, confidence, and unknown map impact.
- LLM output is candidate generation, not fact. It must be reviewable and cite-backed.
- PostgreSQL is the truth store. Neo4j is a rebuildable materialized view.
- Do not add automated adapters for sources whose ToS forbids automation.

## Local Setup

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres neo4j
pnpm db:migrate
pnpm cli admin seed
pnpm cli graph rebuild
```

Useful checks:

```bash
pnpm type-check
pnpm test:unit
pnpm test:integration
pnpm lint
pnpm dep-check
pnpm --silent cli graph check --format json
```

## Before Opening a PR

- Read `docs/00-overview/non-goals.md`.
- Read `docs/02-architecture/module-design.md` and keep package boundaries intact.
- Update docs when behavior changes.
- Add or update tests for the changed path.
- Run the checks above.
- Keep generated data out of the PR: `.env`, `data/`, `reports/`, raw PDFs, raw HTML, database files, and logs.

## Data Source Contributions

New source adapters must include:

- Source registry entry.
- ToS / license notes.
- Rate limit policy.
- Field mapping.
- Known blind spots.
- Fixture or contract tests.

If a source is legally or ethically ambiguous, mark it manual-only or reject it. Do not implement first and decide later.
