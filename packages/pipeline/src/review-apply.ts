import type pg from "pg";
import { logger, type ApplyResult, type ApprovedCandidate, type RelationType } from "@supplystrata/core";
import { loadDocument, recordPendingEntity } from "@supplystrata/db";
import {
  applyEntitySourceReviewCandidate,
  ensureSupplierListFacilityEntity,
  resolvePendingEntitySurface,
  type EntityImportResult,
  type FacilityImportResult
} from "@supplystrata/entity-import";
import { DbEntityResolver } from "@supplystrata/entity-resolver";
import { DeterministicEvidenceScorer } from "@supplystrata/evidence-scorer";
import { GraphBuilder } from "@supplystrata/graph-builder";
import {
  isEntitySourceReviewCandidate,
  isSupplierListReviewCandidate,
  supplierListReviewToFacilityRelation,
  supplierListReviewToSupplierRelation
} from "@supplystrata/review-candidates";
import { getReviewCandidate, listApprovedReviewCandidates, markReviewCandidateApplied, markReviewCandidateBlocked } from "@supplystrata/review-store";

export interface AppliedReviewEdgeResult extends ApplyResult {
  role: "supplier_relation" | "facility_relation";
  relation: RelationType;
}

export type ReviewApplyResult =
  | {
      status: "applied";
      review_id: string;
      apply_result: ApplyResult;
      apply_results: AppliedReviewEdgeResult[];
      pending_entities_resolved: number;
      facility_import: Extract<FacilityImportResult, { status: "applied" }>;
    }
  | { status: "entity_applied"; review_id: string; import_result: Extract<EntityImportResult, { status: "applied" }> }
  | { status: "blocked"; review_id: string; reason: string; pending_id?: string };

export type ReviewApplyBatchItem =
  | ReviewApplyResult
  | { status: "error"; review_id: string; reason: string };

export interface ReviewApplyBatchSummary {
  requested_limit: number;
  scanned: number;
  applied: number;
  applied_edges: number;
  entity_applied: number;
  blocked: number;
  errors: number;
  results: ReviewApplyBatchItem[];
}

export async function applyApprovedReviewCandidate(pool: pg.Pool, reviewId: string, reviewer: string): Promise<ReviewApplyResult> {
  const item = await getReviewCandidate(pool, reviewId);
  if (item === undefined) return { status: "blocked", review_id: reviewId, reason: "review candidate not found" };
  if (item.status !== "approved" && item.status !== "blocked") return { status: "blocked", review_id: reviewId, reason: `review candidate status is ${item.status}, expected approved or blocked` };
  if (isEntitySourceReviewCandidate(item.candidate)) {
    const importResult = await applyEntitySourceReviewCandidate(pool, item.candidate, reviewer);
    if (importResult.status === "blocked") {
      await markReviewCandidateBlocked(pool, { reviewId, reason: importResult.reason });
      return { status: "blocked", review_id: reviewId, reason: importResult.reason };
    }
    await markReviewCandidateApplied(pool, { reviewId, reason: `imported entity ${importResult.entity_id}` });
    return { status: "entity_applied", review_id: reviewId, import_result: importResult };
  }
  if (!isSupplierListReviewCandidate(item.candidate)) return { status: "blocked", review_id: reviewId, reason: `unsupported review candidate kind: ${item.kind}` };

  const supplierRelation = supplierListReviewToSupplierRelation(item.candidate);
  const resolver = new DbEntityResolver(pool);
  const buyerResolution = await resolver.resolve(supplierRelation.subject_resolve);
  if (buyerResolution.status !== "resolved" || buyerResolution.entity_id === undefined) {
    await markReviewCandidateBlocked(pool, { reviewId, reason: `cannot resolve buyer: ${supplierRelation.subject_resolve.surface}` });
    return { status: "blocked", review_id: reviewId, reason: `cannot resolve buyer: ${supplierRelation.subject_resolve.surface}` };
  }

  const supplierResolution = await resolver.resolve(supplierRelation.object_resolve);
  if (supplierResolution.status !== "resolved" || supplierResolution.entity_id === undefined) {
    const pending = await recordPendingEntity(pool, {
      surface: supplierRelation.object_resolve.surface,
      context: {
        review_id: reviewId,
        source_adapter_id: item.candidate.evidence.source_adapter_id,
        normalized_record_text: item.candidate.evidence.normalized_record_text,
        country_or_region: item.candidate.payload.country_or_region
      }
    });
    await markReviewCandidateBlocked(pool, { reviewId, reason: `cannot resolve supplier: ${supplierRelation.object_resolve.surface}` });
    return { status: "blocked", review_id: reviewId, reason: `cannot resolve supplier: ${supplierRelation.object_resolve.surface}`, pending_id: pending.pending_id };
  }

  const docId = item.candidate.evidence.doc_id;
  if (docId === undefined) return { status: "blocked", review_id: reviewId, reason: "supplier-list review candidate is missing doc_id" };
  const facilityImport = await ensureSupplierListFacilityEntity(pool, item.candidate, reviewer);
  if (facilityImport.status === "blocked") {
    await markReviewCandidateBlocked(pool, { reviewId, reason: facilityImport.reason });
    return { status: "blocked", review_id: reviewId, reason: facilityImport.reason };
  }
  const facilityRelation = supplierListReviewToFacilityRelation(item.candidate, facilityImport.display_name);
  const facilityResolution = await resolver.resolve(facilityRelation.object_resolve);
  if (facilityResolution.status !== "resolved" || facilityResolution.entity_id === undefined) {
    logger.warn({ review_id: reviewId, facility_entity_id: facilityImport.entity_id }, "facility entity was imported but could not be resolved by its canonical alias");
    await markReviewCandidateBlocked(pool, { reviewId, reason: `cannot resolve facility: ${facilityRelation.object_resolve.surface}` });
    return { status: "blocked", review_id: reviewId, reason: `cannot resolve facility: ${facilityRelation.object_resolve.surface}` };
  }

  const doc = await loadDocument(pool, docId);
  const scorer = new DeterministicEvidenceScorer();
  const supplierScoring = await scorer.score(supplierRelation, doc);
  const facilityScoring = await scorer.score(facilityRelation, doc);
  const builder = new GraphBuilder(pool, resolver);
  try {
    const supplierApply = await applyReviewedRelation(builder, {
      candidate: supplierRelation,
      scoring: { ...supplierScoring, needs_review: false },
      approved_by: { reviewer, reviewed_at: new Date().toISOString() },
      doc_id: docId
    });
    const facilityApply = await applyReviewedRelation(builder, {
      candidate: facilityRelation,
      scoring: { ...facilityScoring, needs_review: false },
      approved_by: { reviewer, reviewed_at: new Date().toISOString() },
      doc_id: docId
    });
    const pendingResolved = await resolvePendingEntitySurface(pool, { surface: supplierRelation.object_resolve.surface, entityId: supplierResolution.entity_id, reviewer });
    const applyResults: AppliedReviewEdgeResult[] = [
      { ...supplierApply, role: "supplier_relation", relation: supplierRelation.relation },
      { ...facilityApply, role: "facility_relation", relation: facilityRelation.relation }
    ];
    await markReviewCandidateApplied(pool, { reviewId, reason: `applied edges ${applyResults.map((result) => result.edge_id).join(", ")}` });
    return { status: "applied", review_id: reviewId, apply_result: supplierApply, apply_results: applyResults, pending_entities_resolved: pendingResolved, facility_import: facilityImport };
  } finally {
    await builder.close();
  }
}

export async function applyApprovedReviewCandidates(pool: pg.Pool, input: { reviewer: string; limit: number }): Promise<ReviewApplyBatchSummary> {
  const items = await listApprovedReviewCandidates(pool, { limit: input.limit });
  const results: ReviewApplyBatchItem[] = [];
  for (const item of items) {
    try {
      results.push(await applyApprovedReviewCandidate(pool, item.review_id, input.reviewer));
    } catch (error) {
      results.push({ status: "error", review_id: item.review_id, reason: messageFromUnknown(error) });
    }
  }
  const appliedItems = results.filter((item) => item.status === "applied");
  return {
    requested_limit: input.limit,
    scanned: items.length,
    applied: appliedItems.length,
    applied_edges: appliedItems.reduce((sum, item) => sum + item.apply_results.length, 0),
    entity_applied: results.filter((item) => item.status === "entity_applied").length,
    blocked: results.filter((item) => item.status === "blocked").length,
    errors: results.filter((item) => item.status === "error").length,
    results
  };
}

async function applyReviewedRelation(builder: GraphBuilder, approved: ApprovedCandidate): Promise<ApplyResult> {
  return builder.apply(approved);
}

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
}
