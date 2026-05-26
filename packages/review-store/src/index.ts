import { recordSemanticChange, type DatabaseStore, type DbClient, type DbTxClient } from "@supplystrata/db/write";
import {
  isOfficialDisclosureSignalReviewCandidate,
  isReviewCandidate,
  isReviewOnlyFactWritePolicy,
  reviewOnlyFactWritePolicy,
  type ReviewCandidate,
  type ReviewCandidateKind,
  type ReviewCandidateStatus,
  type ReviewOnlyFactWritePolicy
} from "@supplystrata/review-candidates";
import type { EntityAffiliationDispositionRow, OfficialDisclosureSignalDispositionRow, ReviewCandidateRow, ReviewStatsRow } from "./db-rows.js";

export * from "./edge-corroboration-disposition.js";

interface ReviewCandidateEnqueueInputRow {
  review_id: string;
  candidate_key: string;
  kind: ReviewCandidateKind;
  candidate: ReviewCandidate;
  doc_id: string | null;
  source_adapter_id: string;
}

interface ReviewCandidateEnqueueResultRow {
  inserted: string;
  total: string;
}

export interface ReviewQueueItem {
  review_id: string;
  candidate_key: string;
  kind: ReviewCandidateKind;
  status: ReviewCandidateStatus;
  candidate: ReviewCandidate;
  reviewer?: string;
  reviewed_at?: string;
  decision_reason?: string;
  created_at: string;
}

export interface ReviewStats {
  pending: number;
  in_review: number;
  approved: number;
  rejected: number;
  blocked: number;
  applied: number;
  total: number;
}

type ReviewStatsCountKey = Exclude<keyof ReviewStats, "total">;

const REVIEW_STATS_COUNT_KEYS: Record<ReviewCandidateStatus, ReviewStatsCountKey> = {
  pending: "pending",
  in_review: "in_review",
  approved: "approved",
  rejected: "rejected",
  blocked: "blocked",
  applied: "applied"
};

export type OfficialDisclosureSignalDispositionDecision =
  | "supports_existing_edge"
  | "needs_more_evidence"
  | "not_relevant"
  | "record_single_source_unknown"
  | "create_counterparty_source_target";

export interface OfficialDisclosureSignalDispositionInput {
  reviewId: string;
  edgeId: string;
  decision: OfficialDisclosureSignalDispositionDecision;
  reviewer: string;
  reason: string;
  evidenceId?: string;
  unknownId?: string;
  checkTargetId?: string;
  recordedAt: string;
}

export interface OfficialDisclosureSignalDispositionRecord {
  change_id: string;
  review_id: string;
  edge_id: string;
  decision: OfficialDisclosureSignalDispositionDecision;
  reviewer: string;
  reason: string;
  source_adapter_id: string;
  doc_id: string | null;
  signal_title: string;
  evidence_id: string | null;
  unknown_id: string | null;
  check_target_id: string | null;
  recorded_at: string;
  fact_write_policy: ReviewOnlyFactWritePolicy;
}

export type EntityAffiliationDispositionDecision =
  | "research_parent_entity"
  | "research_child_entity"
  | "research_both_scopes"
  | "not_relevant"
  | "keep_unknown_open";

export interface EntityAffiliationDispositionInput {
  contextId: string;
  subjectEntityId: string;
  parentEntityId: string;
  decision: EntityAffiliationDispositionDecision;
  reviewer: string;
  reason: string;
  edgeIds?: readonly string[];
  componentIds?: readonly string[];
  unknownIds?: readonly string[];
  recordedAt: string;
}

export interface EntityAffiliationDispositionRecord {
  change_id: string;
  context_id: string;
  subject_entity_id: string;
  parent_entity_id: string;
  decision: EntityAffiliationDispositionDecision;
  reviewer: string;
  reason: string;
  edge_ids: string[];
  component_ids: string[];
  unknown_ids: string[];
  recorded_at: string;
  fact_write_policy: ReviewOnlyFactWritePolicy;
}

export async function enqueueReviewCandidates(client: DbTxClient, candidates: readonly ReviewCandidate[]): Promise<{ inserted: number; skipped: number }> {
  if (candidates.length === 0) return { inserted: 0, skipped: 0 };
  const rows: ReviewCandidateEnqueueInputRow[] = candidates.map((candidate) => ({
    review_id: candidate.review_id,
    candidate_key: candidate.candidate_key,
    kind: candidate.kind,
    candidate,
    doc_id: candidate.evidence.doc_id ?? null,
    source_adapter_id: candidate.evidence.source_adapter_id
  }));
  const result = await client.query<ReviewCandidateEnqueueResultRow>(
    `WITH input AS (
       SELECT *
       FROM jsonb_to_recordset($1::jsonb) AS row(
         review_id text,
         candidate_key text,
         kind text,
         candidate jsonb,
         doc_id text,
         source_adapter_id text
       )
     ),
     inserted AS (
       INSERT INTO review_candidates (review_id, candidate_key, kind, status, candidate, doc_id, source_adapter_id)
       SELECT review_id, candidate_key, kind, 'pending', candidate, doc_id, source_adapter_id
       FROM input
       ON CONFLICT (candidate_key) WHERE candidate_key IS NOT NULL DO NOTHING
       RETURNING 1
     )
     SELECT
       (SELECT count(*)::text FROM inserted) AS inserted,
       (SELECT count(*)::text FROM input) AS total`,
    [JSON.stringify(rows)]
  );
  const summary = result.rows[0];
  if (summary === undefined) throw new Error("Review candidate enqueue did not return a summary row");
  const inserted = Number.parseInt(summary.inserted, 10);
  const total = Number.parseInt(summary.total, 10);
  if (!Number.isFinite(inserted) || !Number.isFinite(total)) throw new Error("Review candidate enqueue returned invalid counts");
  return { inserted, skipped: total - inserted };
}

export async function enqueueReviewCandidatesTransactionally(
  store: DatabaseStore,
  candidates: readonly ReviewCandidate[]
): Promise<{ inserted: number; skipped: number }> {
  return store.transaction((client) => enqueueReviewCandidates(client, candidates));
}

export async function reviewStats(client: DbClient): Promise<ReviewStats> {
  const result = await client.query<ReviewStatsRow>("SELECT status, count(*)::text AS count FROM review_candidates GROUP BY status");
  const stats: ReviewStats = { pending: 0, in_review: 0, approved: 0, rejected: 0, blocked: 0, applied: 0, total: 0 };
  for (const row of result.rows) {
    const count = Number.parseInt(row.count, 10);
    stats[REVIEW_STATS_COUNT_KEYS[row.status]] = count;
    stats.total += count;
  }
  return stats;
}

export async function nextReviewCandidate(client: DbTxClient): Promise<ReviewQueueItem | undefined> {
  const result = await client.query<ReviewCandidateRow>(
    `UPDATE review_candidates
     SET status = 'in_review', updated_at = now()
     WHERE review_id = (
       SELECT review_id
       FROM review_candidates
       WHERE status = 'pending'
       ORDER BY created_at, review_id
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING review_id, candidate_key, kind, status, candidate, reviewer, reviewed_at, decision_reason, created_at`
  );
  return rowToReviewItem(result.rows[0]);
}

export async function nextReviewCandidateTransactionally(store: DatabaseStore): Promise<ReviewQueueItem | undefined> {
  return store.transaction((client) => nextReviewCandidate(client));
}

export async function listApprovedReviewCandidates(client: DbClient, input: { limit: number }): Promise<ReviewQueueItem[]> {
  const result = await client.query<ReviewCandidateRow>(
    `SELECT review_id, candidate_key, kind, status, candidate, reviewer, reviewed_at, decision_reason, created_at
     FROM review_candidates
     WHERE status = 'approved'
     ORDER BY reviewed_at NULLS LAST, created_at, review_id
     LIMIT $1`,
    [input.limit]
  );
  return result.rows.map((row) => {
    const item = rowToReviewItem(row);
    if (item === undefined) throw new Error(`Invalid approved review candidate row: ${row.review_id}`);
    return item;
  });
}

export async function listPendingReviewCandidates(client: DbClient, input: { kind?: ReviewCandidateKind; limit: number }): Promise<ReviewQueueItem[]> {
  const result = await client.query<ReviewCandidateRow>(
    `SELECT review_id, candidate_key, kind, status, candidate, reviewer, reviewed_at, decision_reason, created_at
     FROM review_candidates
     WHERE status = 'pending'
       AND ($2::text IS NULL OR kind = $2)
     ORDER BY created_at, review_id
     LIMIT $1`,
    [input.limit, input.kind ?? null]
  );
  return result.rows.map((row) => {
    const item = rowToReviewItem(row);
    if (item === undefined) throw new Error(`Invalid pending review candidate row: ${row.review_id}`);
    return item;
  });
}

export async function claimApprovedReviewCandidates(client: DbTxClient, input: { limit: number }): Promise<ReviewQueueItem[]> {
  const result = await client.query<ReviewCandidateRow>(
    `UPDATE review_candidates
     SET status = 'in_review', updated_at = now()
     WHERE review_id IN (
       SELECT review_id
       FROM review_candidates
       WHERE status = 'approved'
       ORDER BY reviewed_at NULLS LAST, created_at, review_id
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     RETURNING review_id, candidate_key, kind, status, candidate, reviewer, reviewed_at, decision_reason, created_at`,
    [input.limit]
  );
  return result.rows.map((row) => {
    const item = rowToReviewItem(row);
    if (item === undefined) throw new Error(`Invalid claimed review candidate row: ${row.review_id}`);
    return item;
  });
}

export async function getReviewCandidate(client: DbClient, reviewId: string): Promise<ReviewQueueItem | undefined> {
  const result = await client.query<ReviewCandidateRow>(
    `SELECT review_id, candidate_key, kind, status, candidate, reviewer, reviewed_at, decision_reason, created_at
     FROM review_candidates
     WHERE review_id = $1`,
    [reviewId]
  );
  return rowToReviewItem(result.rows[0]);
}

export async function decideReviewCandidate(
  client: DbTxClient,
  input: {
    reviewId: string;
    decision: Extract<ReviewCandidateStatus, "approved" | "rejected">;
    reviewer: string;
    reason?: string;
  }
): Promise<ReviewQueueItem> {
  const result = await client.query<ReviewCandidateRow>(
    `UPDATE review_candidates
     SET status = $2, reviewer = $3, reviewed_at = now(), decision_reason = $4
     WHERE review_id = $1 AND status IN ('pending','in_review')
     RETURNING review_id, candidate_key, kind, status, candidate, reviewer, reviewed_at, decision_reason, created_at`,
    [input.reviewId, input.decision, input.reviewer, input.reason ?? null]
  );
  const item = rowToReviewItem(result.rows[0]);
  if (item === undefined) throw new Error(`Review candidate not found or not decidable: ${input.reviewId}`);
  await recordSemanticChange(client, {
    scope_kind: "review",
    scope_id: item.review_id,
    change_type: input.decision === "approved" ? "REVIEW_APPROVED" : "REVIEW_REJECTED",
    after: {
      kind: item.kind,
      status: item.status,
      reviewer: input.reviewer,
      reason: input.reason
    },
    caused_by: input.reviewer
  });
  return item;
}

export async function decideReviewCandidateTransactionally(
  store: DatabaseStore,
  input: {
    reviewId: string;
    decision: Extract<ReviewCandidateStatus, "approved" | "rejected">;
    reviewer: string;
    reason?: string;
  }
): Promise<ReviewQueueItem> {
  return store.transaction((client) => decideReviewCandidate(client, input));
}

export async function markReviewCandidateApplied(client: DbTxClient, input: { reviewId: string; reason: string }): Promise<void> {
  const result = await client.query<ReviewCandidateRow>(
    `UPDATE review_candidates
     SET status = 'applied', decision_reason = $2, updated_at = now()
     WHERE review_id = $1
       AND (
         status IN ('approved','blocked')
         OR (status = 'in_review' AND reviewed_at IS NOT NULL)
       )
     RETURNING review_id, candidate_key, kind, status, candidate, reviewer, reviewed_at, decision_reason, created_at`,
    [input.reviewId, input.reason]
  );
  const item = rowToReviewItem(result.rows[0]);
  if (item === undefined) throw new Error(`Review candidate not found or not applicable: ${input.reviewId}`);
  await recordSemanticChange(client, {
    scope_kind: "review",
    scope_id: item.review_id,
    change_type: "REVIEW_APPLIED",
    after: {
      kind: item.kind,
      status: item.status,
      reason: input.reason
    },
    caused_by: item.reviewer ?? "review-store"
  });
}

export async function markReviewCandidateBlocked(client: DbTxClient, input: { reviewId: string; reason: string }): Promise<void> {
  const result = await client.query<ReviewCandidateRow>(
    `UPDATE review_candidates
     SET status = 'blocked', decision_reason = $2, updated_at = now()
     WHERE review_id = $1 AND status IN ('pending','in_review','approved','blocked')
     RETURNING review_id, candidate_key, kind, status, candidate, reviewer, reviewed_at, decision_reason, created_at`,
    [input.reviewId, input.reason]
  );
  const item = rowToReviewItem(result.rows[0]);
  if (item === undefined) throw new Error(`Review candidate not found or not blockable: ${input.reviewId}`);
  await recordSemanticChange(client, {
    scope_kind: "review",
    scope_id: item.review_id,
    change_type: "REVIEW_BLOCKED",
    after: {
      kind: item.kind,
      status: item.status,
      reason: input.reason
    },
    caused_by: item.reviewer ?? "review-store"
  });
}

export async function recordOfficialDisclosureSignalDisposition(
  client: DbTxClient,
  input: OfficialDisclosureSignalDispositionInput
): Promise<OfficialDisclosureSignalDispositionRecord> {
  const item = await getReviewCandidateForUpdate(client, input.reviewId);
  if (item === undefined) throw new Error(`Official disclosure signal review candidate not found: ${input.reviewId}`);
  if (item.kind !== "official_disclosure_signal" || !isOfficialDisclosureSignalReviewCandidate(item.candidate))
    throw new Error(`Review candidate is not an official disclosure signal: ${input.reviewId}`);
  if (item.status === "rejected" || item.status === "applied")
    throw new Error(`Official disclosure signal disposition cannot be recorded for ${item.status} review candidate: ${input.reviewId}`);
  if (input.edgeId.trim().length === 0) throw new Error("Official disclosure signal disposition requires an edge id");
  if (input.reason.trim().length === 0) throw new Error("Official disclosure signal disposition requires a reason");

  const recordedAt = input.recordedAt;
  const after = {
    review_id: item.review_id,
    edge_id: input.edgeId,
    decision: input.decision,
    reviewer: input.reviewer,
    reason: input.reason,
    source_adapter_id: item.candidate.evidence.source_adapter_id,
    doc_id: item.candidate.evidence.doc_id ?? null,
    signal_title: item.candidate.payload.signal_title,
    evidence_id: input.evidenceId ?? null,
    unknown_id: input.unknownId ?? null,
    check_target_id: input.checkTargetId ?? null,
    fact_write_policy: reviewOnlyFactWritePolicy(),
    recorded_at: recordedAt
  };
  const change = await recordSemanticChange(client, {
    scope_kind: "review",
    scope_id: item.review_id,
    change_type: "OFFICIAL_DISCLOSURE_SIGNAL_DISPOSITION_RECORDED",
    after,
    caused_by: input.reviewer
  });
  return officialDisclosureSignalDispositionRecordFromAfter({
    change_id: change.change_id,
    review_id: item.review_id,
    after,
    caused_by: input.reviewer,
    detected_at: new Date(recordedAt)
  });
}

export async function recordEntityAffiliationDisposition(
  client: DbTxClient,
  input: EntityAffiliationDispositionInput
): Promise<EntityAffiliationDispositionRecord> {
  if (input.contextId.trim().length === 0) throw new Error("Entity affiliation disposition requires a context id");
  if (input.subjectEntityId.trim().length === 0) throw new Error("Entity affiliation disposition requires a subject entity id");
  if (input.parentEntityId.trim().length === 0) throw new Error("Entity affiliation disposition requires a parent entity id");
  if (input.reason.trim().length === 0) throw new Error("Entity affiliation disposition requires a reason");
  const after = {
    context_id: input.contextId,
    subject_entity_id: input.subjectEntityId,
    parent_entity_id: input.parentEntityId,
    decision: input.decision,
    reviewer: input.reviewer,
    reason: input.reason,
    edge_ids: uniqueSorted(input.edgeIds ?? []),
    component_ids: uniqueSorted(input.componentIds ?? []),
    unknown_ids: uniqueSorted(input.unknownIds ?? []),
    fact_write_policy: reviewOnlyFactWritePolicy(),
    recorded_at: input.recordedAt
  };
  const change = await recordSemanticChange(client, {
    scope_kind: "entity_affiliation_context",
    scope_id: input.contextId,
    change_type: "ENTITY_AFFILIATION_DISPOSITION_RECORDED",
    after,
    caused_by: input.reviewer
  });
  return entityAffiliationDispositionRecordFromAfter({
    change_id: change.change_id,
    context_id: input.contextId,
    after,
    caused_by: input.reviewer,
    detected_at: new Date(input.recordedAt)
  });
}

export async function listEntityAffiliationDispositions(
  client: DbClient,
  input: { contextIds?: readonly string[]; limit?: number } = {}
): Promise<EntityAffiliationDispositionRecord[]> {
  const params: unknown[] = [];
  const predicates = ["change_type = 'ENTITY_AFFILIATION_DISPOSITION_RECORDED'", "scope_kind = 'entity_affiliation_context'"];
  if (input.contextIds !== undefined && input.contextIds.length > 0) {
    params.push(uniqueSorted(input.contextIds));
    predicates.push(`scope_id = ANY($${params.length}::text[])`);
  }
  params.push(input.limit ?? 200);
  const result = await client.query<EntityAffiliationDispositionRow>(
    `SELECT change_id, scope_id AS context_id, after, caused_by, detected_at
     FROM change_records
     WHERE ${predicates.join(" AND ")}
     ORDER BY detected_at DESC, change_id DESC
     LIMIT $${params.length}`,
    params
  );
  return result.rows.map(entityAffiliationDispositionRecordFromAfter);
}

async function getReviewCandidateForUpdate(client: DbTxClient, reviewId: string): Promise<ReviewQueueItem | undefined> {
  const result = await client.query<ReviewCandidateRow>(
    `SELECT review_id, candidate_key, kind, status, candidate, reviewer, reviewed_at, decision_reason, created_at
     FROM review_candidates
     WHERE review_id = $1
     FOR UPDATE`,
    [reviewId]
  );
  return rowToReviewItem(result.rows[0]);
}

export async function listOfficialDisclosureSignalDispositions(
  client: DbClient,
  input: { reviewIds?: readonly string[]; edgeIds?: readonly string[]; limit?: number } = {}
): Promise<OfficialDisclosureSignalDispositionRecord[]> {
  const params: unknown[] = [];
  const predicates = ["change_type = 'OFFICIAL_DISCLOSURE_SIGNAL_DISPOSITION_RECORDED'", "scope_kind = 'review'"];
  if (input.reviewIds !== undefined && input.reviewIds.length > 0) {
    params.push([...new Set(input.reviewIds)]);
    predicates.push(`scope_id = ANY($${params.length}::text[])`);
  }
  if (input.edgeIds !== undefined && input.edgeIds.length > 0) {
    params.push([...new Set(input.edgeIds)]);
    predicates.push(`after->>'edge_id' = ANY($${params.length}::text[])`);
  }
  params.push(input.limit ?? 200);
  const result = await client.query<OfficialDisclosureSignalDispositionRow>(
    `SELECT change_id, scope_id AS review_id, after, caused_by, detected_at
     FROM change_records
     WHERE ${predicates.join(" AND ")}
     ORDER BY detected_at DESC, change_id DESC
     LIMIT $${params.length}`,
    params
  );
  return result.rows.map(officialDisclosureSignalDispositionRecordFromAfter);
}

function rowToReviewItem(row: ReviewCandidateRow | undefined): ReviewQueueItem | undefined {
  if (row === undefined) return undefined;
  if (!isReviewCandidate(row.candidate)) throw new Error(`Invalid review candidate payload: ${row.review_id}`);
  return {
    review_id: row.review_id,
    candidate_key: row.candidate_key ?? row.candidate.candidate_key,
    kind: row.kind,
    status: row.status,
    candidate: row.candidate,
    created_at: row.created_at.toISOString(),
    ...(row.reviewer === null ? {} : { reviewer: row.reviewer }),
    ...(row.reviewed_at === null ? {} : { reviewed_at: row.reviewed_at.toISOString() }),
    ...(row.decision_reason === null ? {} : { decision_reason: row.decision_reason })
  };
}

function officialDisclosureSignalDispositionRecordFromAfter(row: OfficialDisclosureSignalDispositionRow): OfficialDisclosureSignalDispositionRecord {
  if (!isRecord(row.after)) throw new Error(`Invalid official disclosure signal disposition payload: ${row.change_id}`);
  const factWritePolicy = row.after["fact_write_policy"];
  if (!isReviewOnlyFactWritePolicy(factWritePolicy)) throw new Error(`Official signal disposition cannot authorize fact mutation: ${row.change_id}`);
  const decision = dispositionDecision(row.after["decision"]);
  return {
    change_id: row.change_id,
    review_id: stringField(row.after, "review_id", row.review_id),
    edge_id: stringField(row.after, "edge_id", ""),
    decision,
    reviewer: stringField(row.after, "reviewer", row.caused_by),
    reason: stringField(row.after, "reason", ""),
    source_adapter_id: stringField(row.after, "source_adapter_id", ""),
    doc_id: nullableStringField(row.after, "doc_id"),
    signal_title: stringField(row.after, "signal_title", ""),
    evidence_id: nullableStringField(row.after, "evidence_id"),
    unknown_id: nullableStringField(row.after, "unknown_id"),
    check_target_id: nullableStringField(row.after, "check_target_id"),
    recorded_at: stringField(row.after, "recorded_at", row.detected_at.toISOString()),
    fact_write_policy: reviewOnlyFactWritePolicy()
  };
}

function entityAffiliationDispositionRecordFromAfter(row: EntityAffiliationDispositionRow): EntityAffiliationDispositionRecord {
  if (!isRecord(row.after)) throw new Error(`Invalid entity affiliation disposition payload: ${row.change_id}`);
  const factWritePolicy = row.after["fact_write_policy"];
  if (!isReviewOnlyFactWritePolicy(factWritePolicy)) throw new Error(`Entity affiliation disposition cannot authorize fact mutation: ${row.change_id}`);
  return {
    change_id: row.change_id,
    context_id: stringField(row.after, "context_id", row.context_id),
    subject_entity_id: stringField(row.after, "subject_entity_id", ""),
    parent_entity_id: stringField(row.after, "parent_entity_id", ""),
    decision: entityAffiliationDecision(row.after["decision"]),
    reviewer: stringField(row.after, "reviewer", row.caused_by),
    reason: stringField(row.after, "reason", ""),
    edge_ids: stringArrayField(row.after, "edge_ids"),
    component_ids: stringArrayField(row.after, "component_ids"),
    unknown_ids: stringArrayField(row.after, "unknown_ids"),
    recorded_at: stringField(row.after, "recorded_at", row.detected_at.toISOString()),
    fact_write_policy: reviewOnlyFactWritePolicy()
  };
}

function entityAffiliationDecision(value: unknown): EntityAffiliationDispositionDecision {
  if (
    value === "research_parent_entity" ||
    value === "research_child_entity" ||
    value === "research_both_scopes" ||
    value === "not_relevant" ||
    value === "keep_unknown_open"
  ) {
    return value;
  }
  throw new Error(`Invalid entity affiliation disposition decision: ${String(value)}`);
}

function dispositionDecision(value: unknown): OfficialDisclosureSignalDispositionDecision {
  if (
    value === "supports_existing_edge" ||
    value === "needs_more_evidence" ||
    value === "not_relevant" ||
    value === "record_single_source_unknown" ||
    value === "create_counterparty_source_target"
  ) {
    return value;
  }
  throw new Error(`Invalid official disclosure signal disposition decision: ${String(value)}`);
}

function stringField(record: Record<string, unknown>, key: string, fallback: string): string {
  const value = record[key];
  if (value === undefined && fallback.length > 0) return fallback;
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`Expected non-empty string field: ${key}`);
  return value;
}

function nullableStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`Expected nullable string field: ${key}`);
  return value;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error(`Expected string array field: ${key}`);
  return uniqueSorted(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))].sort();
}
