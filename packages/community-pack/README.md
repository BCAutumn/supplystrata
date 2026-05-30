# @supplystrata/community-pack

`community-pack` defines the neutral exchange package used to distribute publish-eligible SCBOM documents as a read-only warm-start baseline.

## Canonical Format

- One `manifest.json`.
- One or more SCBOM JSONL data files.
- Each JSONL line is a complete SCBOM document validated by `@scbom/spec`.
- Each data file is covered by a manifest `sha256`, byte count, document count, and SCBOM object counts.

The canonical data format is `scbom-jsonl`. Parquet, SQLite, or other derived formats may be generated later, but they are not canonical in v0.x.

## Manifest

The manifest is intentionally small and vendor-neutral:

- `schema_version`: community-pack manifest schema version.
- `pack_version`: release label such as `pack-2026.Q2`.
- `generated_at`: generation timestamp.
- `canonical_format`: always `scbom-jsonl`.
- `scbom_schema_version`: SCBOM schema version carried by each document.
- `license`: data license string for the pack artifact.
- `source_instance.fingerprint`: sha256 fingerprint of the producing local instance configuration, not a truth claim.
- `files`: relative JSONL file entries with sha256 integrity metadata.
- `totals`: aggregate document and object counts.

The manifest does not carry SupplyStrata claim state, risk metrics, private evidence levels beyond what the SCBOM document already exposes, or loader-specific cache state.

## Load-side trust gate

A pack has no signature and no trust root, so the loader (`loadCommunityPackFromPath`) does not trust a pack just because its `manifest` sha256 hashes are self-consistent. After integrity verification it independently re-checks publish-eligibility (`assertCommunityPackPublishEligible`): every `relationship` must be `active`, carry `evidence_level >= 4`, and be backed by `evidence` objects that are themselves `evidence_level >= 4` and `extraction_method = rule`. Any non-conforming relationship rejects the whole pack. Hosts (e.g. the MCP runtime) then degrade to local cache and warn, rather than serving untrusted relationships as a baseline.

## Boundary

This package does not read from or write to Postgres. Export selection and Postgres mirroring live in later Phase G slices. The format layer validates that a pack is self-describing, SCBOM-based, integrity-covered, and publish-eligible.
