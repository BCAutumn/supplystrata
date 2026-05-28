import { createHash } from "node:crypto";
import { normalizeAlias } from "@supplystrata/core";
import type { DbClient, DbTxClient } from "@supplystrata/db/write";

export interface SecListedCompanyCandidate {
  cik: string;
  ticker: string;
  title: string;
  display_name: string;
  entity_id: string;
  source_url: string;
}

export type SecListedCompanyImportResult =
  | { status: "applied"; entity_id: string; aliases_inserted: number; aliases_skipped: number; change_id: string }
  | { status: "blocked"; reason: string };

interface EntityIdRow {
  entity_id: string;
}

type ExistingListedCompanyLookup = { status: "found"; entity_id: string } | { status: "not_found" } | { status: "ambiguous"; entity_ids: readonly string[] };

export async function ensureSecListedCompanyEntity(
  client: DbTxClient,
  candidate: SecListedCompanyCandidate,
  reviewer: string
): Promise<SecListedCompanyImportResult> {
  const existing = await findExistingListedCompanyEntity(client, candidate);
  if (existing.status === "ambiguous")
    return { status: "blocked", reason: `SEC listed-company identifiers already match multiple entities: ${existing.entity_ids.join(", ")}` };
  const entityId = existing.status === "found" ? existing.entity_id : await availableEntityId(client, candidate);
  const attrs = {
    entity_source: "sec-edgar",
    source_url: candidate.source_url,
    sec_company_directory: true
  };
  const identifiers = {
    cik: candidate.cik,
    ticker: [`${candidate.ticker}:US`],
    sec_ticker: candidate.ticker
  };

  await client.query(
    `INSERT INTO entity_master (
       entity_id, kind, canonical_name, display_name, language_of_canonical,
       identifiers, primary_country, industry, status, evidence_for_existence, attrs
     )
     VALUES ($1,'company',$2,$3,'en',$4,'US',$5,'active',$6,$7)
     ON CONFLICT (entity_id) DO UPDATE SET
       canonical_name = EXCLUDED.canonical_name,
       display_name = EXCLUDED.display_name,
       identifiers = entity_master.identifiers || EXCLUDED.identifiers,
       primary_country = COALESCE(entity_master.primary_country, EXCLUDED.primary_country),
       evidence_for_existence = COALESCE(entity_master.evidence_for_existence, EXCLUDED.evidence_for_existence),
       attrs = entity_master.attrs || EXCLUDED.attrs,
       updated_at = now()`,
    [entityId, candidate.title, candidate.display_name, identifiers, ["public-company"], candidate.source_url, attrs]
  );

  let aliasesInserted = 0;
  let aliasesSkipped = 0;
  for (const alias of secListedCompanyAliases(candidate)) {
    const result = await client.query(
      `INSERT INTO entity_alias (alias_id, entity_id, alias, alias_norm, language, alias_kind, source_type, added_by, status)
       VALUES ($1,$2,$3,$4,'en',$5,'sec-edgar',$6,'active')
       ON CONFLICT (entity_id, alias_norm, language) DO NOTHING`,
      [aliasId(entityId, alias.value), entityId, alias.value, normalizeAlias(alias.value), alias.kind, reviewer]
    );
    if (result.rowCount === 1) aliasesInserted += 1;
    else aliasesSkipped += 1;
  }

  const changeId = `CHG-SEC-ENTITY-${createHash("sha256").update(`${entityId}|${candidate.cik}|${candidate.ticker}`).digest("hex").slice(0, 16).toUpperCase()}`;
  await client.query(
    `INSERT INTO change_records (change_id, scope_kind, scope_id, change_type, before, after, evidence_ids, caused_by)
     VALUES ($1,'entity',$2,'sec_listed_company_bootstrap',NULL,$3,'{}',$4)
     ON CONFLICT (change_id) DO NOTHING`,
    [
      changeId,
      entityId,
      {
        source_adapter_id: "sec-edgar",
        source_url: candidate.source_url,
        cik: candidate.cik,
        ticker: candidate.ticker,
        title: candidate.title,
        aliases_inserted: aliasesInserted
      },
      reviewer
    ]
  );

  return { status: "applied", entity_id: entityId, aliases_inserted: aliasesInserted, aliases_skipped: aliasesSkipped, change_id: changeId };
}

async function findExistingListedCompanyEntity(client: DbClient, candidate: SecListedCompanyCandidate): Promise<ExistingListedCompanyLookup> {
  const result = await client.query<EntityIdRow>(
    `SELECT entity_id
     FROM entity_master
     WHERE status = 'active'
       AND (
         identifiers->>'cik' = $1
         OR identifiers->>'sec_ticker' = $2
         OR EXISTS (
           SELECT 1
           FROM jsonb_array_elements_text(identifiers->'ticker') ticker(value)
           WHERE lower(ticker.value) = lower($2)
              OR lower(ticker.value) = lower($3)
              OR lower(split_part(ticker.value, ':', 1)) = lower($2)
         )
       )
     LIMIT 2`,
    [candidate.cik, candidate.ticker, `${candidate.ticker}:US`]
  );
  if (result.rows.length === 0) return { status: "not_found" };
  if (result.rows.length > 1) return { status: "ambiguous", entity_ids: result.rows.map((row) => row.entity_id).sort() };
  const row = result.rows[0];
  return row === undefined ? { status: "not_found" } : { status: "found", entity_id: row.entity_id };
}

async function availableEntityId(client: DbClient, candidate: SecListedCompanyCandidate): Promise<string> {
  const existing = await client.query<EntityIdRow>("SELECT entity_id FROM entity_master WHERE lower(entity_id) = lower($1) LIMIT 1", [candidate.entity_id]);
  if (existing.rows[0] === undefined) return candidate.entity_id;
  return `ENT-SEC-${candidate.ticker}-${candidate.cik.slice(-6)}`;
}

function secListedCompanyAliases(candidate: SecListedCompanyCandidate): Array<{ value: string; kind: "official" | "abbreviation" }> {
  const aliases = [
    { value: candidate.title, kind: "official" as const },
    { value: candidate.display_name, kind: "official" as const },
    { value: candidate.ticker, kind: "abbreviation" as const },
    { value: `${candidate.ticker}:US`, kind: "abbreviation" as const },
    { value: candidate.entity_id, kind: "abbreviation" as const }
  ];
  const seen = new Set<string>();
  const result: Array<{ value: string; kind: "official" | "abbreviation" }> = [];
  for (const alias of aliases) {
    const key = normalizeAlias(alias.value);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    result.push(alias);
  }
  return result;
}

function aliasId(entityId: string, alias: string): string {
  const digest = createHash("sha256")
    .update(`${entityId}|${normalizeAlias(alias)}`)
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
  return `ALIAS-${digest}`;
}
