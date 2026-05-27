# @supplystrata/api

`apps/api` is the Gate 8 contract boundary for future HTTP, desktop, and agent consumers.

Current scope:

- Versioned route registry in `features/api-contract/definitions`.
- Public DTO source mapping to `render`, `chain-view`, `workbench-export`, and `research-pack`.
- OpenAPI 3.1 document generation from the same route registry.
- Contract audit helpers that keep DB rows out of the API surface.

This app is intentionally contract-only for now. It does not start an HTTP server, open database connections, or mutate the truth store. Review routes are declared with `review_queue_mutation_only_no_fact_edge_write`; applying fact edges remains a separate reviewed workflow.

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
- `GET /unknowns/:scope`
- `GET /companies/:id/consumer-read-model`
- `GET /companies/:id/reasoning-walkthrough`
- `POST /review/:id/approve`
- `POST /review/:id/reject`

Run the contract tests with:

```bash
pnpm -s test:unit -- tests/unit/api-contract.test.ts
```
