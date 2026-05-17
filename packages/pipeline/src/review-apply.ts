import type pg from "pg";
import { type ApplyResult, type ApprovedCandidate, type RelationType } from "@supplystrata/core";
import { loadDocument, recordPendingEntity, type DocumentWithChunks } from "@supplystrata/db";
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
  supplierListReviewToSupplierRelation,
  type SupplierListReviewCandidate
} from "@supplystrata/review-candidates";
import {
  getReviewCandidate,
  listApprovedReviewCandidates,
  markReviewCandidateApplied,
  markReviewCandidateBlocked,
  type ReviewQueueItem
} from "@supplystrata/review-store";
import { getLogger } from "@supplystrata/observability";

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

type SupplierListReviewItem = ReviewQueueItem & { candidate: SupplierListReviewCandidate };

export async function applyApprovedReviewCandidate(pool: pg.Pool, reviewId: string, reviewer: string): Promise<ReviewApplyResult> {
  const item = await getReviewCandidate(pool, reviewId);
  if (item === undefined) return { status: "blocked", review_id: reviewId, reason: "review candidate not found" };
  if (!canApplyReviewStatus(item.status)) return { status: "blocked", review_id: reviewId, reason: `review candidate status is ${item.status}, expected approved or blocked` };
  if (isEntitySourceReviewCandidate(item.candidate)) {
    return applyEntityReviewCandidate(pool, item, reviewer);
  }
  if (isSupplierListReviewCandidate(item.candidate)) {
    return applySupplierListReviewCandidate(pool, { ...item, candidate: item.candidate }, reviewer);
  }
  return blockReviewCandidate(pool, reviewId, `unsupported review candidate kind: ${item.kind}`);
}

function canApplyReviewStatus(status: ReviewQueueItem["status"]): boolean {
  // blocked 候选允许人工补 seed/entity 后重试；批处理仍只扫描 approved。
  return status === "approved" || status === "blocked";
}

async function applyEntityReviewCandidate(pool: pg.Pool, item: ReviewQueueItem, reviewer: string): Promise<ReviewApplyResult> {
  if (!isEntitySourceReviewCandidate(item.candidate)) {
    return blockReviewCandidate(pool, item.review_id, `unsupported entity review candidate kind: ${item.kind}`);
  }
  const importResult = await applyEntitySourceReviewCandidate(pool, item.candidate, reviewer);
  if (importResult.status === "blocked") return blockReviewCandidate(pool, item.review_id, importResult.reason);
  await markReviewCandidateApplied(pool, { reviewId: item.review_id, reason: `imported entity ${importResult.entity_id}` });
  return { status: "entity_applied", review_id: item.review_id, import_result: importResult };
}

async function applySupplierListReviewCandidate(pool: pg.Pool, item: SupplierListReviewItem, reviewer: string): Promise<ReviewApplyResult> {
  const reviewId = item.review_id;
  const supplierRelation = supplierListReviewToSupplierRelation(item.candidate);
  const resolver = new DbEntityResolver(pool);
  const entityResolution = await resolveSupplierListEntities(pool, item, resolver, supplierRelation);
  if (entityResolution.status === "blocked") return entityResolution;

  const facilityPreparation = await prepareSupplierListFacility(pool, item, resolver, reviewer);
  if (facilityPreparation.status === "blocked") return facilityPreparation;
  const doc = await loadReviewDocument(pool, item);
  if (doc.status === "blocked") return doc;
  const scored = await scoreSupplierListRelations(supplierRelation, facilityPreparation.facilityRelation, doc.document);
  const builder = new GraphBuilder(pool, resolver);
  try {
    const applyResults = await applySupplierListEdges(builder, scored, doc.docId, reviewer);
    const pendingResolved = await resolvePendingEntitySurface(pool, { surface: supplierRelation.object_resolve.surface, entityId: entityResolution.supplier_entity_id, reviewer });
    await markReviewCandidateApplied(pool, { reviewId, reason: `applied edges ${applyResults.map((result) => result.edge_id).join(", ")}` });
    return {
      status: "applied",
      review_id: reviewId,
      apply_result: applyResults[0],
      apply_results: applyResults,
      pending_entities_resolved: pendingResolved,
      facility_import: facilityPreparation.facilityImport
    };
  } finally {
    await builder.close();
  }
}

type SupplierEntityResolution =
  | { status: "ready"; supplier_entity_id: string }
  | Extract<ReviewApplyResult, { status: "blocked" }>;

async function resolveSupplierListEntities(
  pool: pg.Pool,
  item: SupplierListReviewItem,
  resolver: DbEntityResolver,
  supplierRelation: ReturnType<typeof supplierListReviewToSupplierRelation>
): Promise<SupplierEntityResolution> {
  const buyerResolution = await resolver.resolve(supplierRelation.subject_resolve);
  if (buyerResolution.status !== "resolved" || buyerResolution.entity_id === undefined) {
    return blockReviewCandidate(pool, item.review_id, `cannot resolve buyer: ${supplierRelation.subject_resolve.surface}`);
  }

  const supplierResolution = await resolver.resolve(supplierRelation.object_resolve);
  if (supplierResolution.status !== "resolved" || supplierResolution.entity_id === undefined) {
    const pending = await recordPendingEntity(pool, {
      surface: supplierRelation.object_resolve.surface,
      context: {
        review_id: item.review_id,
        source_adapter_id: item.candidate.evidence.source_adapter_id,
        normalized_record_text: item.candidate.evidence.normalized_record_text,
        country_or_region: item.candidate.payload.country_or_region
      }
    });
    return blockReviewCandidate(pool, item.review_id, `cannot resolve supplier: ${supplierRelation.object_resolve.surface}`, pending.pending_id);
  }
  return { status: "ready", supplier_entity_id: supplierResolution.entity_id };
}

type FacilityPreparation =
  | {
      status: "ready";
      facilityImport: Extract<FacilityImportResult, { status: "applied" }>;
      facilityRelation: ReturnType<typeof supplierListReviewToFacilityRelation>;
    }
  | Extract<ReviewApplyResult, { status: "blocked" }>;

async function prepareSupplierListFacility(
  pool: pg.Pool,
  item: SupplierListReviewItem,
  resolver: DbEntityResolver,
  reviewer: string
): Promise<FacilityPreparation> {
  const facilityImport = await ensureSupplierListFacilityEntity(pool, item.candidate, reviewer);
  if (facilityImport.status === "blocked") return blockReviewCandidate(pool, item.review_id, facilityImport.reason);

  const facilityRelation = supplierListReviewToFacilityRelation(item.candidate, facilityImport.display_name);
  const facilityResolution = await resolver.resolve(facilityRelation.object_resolve);
  if (facilityResolution.status !== "resolved" || facilityResolution.entity_id === undefined) {
    getLogger().warn({ review_id: item.review_id, facility_entity_id: facilityImport.entity_id }, "facility entity was imported but could not be resolved by its canonical alias");
    return blockReviewCandidate(pool, item.review_id, `cannot resolve facility: ${facilityRelation.object_resolve.surface}`);
  }
  return { status: "ready", facilityImport, facilityRelation };
}

type LoadedReviewDocument = { status: "ready"; docId: string; document: DocumentWithChunks } | Extract<ReviewApplyResult, { status: "blocked" }>;

async function loadReviewDocument(pool: pg.Pool, item: SupplierListReviewItem): Promise<LoadedReviewDocument> {
  const docId = item.candidate.evidence.doc_id;
  if (docId === undefined) return blockReviewCandidate(pool, item.review_id, "supplier-list review candidate is missing doc_id");
  return { status: "ready", docId, document: await loadDocument(pool, docId) };
}

interface ScoredSupplierListRelations {
  supplierScoring: ApprovedCandidate["scoring"];
  facilityScoring: ApprovedCandidate["scoring"];
  supplierRelation: ReturnType<typeof supplierListReviewToSupplierRelation>;
  facilityRelation: ReturnType<typeof supplierListReviewToFacilityRelation>;
}

async function scoreSupplierListRelations(
  supplierRelation: ReturnType<typeof supplierListReviewToSupplierRelation>,
  facilityRelation: ReturnType<typeof supplierListReviewToFacilityRelation>,
  doc: DocumentWithChunks
): Promise<ScoredSupplierListRelations> {
  const scorer = new DeterministicEvidenceScorer();
  const supplierScoring = await scorer.score(supplierRelation, doc);
  const facilityScoring = await scorer.score(facilityRelation, doc);
  return {
    supplierRelation,
    facilityRelation,
    supplierScoring: { ...supplierScoring, needs_review: false },
    facilityScoring: { ...facilityScoring, needs_review: false }
  };
}

async function applySupplierListEdges(builder: GraphBuilder, scored: ScoredSupplierListRelations, docId: string, reviewer: string): Promise<[AppliedReviewEdgeResult, AppliedReviewEdgeResult]> {
  const reviewedAt = new Date().toISOString();
  const supplierApply = await applyReviewedRelation(builder, {
    candidate: scored.supplierRelation,
    scoring: scored.supplierScoring,
    approved_by: { reviewer, reviewed_at: reviewedAt },
    doc_id: docId
  });
  const facilityApply = await applyReviewedRelation(builder, {
    candidate: scored.facilityRelation,
    scoring: scored.facilityScoring,
    approved_by: { reviewer, reviewed_at: reviewedAt },
    doc_id: docId
  });
  return [
    { ...supplierApply, role: "supplier_relation", relation: scored.supplierRelation.relation },
    { ...facilityApply, role: "facility_relation", relation: scored.facilityRelation.relation }
  ];
}

async function blockReviewCandidate(pool: pg.Pool, reviewId: string, reason: string, pendingId?: string): Promise<Extract<ReviewApplyResult, { status: "blocked" }>> {
  await markReviewCandidateBlocked(pool, { reviewId, reason });
  return { status: "blocked", review_id: reviewId, reason, ...(pendingId === undefined ? {} : { pending_id: pendingId }) };
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
