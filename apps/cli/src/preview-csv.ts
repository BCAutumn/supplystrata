import type { AppleSuppliersPreview } from "@supplystrata/source-workflows";

export function renderAppleSupplierCandidatesCsv(result: AppleSuppliersPreview): string {
  const header = [
    "supplier_name",
    "buyer_entity_id",
    "buyer_name",
    "location_text",
    "country_or_region",
    "source_row_text",
    "normalized_record_text",
    "relation_hint",
    "facility_relation_hint",
    "source_adapter_id",
    "source_fiscal_year",
    "source_locator",
    "confidence",
    "needs_review",
    "review_reason",
    "source_url",
    "doc_id"
  ];
  const rows = result.candidates.map((candidate) => [
    candidate.supplier_name,
    candidate.buyer_entity_id,
    candidate.buyer_name,
    candidate.location_text,
    candidate.country_or_region,
    candidate.source_row_text,
    candidate.normalized_record_text,
    candidate.relation_hint,
    candidate.facility_relation_hint,
    candidate.source_adapter_id,
    String(candidate.source_fiscal_year),
    candidate.source_locator,
    candidate.confidence.toFixed(2),
    String(candidate.needs_review),
    candidate.review_reason,
    result.fetched_url,
    result.doc_id
  ]);
  return [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
}

function csvEscape(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}
