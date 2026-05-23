import { createHash } from "node:crypto";
import { createId, normalizeAlias } from "@supplystrata/core";
import type { DatabaseStore, DbClient, DbTxClient } from "@supplystrata/db/write";
import {
  supplierListFacilityDisplayName,
  supplierListFacilityEntityId,
  type EntitySourceReviewCandidate,
  type SupplierListReviewCandidate
} from "@supplystrata/review-candidates";
import type { CountRow, EntityIdRow } from "./db-rows.js";

export type EntityImportResult =
  | { status: "applied"; entity_id: string; aliases_inserted: number; aliases_skipped: number; pending_entities_resolved: number; change_id: string }
  | { status: "blocked"; reason: string };

export type FacilityImportResult =
  | { status: "applied"; entity_id: string; display_name: string; aliases_inserted: number; aliases_skipped: number; change_id: string }
  | { status: "blocked"; reason: string };

export async function applyEntitySourceReviewCandidate(
  client: DbTxClient,
  candidate: EntitySourceReviewCandidate,
  reviewer: string
): Promise<EntityImportResult> {
  const conflict = await findIdentifierConflict(client, candidate);
  if (conflict !== undefined && conflict !== candidate.payload.proposed_entity_id) {
    return { status: "blocked", reason: `identifier already belongs to ${conflict}` };
  }

  const aliasConflict = await findAliasConflict(client, candidate.payload.proposed_aliases, candidate.payload.proposed_entity_id);
  if (aliasConflict !== undefined) return { status: "blocked", reason: `alias already belongs to ${aliasConflict.entity_id}: ${aliasConflict.alias}` };

  const entityId = candidate.payload.proposed_entity_id;
  const source = candidate.payload.candidate;
  const primaryCountry = countryFromJurisdiction(source.jurisdiction_code);
  const attrs = {
    entity_source: source.source_adapter_id,
    external_id: source.external_id,
    source_url: source.source_url,
    current_status: source.current_status ?? null,
    company_type: source.company_type ?? null,
    incorporation_date: source.incorporation_date ?? null
  };
  const hqLocation = source.registered_address === undefined ? null : { address: source.registered_address };

  await client.query(
    `INSERT INTO entity_master (
       entity_id, kind, canonical_name, display_name, language_of_canonical, identifiers,
       primary_country, hq_location, industry, status, evidence_for_existence, attrs
     )
     VALUES ($1,'company',$2,$3,'en',$4,$5,$6,$7,'active',$8,$9)
     ON CONFLICT (entity_id) DO UPDATE SET
       canonical_name = EXCLUDED.canonical_name,
       display_name = EXCLUDED.display_name,
       identifiers = entity_master.identifiers || EXCLUDED.identifiers,
       primary_country = COALESCE(entity_master.primary_country, EXCLUDED.primary_country),
       hq_location = COALESCE(entity_master.hq_location, EXCLUDED.hq_location),
       evidence_for_existence = COALESCE(entity_master.evidence_for_existence, EXCLUDED.evidence_for_existence),
       attrs = entity_master.attrs || EXCLUDED.attrs,
       updated_at = now()`,
    [entityId, source.name, source.name, source.identifiers, primaryCountry, hqLocation, [] as string[], candidate.evidence.source_url, attrs]
  );

  let aliasesInserted = 0;
  let aliasesSkipped = 0;
  for (const alias of candidate.payload.proposed_aliases) {
    const result = await client.query(
      `INSERT INTO entity_alias (alias_id, entity_id, alias, alias_norm, language, alias_kind, source_type, added_by, status)
       VALUES ($1,$2,$3,$4,'en',$5,$6,$7,'active')
       ON CONFLICT (entity_id, alias_norm, language) DO NOTHING`,
      [aliasId(entityId, alias), entityId, alias, normalizeAlias(alias), alias === source.name ? "official" : "informal", source.source_adapter_id, reviewer]
    );
    if (result.rowCount === 1) aliasesInserted += 1;
    else aliasesSkipped += 1;
  }

  const pendingResult = await client.query(
    `UPDATE pending_entities
     SET status = 'resolved', resolved_entity_id = $2, reviewer = $3, reviewed_at = now()
     WHERE lower(surface) = lower($1) AND status = 'pending'`,
    [candidate.payload.surface, entityId, reviewer]
  );
  const changeId = createId("CHG");
  await client.query(
    `INSERT INTO change_records (change_id, scope_kind, scope_id, change_type, before, after, evidence_ids, caused_by)
     VALUES ($1,'entity',$2,'entity_source_import',NULL,$3,'{}',$4)`,
    [
      changeId,
      entityId,
      {
        review_id: candidate.review_id,
        source_adapter_id: source.source_adapter_id,
        external_id: source.external_id,
        aliases_inserted: aliasesInserted
      },
      reviewer
    ]
  );

  return {
    status: "applied",
    entity_id: entityId,
    aliases_inserted: aliasesInserted,
    aliases_skipped: aliasesSkipped,
    pending_entities_resolved: pendingResult.rowCount ?? 0,
    change_id: changeId
  };
}

export async function applyEntitySourceReviewCandidateTransactionally(
  store: DatabaseStore,
  candidate: EntitySourceReviewCandidate,
  reviewer: string
): Promise<EntityImportResult> {
  return store.transaction((client) => applyEntitySourceReviewCandidate(client, candidate, reviewer));
}

export async function ensureSupplierListFacilityEntity(
  client: DbTxClient,
  candidate: SupplierListReviewCandidate,
  reviewer: string
): Promise<FacilityImportResult> {
  const entityId = supplierListFacilityEntityId(candidate);
  const displayName = supplierListFacilityDisplayName(candidate);
  const aliasConflict = await findAliasConflict(client, [displayName], entityId);
  if (aliasConflict !== undefined) return { status: "blocked", reason: `facility alias already belongs to ${aliasConflict.entity_id}: ${aliasConflict.alias}` };

  const attrs = {
    entity_source: candidate.evidence.source_adapter_id,
    source_url: candidate.evidence.source_url,
    source_locator: candidate.evidence.source_locator,
    buyer_entity_id: candidate.payload.buyer_entity_id,
    buyer_name: candidate.payload.buyer_name,
    supplier_name: candidate.payload.supplier_name,
    location_text: candidate.payload.location_text,
    country_or_region: candidate.payload.country_or_region,
    normalized_record_text: candidate.evidence.normalized_record_text
  };
  const hqLocation = {
    raw_location: candidate.payload.location_text,
    country_or_region: candidate.payload.country_or_region
  };

  await client.query(
    `INSERT INTO entity_master (
       entity_id, kind, canonical_name, display_name, language_of_canonical, identifiers,
       primary_country, hq_location, industry, status, evidence_for_existence, attrs
     )
     VALUES ($1,'facility',$2,$3,'en',$4,NULL,$5,$6,'active',$7,$8)
     ON CONFLICT (entity_id) DO UPDATE SET
       canonical_name = EXCLUDED.canonical_name,
       display_name = EXCLUDED.display_name,
       identifiers = entity_master.identifiers || EXCLUDED.identifiers,
       hq_location = COALESCE(entity_master.hq_location, EXCLUDED.hq_location),
       evidence_for_existence = COALESCE(entity_master.evidence_for_existence, EXCLUDED.evidence_for_existence),
       attrs = entity_master.attrs || EXCLUDED.attrs,
       updated_at = now()`,
    [entityId, displayName, displayName, { supplystrata_facility_id: entityId }, hqLocation, ["supplier facility"], candidate.evidence.source_url, attrs]
  );

  const aliasResult = await client.query(
    `INSERT INTO entity_alias (alias_id, entity_id, alias, alias_norm, language, alias_kind, source_type, added_by, status)
     VALUES ($1,$2,$3,$4,'en','official',$5,$6,'active')
     ON CONFLICT (entity_id, alias_norm, language) DO NOTHING`,
    [aliasId(entityId, displayName), entityId, displayName, normalizeAlias(displayName), candidate.evidence.source_adapter_id, reviewer]
  );
  const aliasesInserted = aliasResult.rowCount === 1 ? 1 : 0;
  const aliasesSkipped = aliasResult.rowCount === 1 ? 0 : 1;
  const changeId = createId("CHG");
  await client.query(
    `INSERT INTO change_records (change_id, scope_kind, scope_id, change_type, before, after, evidence_ids, caused_by)
     VALUES ($1,'entity',$2,'facility_source_import',NULL,$3,'{}',$4)`,
    [
      changeId,
      entityId,
      {
        review_id: candidate.review_id,
        source_adapter_id: candidate.evidence.source_adapter_id,
        source_url: candidate.evidence.source_url,
        source_locator: candidate.evidence.source_locator,
        aliases_inserted: aliasesInserted
      },
      reviewer
    ]
  );

  return {
    status: "applied",
    entity_id: entityId,
    display_name: displayName,
    aliases_inserted: aliasesInserted,
    aliases_skipped: aliasesSkipped,
    change_id: changeId
  };
}

async function findIdentifierConflict(client: DbClient, candidate: EntitySourceReviewCandidate): Promise<string | undefined> {
  const identifiers = Object.entries(candidate.payload.candidate.identifiers).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0
  );
  for (const [key, value] of identifiers) {
    const result = await client.query<EntityIdRow>(
      `SELECT entity_id
       FROM entity_master
       WHERE identifiers ->> $1 = $2
       LIMIT 1`,
      [key, value]
    );
    const row = result.rows[0];
    if (row !== undefined) return row.entity_id;
  }
  return undefined;
}

async function findAliasConflict(
  client: DbClient,
  aliases: readonly string[],
  targetEntityId: string
): Promise<{ entity_id: string; alias: string } | undefined> {
  for (const alias of aliases) {
    const result = await client.query<EntityIdRow>(
      `SELECT entity_id
       FROM entity_alias
       WHERE alias_norm = $1 AND status = 'active' AND entity_id <> $2
       LIMIT 1`,
      [normalizeAlias(alias), targetEntityId]
    );
    const row = result.rows[0];
    if (row !== undefined) return { entity_id: row.entity_id, alias };
  }
  return undefined;
}

export async function countResolvablePendingEntities(client: DbClient): Promise<number> {
  const result = await client.query<CountRow>(
    `SELECT count(*)::text AS count
     FROM pending_entities p
     JOIN entity_alias a ON a.alias_norm = lower(p.surface) AND a.status = 'active'
     WHERE p.status = 'pending'`
  );
  return Number.parseInt(result.rows[0]?.count ?? "0", 10);
}

export async function resolvePendingEntitySurface(client: DbTxClient, input: { surface: string; entityId: string; reviewer: string }): Promise<number> {
  // 种子实体或人工导入实体被解析后，同步关闭相同 surface 的待处理项。
  const result = await client.query(
    `UPDATE pending_entities
     SET status = 'resolved', resolved_entity_id = $2, reviewer = $3, reviewed_at = now()
     WHERE lower(surface) = lower($1) AND status = 'pending'`,
    [input.surface, input.entityId, input.reviewer]
  );
  return result.rowCount ?? 0;
}

function countryFromJurisdiction(jurisdiction: string | undefined): string | null {
  if (jurisdiction === undefined) return null;
  const normalized = jurisdiction.toUpperCase();
  if (normalized === "GB") return "GB";
  if (normalized.startsWith("US")) return "US";
  return normalized.length === 2 ? normalized : null;
}

function aliasId(entityId: string, alias: string): string {
  const digest = createHash("sha256")
    .update(`${entityId}|${normalizeAlias(alias)}`)
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();
  return `ALIAS-${entityId}-${digest}`.slice(0, 128);
}
