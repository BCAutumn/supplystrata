import type { DbClient } from "@supplystrata/db/read";
import type { SourcePlanItem } from "@supplystrata/source-plan";
import type { OfficialSignalDispositionDbRow, ReviewCandidateDbRow } from "./db-rows.js";
import type { OfficialSignalDispositionDtoSource, ReviewCandidateDtoSource } from "./dto-source-records.js";
import type {
  WorkbenchEvidence,
  WorkbenchOfficialDisclosureSignalDisposition,
  WorkbenchOfficialDisclosureSignalDispositionDecision,
  WorkbenchReviewCandidate,
  WorkbenchReviewCandidateSignal
} from "./definitions.js";

export async function loadWorkbenchReviewQueue(
  client: DbClient,
  input: { sourceAdapterIds: readonly string[]; limit: number }
): Promise<WorkbenchReviewCandidate[]> {
  const sourceAdapterIds = uniqueStrings(input.sourceAdapterIds);
  if (sourceAdapterIds.length === 0) return [];
  const result = await client.query<ReviewCandidateDbRow>(
    `SELECT review_id,
            kind,
            status,
            candidate->>'title' AS title,
            candidate->>'confidence' AS confidence,
            source_adapter_id,
            doc_id,
            candidate #>> '{evidence,source_url}' AS source_url,
            candidate #>> '{evidence,source_locator}' AS source_locator,
            candidate #>> '{evidence,source_row_text}' AS source_row_text,
            candidate #>> '{payload,signal_title}' AS signal_title,
            candidate #>> '{payload,evidence_level_hint}' AS signal_evidence_level_hint,
            candidate #>> '{payload,fact_write_policy,automatic_fact_mutation_allowed}' AS signal_automatic_fact_mutation_allowed,
            reviewed_at,
            decision_reason,
            created_at
     FROM review_candidates
     WHERE source_adapter_id = ANY($1::text[])
       AND status IN ('pending','in_review','approved','blocked')
     ORDER BY CASE WHEN kind = 'official_disclosure_signal' THEN 0 ELSE 1 END, created_at DESC, review_id
     LIMIT $2`,
    [sourceAdapterIds, input.limit]
  );
  const candidates = result.rows.map(reviewCandidateToDto);
  const dispositions = await loadOfficialDisclosureSignalDispositions(client, {
    reviewIds: candidates.filter((candidate) => candidate.kind === "official_disclosure_signal").map((candidate) => candidate.review_id)
  });
  const dispositionsByReviewId = groupDispositionsByReviewId(dispositions);
  return candidates.map((candidate) => ({
    ...candidate,
    dispositions: dispositionsByReviewId.get(candidate.review_id) ?? []
  }));
}

export function reviewQueueSourceAdapterIds(input: { evidences: readonly WorkbenchEvidence[]; sourcePlan: readonly SourcePlanItem[] }): string[] {
  return uniqueStrings([
    ...input.evidences.map((evidence) => evidence.source_adapter_id),
    ...input.sourcePlan.map((item) => item.source_id),
    ...input.sourcePlan.flatMap((item) => item.suggested_check_targets.map((target) => target.source_adapter_id))
  ]);
}

async function loadOfficialDisclosureSignalDispositions(
  client: DbClient,
  input: { reviewIds: readonly string[] }
): Promise<WorkbenchOfficialDisclosureSignalDisposition[]> {
  const reviewIds = uniqueStrings(input.reviewIds);
  if (reviewIds.length === 0) return [];
  const result = await client.query<OfficialSignalDispositionDbRow>(
    `SELECT change_id, scope_id AS review_id, after, caused_by, detected_at
     FROM change_records
     WHERE change_type = 'OFFICIAL_DISCLOSURE_SIGNAL_DISPOSITION_RECORDED'
       AND scope_kind = 'review'
       AND scope_id = ANY($1::text[])
     ORDER BY detected_at DESC, change_id DESC`,
    [reviewIds]
  );
  return result.rows.map(officialSignalDispositionToDto);
}

function officialSignalDispositionToDto(row: OfficialSignalDispositionDtoSource): WorkbenchOfficialDisclosureSignalDisposition {
  const after = row.after;
  if (after === null) throw new Error(`Official signal disposition change is missing payload: ${row.change_id}`);
  const policy = recordField(after, "fact_write_policy", row.change_id);
  if (policy["automatic_fact_mutation_allowed"] !== false || policy["allowed_edge_mutation"] !== "none" || policy["requires_human_review"] !== true)
    throw new Error(`Official signal disposition cannot authorize fact mutation: ${row.change_id}`);
  return {
    change_id: row.change_id,
    review_id: textField(after, "review_id", row.review_id),
    edge_id: textField(after, "edge_id", row.review_id),
    decision: dispositionDecision(textField(after, "decision", row.review_id), row.change_id),
    reviewer: textField(after, "reviewer", row.caused_by),
    reason: textField(after, "reason", row.change_id),
    source_adapter_id: textField(after, "source_adapter_id", row.change_id),
    doc_id: nullableTextField(after, "doc_id", row.change_id),
    signal_title: textField(after, "signal_title", row.change_id),
    evidence_id: nullableTextField(after, "evidence_id", row.change_id),
    unknown_id: nullableTextField(after, "unknown_id", row.change_id),
    check_target_id: nullableTextField(after, "check_target_id", row.change_id),
    recorded_at: textField(after, "recorded_at", toIsoString(row.detected_at)),
    fact_write_policy: {
      automatic_fact_mutation_allowed: false,
      allowed_edge_mutation: "none",
      requires_human_review: true
    }
  };
}

function dispositionDecision(value: string, changeId: string): WorkbenchOfficialDisclosureSignalDispositionDecision {
  if (
    value === "supports_existing_edge" ||
    value === "needs_more_evidence" ||
    value === "not_relevant" ||
    value === "record_single_source_unknown" ||
    value === "create_counterparty_source_target"
  ) {
    return value;
  }
  throw new Error(`Invalid official signal disposition decision for ${changeId}: ${value}`);
}

function reviewCandidateToDto(row: ReviewCandidateDtoSource): WorkbenchReviewCandidate {
  return {
    review_id: row.review_id,
    kind: row.kind,
    status: row.status,
    title: requiredText(row.title, row.review_id, "title"),
    confidence: parseReviewCandidateNumber(row.confidence, row.review_id, "confidence"),
    source_adapter_id: row.source_adapter_id,
    doc_id: row.doc_id,
    source_url: requiredText(row.source_url, row.review_id, "source_url"),
    source_locator: requiredText(row.source_locator, row.review_id, "source_locator"),
    source_row_text: requiredText(row.source_row_text, row.review_id, "source_row_text"),
    created_at: toIsoString(row.created_at),
    reviewed_at: toNullableIsoString(row.reviewed_at),
    decision_reason: row.decision_reason,
    signal: reviewCandidateSignalToDto(row),
    dispositions: []
  };
}

function reviewCandidateSignalToDto(row: ReviewCandidateDtoSource): WorkbenchReviewCandidateSignal | null {
  if (row.kind !== "official_disclosure_signal") return null;
  return {
    signal_title: requiredText(row.signal_title, row.review_id, "signal_title"),
    evidence_level_hint: parseReviewCandidateNumber(row.signal_evidence_level_hint, row.review_id, "evidence_level_hint"),
    automatic_fact_mutation_allowed: row.signal_automatic_fact_mutation_allowed === "true"
  };
}

function groupDispositionsByReviewId(
  dispositions: readonly WorkbenchOfficialDisclosureSignalDisposition[]
): Map<string, WorkbenchOfficialDisclosureSignalDisposition[]> {
  const byId = new Map<string, WorkbenchOfficialDisclosureSignalDisposition[]>();
  for (const disposition of dispositions) {
    const existing = byId.get(disposition.review_id) ?? [];
    byId.set(disposition.review_id, [...existing, disposition]);
  }
  return byId;
}

function recordField(record: Record<string, unknown>, key: string, context: string): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) throw new Error(`Expected object field ${key} in ${context}`);
  return value;
}

function textField(record: Record<string, unknown>, key: string, context: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`Expected non-empty string field ${key} in ${context}`);
  return value;
}

function nullableTextField(record: Record<string, unknown>, key: string, context: string): string | null {
  const value = record[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`Expected nullable string field ${key} in ${context}`);
  return value;
}

function requiredText(value: string | null, reviewId: string, field: string): string {
  if (value === null || value.trim().length === 0) throw new Error(`Review candidate ${reviewId} is missing ${field}`);
  return value;
}

function parseReviewCandidateNumber(value: string | null, reviewId: string, field: string): number {
  const parsed = value === null ? Number.NaN : Number.parseFloat(value);
  if (!Number.isFinite(parsed)) throw new Error(`Review candidate ${reviewId} has invalid ${field}`);
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNullableIsoString(value: Date | string | null): string | null {
  return value === null ? null : toIsoString(value);
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
