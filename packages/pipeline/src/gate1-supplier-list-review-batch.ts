import { loadDocument } from "@supplystrata/db/read";
import { type DatabaseStore } from "@supplystrata/db/write";
import { DbEntityResolver } from "@supplystrata/entity-resolver";
import { isSupplierListReviewCandidate, supplierListReviewToSupplierRelation, type SupplierListReviewCandidate } from "@supplystrata/review-candidates";
import { decideReviewCandidate, listPendingReviewCandidates, type ReviewQueueItem } from "@supplystrata/review-store";
import { applyApprovedReviewCandidate } from "./review-apply.js";
import type { ReviewApplyBatchItem } from "./review-apply-definitions.js";
import { locateSupplierListReviewCitations } from "./review-apply-supplier-list.js";

export interface Gate1SupplierListReviewBatchInput {
  reviewer?: string;
  limit?: number;
  apply?: boolean;
}

export interface Gate1SupplierListReviewBatchItem {
  review_id: string;
  supplier_name: string;
  location_text: string;
  country_or_region: string;
  decision: "eligible" | "skipped" | "applied" | "blocked" | "error";
  reason: string;
  supplier_entity_id?: string;
  apply_result?: ReviewApplyBatchItem;
}

export interface Gate1SupplierListEntityResolutionBacklogItem {
  supplier_name: string;
  unresolved_candidates: number;
  countries_or_regions: string[];
  sample_review_id: string;
  suggested_next_action: "resolve_supplier_entity";
}

export interface Gate1SupplierListReviewBatchSummary {
  mode: "dry_run" | "approve_apply";
  requested_limit: number;
  scanned: number;
  eligible: number;
  applied: number;
  skipped: number;
  blocked: number;
  errors: number;
  entity_resolution_backlog: Gate1SupplierListEntityResolutionBacklogItem[];
  items: Gate1SupplierListReviewBatchItem[];
}

const DEFAULT_GATE1_SUPPLIER_LIST_LIMIT = 50;
const DEFAULT_ENTITY_RESOLUTION_BACKLOG_LIMIT = 20;
const UNRESOLVED_SUPPLIER_REASON_PREFIX = "supplier does not resolve to a curated entity:";
const GATE1_SUPPLIER_LIST_REVIEW_REASON =
  "Gate 1 deterministic supplier-list batch: official source row, curated supplier entity resolution, and reproducible citation.";

export async function runGate1SupplierListReviewBatch(
  store: DatabaseStore,
  input: Gate1SupplierListReviewBatchInput
): Promise<Gate1SupplierListReviewBatchSummary> {
  const limit = input.limit ?? DEFAULT_GATE1_SUPPLIER_LIST_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0) throw new Error(`Gate 1 supplier-list review batch limit must be a positive integer: ${limit}`);

  const pending = await listPendingReviewCandidates(store.read, { kind: "supplier_list_row", limit });
  const items: Gate1SupplierListReviewBatchItem[] = [];
  for (const item of pending) {
    const assessment = await assessGate1SupplierListReviewCandidate(store, item);
    if (assessment.decision !== "eligible") {
      items.push(assessment);
      continue;
    }
    if (input.apply !== true) {
      items.push(assessment);
      continue;
    }
    const reviewer = requiredGate1SupplierListReviewer(input.reviewer);
    items.push(await approveAndApplyGate1SupplierListReview(store, assessment, reviewer));
  }

  return summarizeGate1SupplierListBatch({
    mode: input.apply === true ? "approve_apply" : "dry_run",
    requested_limit: limit,
    scanned: pending.length,
    items
  });
}

function requiredGate1SupplierListReviewer(reviewer: string | undefined): string {
  if (reviewer === undefined) throw new Error("Gate 1 supplier-list review batch apply mode requires a reviewer");
  return reviewer;
}

export async function assessGate1SupplierListReviewCandidate(store: DatabaseStore, item: ReviewQueueItem): Promise<Gate1SupplierListReviewBatchItem> {
  if (item.kind !== "supplier_list_row" || !isSupplierListReviewCandidate(item.candidate)) {
    return baseAssessment(item, "skipped", "review candidate is not a supplier-list row");
  }

  const candidate = item.candidate;
  const unsafeReason = unsafeSupplierListReviewReason(candidate);
  if (unsafeReason !== undefined) return baseAssessment(item, "skipped", unsafeReason);

  return store.transaction(async (client) => {
    const resolver = new DbEntityResolver(client);
    const relation = supplierListReviewToSupplierRelation(candidate);
    const supplier = await resolver.resolve(relation.object_resolve);
    if (supplier.status !== "resolved" || supplier.entity_id === undefined) {
      return baseAssessment(item, "skipped", `supplier does not resolve to a curated entity: ${candidate.payload.supplier_name}`);
    }

    const docId = candidate.evidence.doc_id;
    if (docId === undefined) return baseAssessment(item, "skipped", "supplier-list review candidate is missing doc_id");
    const document = await loadDocument(client, docId);
    const citations = locateSupplierListReviewCitations(document, candidate);
    if (citations.status !== "ready") return baseAssessment(item, "skipped", citations.reason);

    return {
      ...baseAssessment(item, "eligible", GATE1_SUPPLIER_LIST_REVIEW_REASON),
      supplier_entity_id: supplier.entity_id
    };
  });
}

export function unsafeSupplierListReviewReason(candidate: SupplierListReviewCandidate): string | undefined {
  if (candidate.evidence.source_adapter_id !== "apple-suppliers") return `unsupported supplier-list source: ${candidate.evidence.source_adapter_id}`;
  if (candidate.payload.buyer_entity_id !== "ENT-APPLE") return `unsupported supplier-list buyer: ${candidate.payload.buyer_entity_id}`;
  if (candidate.payload.location_text === "Supplier List") return "supplier-list page marker is not facility evidence";
  if (/^\d+$/.test(candidate.payload.country_or_region)) return "supplier-list page marker was parsed as country_or_region";
  if (candidate.evidence.source_row_text.trim().length < 30) return "supplier-list source row is too short for auditable evidence";
  return undefined;
}

async function approveAndApplyGate1SupplierListReview(
  store: DatabaseStore,
  assessment: Extract<Gate1SupplierListReviewBatchItem, { decision: "eligible" }> | Gate1SupplierListReviewBatchItem,
  reviewer: string
): Promise<Gate1SupplierListReviewBatchItem> {
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

function baseAssessment(item: ReviewQueueItem, decision: Gate1SupplierListReviewBatchItem["decision"], reason: string): Gate1SupplierListReviewBatchItem {
  const candidate = isSupplierListReviewCandidate(item.candidate) ? item.candidate : undefined;
  return {
    review_id: item.review_id,
    supplier_name: candidate?.payload.supplier_name ?? "unknown",
    location_text: candidate?.payload.location_text ?? "unknown",
    country_or_region: candidate?.payload.country_or_region ?? "unknown",
    decision,
    reason
  };
}

function summarizeGate1SupplierListBatch(input: {
  mode: Gate1SupplierListReviewBatchSummary["mode"];
  requested_limit: number;
  scanned: number;
  items: Gate1SupplierListReviewBatchItem[];
}): Gate1SupplierListReviewBatchSummary {
  return {
    mode: input.mode,
    requested_limit: input.requested_limit,
    scanned: input.scanned,
    eligible: input.items.filter((item) => item.decision === "eligible").length,
    applied: input.items.filter((item) => item.decision === "applied").length,
    skipped: input.items.filter((item) => item.decision === "skipped").length,
    blocked: input.items.filter((item) => item.decision === "blocked").length,
    errors: input.items.filter((item) => item.decision === "error").length,
    entity_resolution_backlog: buildGate1SupplierEntityResolutionBacklog(input.items),
    items: input.items
  };
}

export function buildGate1SupplierEntityResolutionBacklog(
  items: Gate1SupplierListReviewBatchItem[],
  limit = DEFAULT_ENTITY_RESOLUTION_BACKLOG_LIMIT
): Gate1SupplierListEntityResolutionBacklogItem[] {
  const backlog = new Map<string, { count: number; countries: Set<string>; sampleReviewId: string }>();
  for (const item of items) {
    if (item.decision !== "skipped" || !item.reason.startsWith(UNRESOLVED_SUPPLIER_REASON_PREFIX)) continue;
    const current = backlog.get(item.supplier_name);
    if (current === undefined) {
      backlog.set(item.supplier_name, {
        count: 1,
        countries: new Set([item.country_or_region]),
        sampleReviewId: item.review_id
      });
      continue;
    }
    current.count += 1;
    current.countries.add(item.country_or_region);
  }

  return [...backlog.entries()]
    .sort(([leftName, left], [rightName, right]) => right.count - left.count || leftName.localeCompare(rightName))
    .slice(0, limit)
    .map(([supplierName, item]) => ({
      supplier_name: supplierName,
      unresolved_candidates: item.count,
      countries_or_regions: [...item.countries].sort((left, right) => left.localeCompare(right)),
      sample_review_id: item.sampleReviewId,
      suggested_next_action: "resolve_supplier_entity"
    }));
}
