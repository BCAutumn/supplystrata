import { normalizeAlias } from "@supplystrata/core";
import { type DatabaseStore } from "@supplystrata/db/write";
import { isEntitySourceReviewCandidate, type EntitySourceReviewCandidate } from "@supplystrata/review-candidates";
import { decideReviewCandidate, listPendingReviewCandidates, type ReviewQueueItem } from "@supplystrata/review-store";
import { applyApprovedReviewCandidate } from "./review-apply.js";
import type { ReviewApplyBatchItem } from "./review-apply-definitions.js";

export interface Gate1EntitySourceReviewBatchInput {
  reviewer?: string;
  limit?: number;
  apply?: boolean;
}

export interface Gate1EntitySourceReviewBatchItem {
  review_id: string;
  surface: string;
  candidate_name: string;
  source_adapter_id: string;
  decision: "eligible" | "skipped" | "applied" | "blocked" | "error";
  reason: string;
  proposed_entity_id?: string;
  apply_result?: ReviewApplyBatchItem;
}

export interface Gate1EntitySourceReviewBatchSummary {
  mode: "dry_run" | "approve_apply";
  requested_limit: number;
  scanned: number;
  eligible: number;
  applied: number;
  skipped: number;
  blocked: number;
  errors: number;
  items: Gate1EntitySourceReviewBatchItem[];
}

const DEFAULT_GATE1_ENTITY_SOURCE_LIMIT = 20;
const GATE1_ENTITY_SOURCE_REVIEW_REASON =
  "Gate 1 deterministic entity-source batch: GLEIF active fully corroborated legal name exactly matches supplier-list surface.";

export async function runGate1EntitySourceReviewBatch(
  store: DatabaseStore,
  input: Gate1EntitySourceReviewBatchInput
): Promise<Gate1EntitySourceReviewBatchSummary> {
  const limit = input.limit ?? DEFAULT_GATE1_ENTITY_SOURCE_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0) throw new Error(`Gate 1 entity-source review batch limit must be a positive integer: ${limit}`);

  const pending = await listPendingReviewCandidates(store.read, { kind: "entity_source_candidate", limit });
  const items: Gate1EntitySourceReviewBatchItem[] = [];
  for (const item of pending) {
    const assessment = assessGate1EntitySourceReviewCandidate(item);
    if (assessment.decision !== "eligible") {
      items.push(assessment);
      continue;
    }
    if (input.apply !== true) {
      items.push(assessment);
      continue;
    }
    const reviewer = requiredGate1EntitySourceReviewer(input.reviewer);
    items.push(await approveAndApplyGate1EntitySourceReview(store, assessment, reviewer));
  }

  return summarizeGate1EntitySourceBatch({
    mode: input.apply === true ? "approve_apply" : "dry_run",
    requested_limit: limit,
    scanned: pending.length,
    items
  });
}

export function assessGate1EntitySourceReviewCandidate(item: ReviewQueueItem): Gate1EntitySourceReviewBatchItem {
  if (item.kind !== "entity_source_candidate" || !isEntitySourceReviewCandidate(item.candidate)) {
    return baseEntitySourceAssessment(item, "skipped", "review candidate is not an entity-source candidate");
  }

  const unsafeReason = unsafeGate1EntitySourceReviewReason(item.candidate);
  if (unsafeReason !== undefined) return baseEntitySourceAssessment(item, "skipped", unsafeReason);

  return {
    ...baseEntitySourceAssessment(item, "eligible", GATE1_ENTITY_SOURCE_REVIEW_REASON),
    proposed_entity_id: item.candidate.payload.proposed_entity_id
  };
}

export function unsafeGate1EntitySourceReviewReason(candidate: EntitySourceReviewCandidate): string | undefined {
  if (candidate.payload.candidate.source_adapter_id !== "gleif") return `unsupported entity source: ${candidate.payload.candidate.source_adapter_id}`;
  if (candidate.payload.candidate.current_status !== "ACTIVE")
    return `GLEIF entity status is not ACTIVE: ${candidate.payload.candidate.current_status ?? "unknown"}`;
  if (!candidate.payload.candidate.provenance_note.includes("corroboration=FULLY_CORROBORATED")) return "GLEIF record is not fully corroborated";
  if (!gate1LegalNamesMatch(candidate.payload.surface, candidate.payload.candidate.name)) {
    return `surface does not exactly match normalized GLEIF legal name: ${candidate.payload.surface} -> ${candidate.payload.candidate.name}`;
  }
  if (!candidate.payload.proposed_entity_id.startsWith("ENT-GLEIF-"))
    return `GLEIF proposed entity id must use ENT-GLEIF prefix: ${candidate.payload.proposed_entity_id}`;
  return undefined;
}

function gate1LegalNamesMatch(surface: string, candidateName: string): boolean {
  return normalizeGate1LegalName(surface) === normalizeGate1LegalName(candidateName);
}

function normalizeGate1LegalName(value: string): string {
  // Gate 1 可以接受法律名称中的标点差异，但不能接受简称、后缀缺失或语义相近的模糊匹配。
  return normalizeAlias(value)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function approveAndApplyGate1EntitySourceReview(
  store: DatabaseStore,
  assessment: Gate1EntitySourceReviewBatchItem,
  reviewer: string
): Promise<Gate1EntitySourceReviewBatchItem> {
  try {
    await store.transaction((client) =>
      decideReviewCandidate(client, {
        reviewId: assessment.review_id,
        decision: "approved",
        reviewer,
        reason: assessment.reason
      })
    );
    const applyResult = await applyApprovedReviewCandidate(store, assessment.review_id, reviewer);
    if (applyResult.status === "blocked") return { ...assessment, decision: "blocked", reason: applyResult.reason, apply_result: applyResult };
    return { ...assessment, decision: "applied", reason: assessment.reason, apply_result: applyResult };
  } catch (error) {
    return { ...assessment, decision: "error", reason: error instanceof Error ? error.message : String(error) };
  }
}

function requiredGate1EntitySourceReviewer(reviewer: string | undefined): string {
  if (reviewer === undefined) throw new Error("Gate 1 entity-source review batch apply mode requires a reviewer");
  return reviewer;
}

function baseEntitySourceAssessment(
  item: ReviewQueueItem,
  decision: Gate1EntitySourceReviewBatchItem["decision"],
  reason: string
): Gate1EntitySourceReviewBatchItem {
  const candidate = isEntitySourceReviewCandidate(item.candidate) ? item.candidate : undefined;
  return {
    review_id: item.review_id,
    surface: candidate?.payload.surface ?? "unknown",
    candidate_name: candidate?.payload.candidate.name ?? "unknown",
    source_adapter_id: candidate?.payload.candidate.source_adapter_id ?? "unknown",
    decision,
    reason
  };
}

function summarizeGate1EntitySourceBatch(input: {
  mode: Gate1EntitySourceReviewBatchSummary["mode"];
  requested_limit: number;
  scanned: number;
  items: Gate1EntitySourceReviewBatchItem[];
}): Gate1EntitySourceReviewBatchSummary {
  return {
    mode: input.mode,
    requested_limit: input.requested_limit,
    scanned: input.scanned,
    eligible: input.items.filter((item) => item.decision === "eligible").length,
    applied: input.items.filter((item) => item.decision === "applied").length,
    skipped: input.items.filter((item) => item.decision === "skipped").length,
    blocked: input.items.filter((item) => item.decision === "blocked").length,
    errors: input.items.filter((item) => item.decision === "error").length,
    items: input.items
  };
}
