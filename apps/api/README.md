# @supplystrata/api

`apps/api` is the thin Node HTTP adapter for the reusable `@supplystrata/api-orchestration` contract and handler boundary.

Current scope:

- Minimal Node HTTP adapter that wraps implemented handlers in the same versioned envelopes.
- HTTP request parsing, response serialization, server lifecycle, and port binding.
- Delegation to `@supplystrata/api-orchestration` for route contracts, OpenAPI, public DTOs, and database-backed operation handlers.

The HTTP adapter is intentionally thin: it starts a Node server, opens the configured Postgres store, and delegates to existing public DTO builders, source workflow use-cases, source monitor use-cases, and AI analysis contracts. The database is not the company coverage boundary; it is the evidence ledger, run/status ledger, history baseline, and change-detection memory. `GET /companies/:id/supply-chain-report` is a read-through research surface: it may bootstrap a listed-company identity, enqueue source-check jobs, and by default run due source checks inline when data is missing or stale, then returns the current report context plus observable run state. Callers can pass `source_checks=queued` to leave source checks for the worker. Research-run creation remains the explicit mutation boundary for callers that want direct run control; neither path can write fact edges or call AI providers. Review routes are declared with `review_queue_mutation_only_no_fact_edge_write`; applying fact edges remains a separate reviewed workflow.
All v0 contract routes are now marked `http_adapter_backed` in OpenAPI. The consumer read-model and reasoning walkthrough handlers build a read-only research pack without enabling claim build, intelligence refresh, component-risk refresh, or unknown materialization write steps.
AI routes are deliberately inspectable and non-agentic: provider status is sanitized, run/status exposes input refs and guardrails, the company analysis plan lists the exact nodes that may later be handed to a model, and latest analysis returns a previously generated artifact. These read routes do not call a model and do not allow truth-store mutation.

The first protected surface is:

- `GET /companies/:id/card`
- `GET /components/:id/card`
- `GET /chains/:scope`
- `GET /claims/:id`
- `GET /evidence/:id`
- `GET /observations/:scope`
- `GET /risk-views/:scope`
- `GET /changes`
- `GET /sources/health`
- `GET /runs/source-checks`
- `GET /research-runs/:id`
- `GET /ai/provider-status`
- `GET /runs/ai-analysis`
- `GET /unknowns/:scope`
- `GET /companies/:id/supply-chain-report`
- `GET /companies/:id/consumer-read-model`
- `GET /companies/:id/reasoning-walkthrough`
- `GET /companies/:id/ai-analysis-plan`
- `GET /companies/:id/ai-analysis/latest`
- `POST /companies/:id/research-runs`
- `POST /review/:id/approve`
- `POST /review/:id/reject`

Run the contract tests with:

```bash
pnpm -s test:unit -- tests/unit/api-contract.test.ts
```

Run the local HTTP adapter with:

```bash
pnpm api
```

By default it listens on port `3001`; override with `SUPPLYSTRATA_API_PORT`.
