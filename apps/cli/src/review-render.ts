import { isEntitySourceReviewCandidate, isSupplierListReviewCandidate } from "@supplystrata/review-candidates";
import type { ReviewApplyBatchSummary } from "@supplystrata/pipeline";
import type { ReviewQueueItem } from "@supplystrata/review-store";
import type { OutputFormat } from "@supplystrata/render";

export function renderReviewItemOrEmpty(item: ReviewQueueItem | undefined, format: OutputFormat): string {
  if (item === undefined) {
    return format === "json" ? JSON.stringify({ schema_version: "1.0.0", review: null }, null, 2) : "No pending review candidates.";
  }
  if (format === "json") return JSON.stringify({ schema_version: "1.0.0", review: item }, null, 2);
  const candidate = item.candidate;
  const lines = [
    "# Review Candidate",
    "",
    `ID: ${item.review_id}`,
    `Kind: ${item.kind}`,
    `Status: ${item.status}`,
    `Title: ${candidate.title}`,
    `Confidence: ${candidate.confidence.toFixed(2)}`
  ];
  if (isSupplierListReviewCandidate(candidate)) appendSupplierListCandidate(lines, candidate);
  if (isEntitySourceReviewCandidate(candidate)) appendEntitySourceCandidate(lines, candidate);
  lines.push("", "## Review Note", "", candidate.review_reason);
  if (item.reviewer !== undefined) lines.push("", `Reviewer: ${item.reviewer}`);
  if (item.decision_reason !== undefined) lines.push(`Decision reason: ${item.decision_reason}`);
  return lines.join("\n");
}

export function renderReviewApplyBatch(summary: ReviewApplyBatchSummary, format: OutputFormat): string {
  if (format === "json") return JSON.stringify({ schema_version: "1.0.0", ok: summary.errors === 0, summary }, null, 2);
  const lines = [
    "# Review Apply Batch",
    "",
    `Requested limit: ${summary.requested_limit}`,
    `Scanned approved candidates: ${summary.scanned}`,
    `Applied edges: ${summary.applied}`,
    `Imported entities: ${summary.entity_applied}`,
    `Blocked: ${summary.blocked}`,
    `Errors: ${summary.errors}`
  ];
  if (summary.results.length > 0) {
    lines.push("", "## Results", "");
    for (const result of summary.results) {
      if (result.status === "applied") lines.push(`- ${result.review_id}: applied edge ${result.apply_result.edge_id} (${result.apply_result.graph_sync.status})`);
      else if (result.status === "entity_applied") lines.push(`- ${result.review_id}: imported entity ${result.import_result.entity_id}`);
      else lines.push(`- ${result.review_id}: ${result.status} - ${result.reason}`);
    }
  }
  return lines.join("\n");
}

function appendSupplierListCandidate(lines: string[], candidate: Extract<ReviewQueueItem["candidate"], { kind: "supplier_list_row" }>): void {
  lines.push(
    "",
    "## Proposed Relation",
    "",
    `- ${candidate.payload.buyer_name} [${candidate.payload.buyer_entity_id}] -${candidate.payload.relation_hint}-> ${candidate.payload.supplier_name}`,
    `- Facility hint: supplier -${candidate.payload.facility_relation_hint}-> ${candidate.payload.location_text}, ${candidate.payload.country_or_region}`,
    "",
    "## Evidence Context",
    "",
    `Source: ${candidate.evidence.source_adapter_id}`,
    `URL: ${candidate.evidence.source_url}`,
    `Locator: ${candidate.evidence.source_locator}`,
    `Raw row: ${candidate.evidence.source_row_text}`,
    `Normalized: ${candidate.evidence.normalized_record_text}`
  );
}

function appendEntitySourceCandidate(lines: string[], candidate: Extract<ReviewQueueItem["candidate"], { kind: "entity_source_candidate" }>): void {
  const source = candidate.payload.candidate;
  lines.push(
    "",
    "## Proposed Entity Import",
    "",
    `- Surface: ${candidate.payload.surface}`,
    `- Proposed entity: ${candidate.payload.proposed_entity_id}`,
    `- Registry name: ${source.name}`,
    `- External ID: ${source.external_id}`,
    `- Jurisdiction: ${source.jurisdiction_code ?? "unknown"}`,
    `- Status: ${source.current_status ?? "unknown"}`,
    `- Aliases: ${candidate.payload.proposed_aliases.join("; ")}`,
    "",
    "## Evidence Context",
    "",
    `Source: ${candidate.evidence.source_adapter_id}`,
    `URL: ${candidate.evidence.source_url}`,
    `Locator: ${candidate.evidence.source_locator}`,
    `Raw row: ${candidate.evidence.source_row_text}`,
    `Normalized: ${candidate.evidence.normalized_record_text}`
  );
}
