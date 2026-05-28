# @supplystrata/sources-gleif

GLEIF LEI Records source adapter for global legal entity identity candidates.

## Boundary

- Emits `EntitySourceCandidate` records only.
- Does not write `entity_master`, aliases, evidence, claims, or fact edges.
- Uses GLEIF records as registry identity evidence with `source_adapter_id = gleif`.

## API And Limits

- Endpoint: `https://api.gleif.org/api/v1/lei-records`
- Authentication: none.
- Adapter limit: `5 req/s`.
- Fetch timeout: 12 seconds.
- Request headers: `Accept: application/vnd.api+json`.

## Fields

- LEI, legal name, jurisdiction, entity status/category, creation date.
- Registration authority id/entity id.
- Legal address and alternate names where provided.
- Optional identifiers: BIC, OpenCorporates id, S&P Global id.

## Known Gaps

- Name search can return multiple legally distinct entities; callers must treat all results as candidates.
- LEI records identify legal entities, not supply-chain relationships.
- A high-confidence candidate is still not a final fact until an explicit review/import path promotes it.
