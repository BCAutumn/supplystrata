export function normalizeWorkbenchModelJson(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const normalized: Record<string, unknown> = { ...value };
  // 旧版 Workbench 在 claim draft 落地前没有 draft_claims；契约层统一补为空数组。
  if (normalized["draft_claims"] === undefined) normalized["draft_claims"] = [];
  // 旧版 Workbench 没有统一 attention queue；读取端统一补空数组以保持静态 snapshot 可重放。
  if (normalized["attention_queue"] === undefined) normalized["attention_queue"] = [];
  // 旧版 Workbench 没有 review queue 摘要；读取端统一补空数组以保持静态 snapshot 可重放。
  if (normalized["review_queue"] === undefined) normalized["review_queue"] = [];
  // 旧版 Workbench 没有关系强度和新鲜度上下文；前端用空对象维持稳定读取路径。
  if (normalized["intelligence"] === undefined) normalized["intelligence"] = { edge_strengths: [], edge_freshness: [] };
  normalized["unknown_items"] = normalizeUnknownArray(normalized["unknown_items"]);
  normalized["claims"] = normalizeClaimArray(normalized["claims"]);
  normalized["draft_claims"] = normalizeClaimArray(normalized["draft_claims"]);
  normalized["review_queue"] = normalizeReviewQueueArray(normalized["review_queue"]);
  return normalized;
}

function normalizeUnknownArray(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (!isRecord(item)) return item;
    const normalized: Record<string, unknown> = { ...item };
    // 旧版静态 Workbench 没有 unknown scope；用 legacy scope 保持快照可重放，新导出必须给出真实 scope。
    if (normalized["scope_kind"] === undefined) normalized["scope_kind"] = "legacy";
    if (normalized["scope_id"] === undefined) normalized["scope_id"] = stringField(normalized, "unknown_id", "");
    return normalized;
  });
}

function normalizeClaimArray(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (!isRecord(item)) return item;
    const normalized: Record<string, unknown> = { ...item };
    // 旧版 Workbench 导出对非 review claim 会省略 review_id；契约层统一补成 null。
    if (normalized["review_id"] === undefined) normalized["review_id"] = null;
    if (normalized["evidence_refs"] === undefined) normalized["evidence_refs"] = [];
    if (normalized["unknown_refs"] === undefined) normalized["unknown_refs"] = [];
    if (normalized["edge_validity"] === undefined) normalized["edge_validity"] = null;
    if (normalized["edge_deprecated_reason"] === undefined) normalized["edge_deprecated_reason"] = null;
    if (normalized["edge_superseded_by_edge_id"] === undefined) normalized["edge_superseded_by_edge_id"] = null;
    if (normalized["lifecycle_warnings"] === undefined) normalized["lifecycle_warnings"] = [];
    if (normalized["conflict_state"] === undefined) normalized["conflict_state"] = "none";
    if (normalized["conflict_adjudication"] === undefined) {
      normalized["conflict_adjudication"] = {
        state: normalized["conflict_state"],
        severity: "none",
        recommended_action: "none",
        edge_review_required: false,
        allowed_edge_mutation: "none",
        reason_codes: []
      };
    }
    if (normalized["conflict_review"] === undefined) {
      normalized["conflict_review"] = legacyClaimConflictReviewPacket(normalized);
    }
    return normalized;
  });
}

function normalizeReviewQueueArray(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (!isRecord(item)) return item;
    const normalized: Record<string, unknown> = { ...item };
    if (normalized["dispositions"] === undefined) normalized["dispositions"] = [];
    return normalized;
  });
}

function legacyClaimConflictReviewPacket(claim: Record<string, unknown>): Record<string, unknown> {
  const adjudication = isRecord(claim["conflict_adjudication"]) ? claim["conflict_adjudication"] : {};
  const conflictState = stringField(adjudication, "state", stringField(claim, "conflict_state", "none"));
  const severity = stringField(adjudication, "severity", "none");
  const recommendedAction = stringField(adjudication, "recommended_action", "none");
  const edgeReviewRequired = booleanField(adjudication, "edge_review_required", false);
  const reasonCodes = stringArrayField(adjudication, "reason_codes");
  const requiresHumanReview = conflictState === "open_conflict" || conflictState === "contradicting_evidence";

  return {
    claim_id: stringField(claim, "claim_id", ""),
    claim_text: stringField(claim, "claim_text", ""),
    conflict_state: conflictState,
    severity,
    recommended_action: recommendedAction,
    review_queue_kind: requiresHumanReview ? "claim_conflict_review" : "none",
    safe_write_status: legacySafeWriteStatus(conflictState),
    edge_review_required: edgeReviewRequired,
    required_review_steps: [],
    evidence_refs: Array.isArray(claim["evidence_refs"]) ? claim["evidence_refs"] : [],
    unknown_refs: Array.isArray(claim["unknown_refs"]) ? claim["unknown_refs"] : [],
    fact_write_policy: {
      automatic_fact_mutation_allowed: false,
      allowed_edge_mutation: "none",
      requires_human_review: requiresHumanReview,
      reason_codes: reasonCodes
    }
  };
}

function legacySafeWriteStatus(conflictState: string): string {
  if (conflictState === "open_conflict" || conflictState === "contradicting_evidence") return "blocked_pending_review";
  if (conflictState === "resolved_conflict") return "resolved_context_only";
  return "none";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string, fallback: string): string {
  const value = record[key];
  return typeof value === "string" ? value : fallback;
}

function booleanField(record: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = record[key];
  return typeof value === "boolean" ? value : fallback;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
