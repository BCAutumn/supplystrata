import {
  isClaimConflictReviewCandidate,
  isEntitySourceReviewCandidate,
  isOshFacilityReviewCandidate,
  isSemanticChangeReviewCandidate,
  isSupplierListReviewCandidate
} from "@supplystrata/review-candidates";
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
  if (isSemanticChangeReviewCandidate(candidate)) appendSemanticChangeCandidate(lines, candidate);
  if (isOshFacilityReviewCandidate(candidate)) appendOshFacilityCandidate(lines, candidate);
  if (isClaimConflictReviewCandidate(candidate)) appendClaimConflictCandidate(lines, candidate);
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
    `Applied review items: ${summary.applied}`,
    `Applied edges: ${summary.applied_edges}`,
    `Imported entities: ${summary.entity_applied}`,
    `Acknowledged semantic changes: ${summary.acknowledged}`,
    `Blocked: ${summary.blocked}`,
    `Errors: ${summary.errors}`
  ];
  if (summary.results.length > 0) {
    lines.push("", "## Results", "");
    for (const result of summary.results) {
      if (result.status === "applied") {
        const edges = result.apply_results.map((item) => `${item.role}:${item.edge_id}/${item.relation}/${item.graph_sync.status}`).join(", ");
        lines.push(`- ${result.review_id}: applied ${result.apply_results.length} edges (${edges}); facility ${result.facility_import.entity_id}`);
      } else if (result.status === "entity_applied") lines.push(`- ${result.review_id}: imported entity ${result.import_result.entity_id}`);
      else if (result.status === "acknowledged" && result.kind === "semantic_change")
        lines.push(`- ${result.review_id}: acknowledged ${result.kind}; draft ${result.claim_id}`);
      else if (result.status === "acknowledged") lines.push(`- ${result.review_id}: acknowledged ${result.kind}; ${result.reason}`);
      else lines.push(`- ${result.review_id}: ${result.status} - ${result.reason}`);
    }
  }
  return lines.join("\n");
}

function appendSemanticChangeCandidate(lines: string[], candidate: Extract<ReviewQueueItem["candidate"], { kind: "semantic_change" }>): void {
  lines.push(
    "",
    "## Semantic Change",
    "",
    `- Change: ${candidate.payload.change_type}`,
    `- Kind: ${candidate.payload.semantic_relation_kind}`,
    `- Relation: ${candidate.payload.subject_surface} -${candidate.payload.relation}-> ${candidate.payload.object_surface}`,
    `- Component: ${candidate.payload.component ?? candidate.payload.component_id ?? "unknown"}`,
    "",
    "## Evidence Context",
    "",
    `Source: ${candidate.evidence.source_adapter_id}`,
    `URL: ${candidate.evidence.source_url}`,
    `Locator: ${candidate.evidence.source_locator}`,
    `Text: ${candidate.evidence.source_row_text}`,
    `Fingerprint: ${candidate.payload.fingerprint}`
  );
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

function appendOshFacilityCandidate(lines: string[], candidate: Extract<ReviewQueueItem["candidate"], { kind: "osh_facility_candidate" }>): void {
  const facility = candidate.payload.osh_candidate;
  lines.push(
    "",
    "## OSH Facility Candidate",
    "",
    `- Query: ${candidate.payload.query}`,
    `- Facility: ${facility.name}`,
    `- OS ID: ${facility.os_id}`,
    `- Address: ${facility.address ?? "unknown"}`,
    `- Country: ${facility.country_name ?? facility.country_code ?? "unknown"}`,
    `- Source lead: ${candidate.payload.source_lead_id ?? "none"}`,
    `- Observation: ${candidate.payload.observation_id}`,
    "",
    "## Evidence Context",
    "",
    `Source: ${candidate.evidence.source_adapter_id}`,
    `URL: ${candidate.evidence.source_url}`,
    `Locator: ${candidate.evidence.source_locator}`,
    `Raw row: ${candidate.evidence.source_row_text}`
  );
}

function appendClaimConflictCandidate(lines: string[], candidate: Extract<ReviewQueueItem["candidate"], { kind: "claim_conflict_review" }>): void {
  lines.push(
    "",
    "## Claim Conflict",
    "",
    `- Claim: ${candidate.payload.claim_id}`,
    `- Edge: ${candidate.payload.edge_id ?? "none"}`,
    `- State: ${candidate.payload.conflict_state}`,
    `- Severity: ${candidate.payload.severity}`,
    `- Recommended action: ${candidate.payload.recommended_action}`,
    `- Safe-write status: ${candidate.payload.safe_write_status}`,
    `- Auto fact mutation: ${candidate.payload.fact_write_policy.automatic_fact_mutation_allowed}`,
    `- Review steps: ${candidate.payload.required_review_steps.join("; ")}`,
    `- Evidence refs: ${candidate.payload.evidence_refs.map((ref) => `${ref.role}:${ref.evidence_id}`).join("; ")}`,
    `- Unknown refs: ${candidate.payload.unknown_refs.map((ref) => `${ref.role}:${ref.status}:${ref.unknown_id}`).join("; ")}`,
    "",
    "## Evidence Context",
    "",
    `Source: ${candidate.evidence.source_adapter_id}`,
    `Locator: ${candidate.evidence.source_locator}`,
    `Claim text: ${candidate.payload.claim_text}`
  );
}
