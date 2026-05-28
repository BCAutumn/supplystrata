# @supplystrata/sources-openfigi

OpenFIGI source adapter for listed security identity candidates.

## Boundary

- Emits `EntitySourceCandidate` records only.
- Does not write `entity_master`, aliases, evidence, claims, or fact edges.
- FIGI identifies financial instruments, so callers must not treat a match as a final legal-entity fact without explicit bootstrap rules.

## API And Limits

- Endpoint: `https://api.openfigi.com/v3/search`
- Authentication: none for v0; API key support is intentionally not wired into this package.
- Adapter limit: `25 req/min`.
- Fetch timeout: 12 seconds.
- Request method: `POST`.
- Request headers: `Content-Type: application/json`, `Accept: application/json`.

## Fields

- FIGI, composite FIGI, share class FIGI.
- Name, ticker, exchange code, market sector, security type, security description.
- Optional `exchCode` input for exchange-scoped lookup.

## Known Gaps

- OpenFIGI search can return multiple instruments for one company name.
- Results are instrument identities, not company registry records.
- Default outcome for bootstrap should be `ambiguous` unless cross-source identity rules produce one unambiguous entity.
