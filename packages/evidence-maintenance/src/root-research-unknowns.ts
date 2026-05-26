import { createHash } from "node:crypto";
import type { DbClient } from "@supplystrata/db/read";
import { upsertUnknownItem, type DbTxClient } from "@supplystrata/db/write";
import type { RootResearchCoverageCountRow, RootResearchCoverageEntityRow } from "./db-rows.js";

export interface MaterializeRootResearchUnknownsInput {
  company_ids: readonly string[];
  min_evidence_level?: 4 | 5;
  generated_by?: string;
}

export interface MaterializeRootResearchUnknownsSummary {
  companies_considered: number;
  companies_checked: number;
  companies_with_l4_l5_edges: number;
  companies_with_open_unknown: number;
  unknowns_inserted: number;
  unknowns_updated: number;
  skipped_company_ids: string[];
  generated_by: string;
}

interface RootResearchCoverageCandidate {
  company_id: string;
  display_name: string;
  l4_l5_edge_count: number;
  open_unknown_count: number;
}

export async function materializeRootResearchUnknowns(
  client: DbTxClient,
  input: MaterializeRootResearchUnknownsInput
): Promise<MaterializeRootResearchUnknownsSummary> {
  const generatedBy = input.generated_by ?? "evidence-maintenance.root-research-unknowns.v1";
  const minEvidenceLevel = input.min_evidence_level ?? 4;
  const companyIds = uniqueSorted(input.company_ids);
  const entities = await listExistingEntities(client, companyIds);
  const skippedCompanyIds = companyIds.filter((companyId) => !entities.has(companyId));

  let companiesWithL4L5Edges = 0;
  let companiesWithOpenUnknown = 0;
  let inserted = 0;
  let updated = 0;

  for (const [companyId, displayName] of entities.entries()) {
    const candidate: RootResearchCoverageCandidate = {
      company_id: companyId,
      display_name: displayName,
      l4_l5_edge_count: await countCurrentL4L5Edges(client, companyId, minEvidenceLevel),
      open_unknown_count: await countOpenCompanyUnknowns(client, companyId)
    };
    if (candidate.l4_l5_edge_count > 0) {
      companiesWithL4L5Edges += 1;
      continue;
    }
    if (candidate.open_unknown_count > 0) {
      companiesWithOpenUnknown += 1;
      continue;
    }

    const result = await upsertUnknownItem(client, rootResearchCoverageUnknown(candidate, generatedBy));
    if (result.inserted) {
      inserted += 1;
    } else {
      updated += 1;
    }
  }

  return {
    companies_considered: companyIds.length,
    companies_checked: entities.size,
    companies_with_l4_l5_edges: companiesWithL4L5Edges,
    companies_with_open_unknown: companiesWithOpenUnknown,
    unknowns_inserted: inserted,
    unknowns_updated: updated,
    skipped_company_ids: skippedCompanyIds,
    generated_by: generatedBy
  };
}

async function listExistingEntities(client: DbClient, companyIds: readonly string[]): Promise<Map<string, string>> {
  if (companyIds.length === 0) return new Map();
  const result = await client.query<RootResearchCoverageEntityRow>(
    `SELECT entity_id, display_name
     FROM entity_master
     WHERE entity_id = ANY($1::text[])
     ORDER BY entity_id`,
    [companyIds]
  );
  return new Map(result.rows.map((row) => [row.entity_id, row.display_name]));
}

async function countCurrentL4L5Edges(client: DbClient, companyId: string, minEvidenceLevel: 4 | 5): Promise<number> {
  const result = await client.query<RootResearchCoverageCountRow>(
    `SELECT count(*)::text AS count
     FROM edges
     WHERE validity = 'current'
       AND evidence_level >= $2
       AND is_inferred = false
       AND (subject_id = $1 OR object_id = $1)`,
    [companyId, minEvidenceLevel]
  );
  return Number.parseInt(result.rows[0]?.count ?? "0", 10);
}

async function countOpenCompanyUnknowns(client: DbClient, companyId: string): Promise<number> {
  const result = await client.query<RootResearchCoverageCountRow>(
    `SELECT count(*)::text AS count
     FROM unknown_items
     WHERE scope_kind = 'company'
       AND scope_id = $1
       AND status = 'open'`,
    [companyId]
  );
  return Number.parseInt(result.rows[0]?.count ?? "0", 10);
}

function rootResearchCoverageUnknown(candidate: RootResearchCoverageCandidate, createdBy: string) {
  return {
    unknown_id: deterministicRootResearchUnknownId(candidate.company_id),
    scope_kind: "company",
    scope_id: candidate.company_id,
    question: `Which official disclosures establish ${possessive(candidate.display_name)} Gate 1 AI compute supply-chain relationships?`,
    why_unknown:
      "This company is in the recursive Gate 1 research scope, but the current truth store has no reviewed Level 4/5 fact edges touching the entity. The boundary must stay explicit until official evidence is reviewed.",
    blocking_data_sources: [
      "company official disclosure or regulatory filing",
      "counterparty official disclosure",
      "reviewed supplier list or official relationship evidence"
    ],
    proxies: [
      "official source target coverage",
      "official signal review disposition",
      "financial or operational observations that remain outside the fact layer"
    ],
    created_by: createdBy
  };
}

export function deterministicRootResearchUnknownId(companyId: string): string {
  const digest = createHash("sha256").update(`gate1-root-research-coverage:${companyId}`).digest("hex").slice(0, 16).toUpperCase();
  return `UNK-GATE1-ROOT-COVERAGE-${digest}`;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))].sort();
}

function possessive(value: string): string {
  return value.endsWith("s") ? `${value}'` : `${value}'s`;
}
