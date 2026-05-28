import { normalizeAlias } from "@supplystrata/core";

export type EntitySourceAdapterId = "gleif" | "openfigi" | "opencorporates" | "companies-house";

export interface EntitySourceIdentifierSet {
  lei?: string;
  gleif_lei?: string;
  bic?: string;
  spglobal_id?: string;
  open_corporates_id?: string;
  companies_house_number?: string;
  company_number?: string;
  jurisdiction_code?: string;
  registration_authority_id?: string;
  registration_authority_entity_id?: string;
  figi?: string;
  openfigi_figi?: string;
  openfigi_composite_figi?: string;
  openfigi_share_class_figi?: string;
  ticker?: string;
  exchange_code?: string;
}

export interface EntitySourceCandidate {
  source_adapter_id: EntitySourceAdapterId;
  source_url: string;
  external_id: string;
  name: string;
  name_norm: string;
  jurisdiction_code?: string;
  company_number?: string;
  current_status?: string;
  company_type?: string;
  incorporation_date?: string;
  registered_address?: string;
  previous_names: string[];
  alternative_names: string[];
  identifiers: EntitySourceIdentifierSet;
  confidence: number;
  provenance_note: string;
}

export interface EntitySourceLookupResult {
  source_adapter_id: EntitySourceAdapterId;
  source_url?: string;
  candidates: EntitySourceCandidate[];
  error_message?: string;
}

export function createEntitySourceCandidate(input: Omit<EntitySourceCandidate, "name_norm">): EntitySourceCandidate {
  return {
    ...input,
    name_norm: normalizeAlias(input.name),
    previous_names: uniqueNonEmptyStrings(input.previous_names),
    alternative_names: uniqueNonEmptyStrings(input.alternative_names)
  };
}

export function candidateAliases(candidate: EntitySourceCandidate): string[] {
  return uniqueNonEmptyStrings([candidate.name, ...candidate.previous_names, ...candidate.alternative_names]);
}

function uniqueNonEmptyStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = value.normalize("NFKC").trim().replace(/\s+/g, " ");
    if (cleaned.length === 0) continue;
    const key = normalizeAlias(cleaned);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}
