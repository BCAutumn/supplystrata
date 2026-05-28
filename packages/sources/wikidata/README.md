# @supplystrata/sources-wikidata

Wikidata source adapter for collaborative identity hints and cross-identifier links.

## Boundary

- Emits `EntitySourceCandidate` records only.
- Does not write `entity_master`, aliases, evidence, claims, or fact edges.
- Wikidata is collaborative, not authoritative. It can support ambiguity handling and profile context, but it must not promote facts beyond `max_evidence_level = 3`.

## API And Limits

- SPARQL endpoint: `https://query.wikidata.org/sparql`
- EntityData endpoint: `https://www.wikidata.org/wiki/Special:EntityData/<QID>.json`
- Authentication: none.
- Adapter limit: `1 req/s`.
- Fetch timeout: 12 seconds.
- Request headers: `Accept: application/sparql-results+json` for SPARQL and `Accept: application/json` for EntityData.

## Fields

- QID, English label, English description, aliases.
- Official website.
- Cross identifiers: LEI, ISIN, CIK, ticker.
- Context hints: industry labels and country labels.

## Known Gaps

- Search results can include similarly named companies, brands, products, or subsidiaries.
- Claims are community-maintained and can be stale or vandalized.
- Identity bootstrap must default to `ambiguous` unless other sources produce one unambiguous entity.
