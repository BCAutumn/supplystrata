import { upsertSemanticChangeClaimDraft } from "@supplystrata/claim-builder";
import { type ApplyResult, type ApprovedCandidate, type RelationType } from "@supplystrata/core";
import {
  loadDocument,
  markLeadObservationPromoted,
  recordSemanticChange,
  recordPendingEntity,
  type DatabaseStore,
  type DbClient,
  type DbTxClient,
  type DocumentWithChunks
} from "@supplystrata/db";
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
  isClaimConflictReviewCandidate,
  isEntitySourceReviewCandidate,
  isOfficialDisclosureSignalReviewCandidate,
  isOshFacilityReviewCandidate,
  isSemanticChangeReviewCandidate,
  isSupplierListReviewCandidate,
  supplierListReviewToFacilityRelation,
  supplierListReviewToSupplierRelation,
  type SupplierListReviewCandidate
} from "@supplystrata/review-candidates";
import {
  claimApprovedReviewCandidates,
  getReviewCandidate,
  markReviewCandidateApplied,
  markReviewCandidateBlocked,
  type ReviewQueueItem
} from "@supplystrata/review-store";
import { getLogger, messageFromUnknown } from "@supplystrata/observability";
import { locateCandidateCitation } from "./citation-location.js";

export interface AppliedReviewEdgeResult extends ApplyResult {
  role: "supplier_relation" | "facility_relation";
  relation: RelationType;
}

export type ReviewApplyResult =
  | {
      status: "applied";
      review_id: string;
      apply_results: AppliedReviewEdgeResult[];
      pending_entities_resolved: number;
      facility_import: Extract<FacilityImportResult, { status: "applied" }>;
    }
  | { status: "entity_applied"; review_id: string; import_result: Extract<EntityImportResult, { status: "applied" }> }
  | { status: "acknowledged"; review_id: string; kind: "semantic_change"; claim_id: string; reason: string }
  | { status: "acknowledged"; review_id: string; kind: "osh_facility_candidate"; reason: string; lead_id?: string }
  | { status: "acknowledged"; review_id: string; kind: "claim_conflict_review"; claim_id: string; edge_id: string | null; reason: string }
  | { status: "acknowledged"; review_id: string; kind: "official_disclosure_signal"; signal_title: string; reason: string }
  | { status: "blocked"; review_id: string; reason: string; pending_id?: string };

export type ReviewApplyBatchItem = ReviewApplyResult | { status: "error"; review_id: string; reason: string };

export interface ReviewApplyBatchSummary {
  requested_limit: number;
  scanned: number;
  applied: number;
  applied_edges: number;
  entity_applied: number;
  acknowledged: number;
  blocked: number;
  errors: number;
  results: ReviewApplyBatchItem[];
}

type SupplierListReviewItem = ReviewQueueItem & { candidate: SupplierListReviewCandidate };

export async function applyApprovedReviewCandidate(store: DatabaseStore, reviewId: string, reviewer: string): Promise<ReviewApplyResult> {
  const item = await getReviewCandidate(store, reviewId);
  if (item === undefined) return { status: "blocked", review_id: reviewId, reason: "review candidate not found" };
  if (!canApplyReviewItem(item))
    return { status: "blocked", review_id: reviewId, reason: `review candidate status is ${item.status}, expected approved or blocked` };
  if (isEntitySourceReviewCandidate(item.candidate)) {
    return applyEntityReviewCandidate(store, item, reviewer);
  }
  if (isSupplierListReviewCandidate(item.candidate)) {
    return applySupplierListReviewCandidate(store, { ...item, candidate: item.candidate }, reviewer);
  }
  if (isSemanticChangeReviewCandidate(item.candidate)) {
    const candidate = item.candidate;
    return store.transaction(async (client) => {
      const draft = await upsertSemanticChangeClaimDraft(client, candidate, {
        ...(item.reviewed_at === undefined ? {} : { reviewed_at: item.reviewed_at }),
        caused_by: reviewer
      });
      const reason = `acknowledged semantic change review candidate and created draft claim ${draft.claim_id}; no graph edge is applied by design`;
      await markReviewCandidateApplied(client, { reviewId: item.review_id, reason });
      return { status: "acknowledged", review_id: item.review_id, kind: "semantic_change", claim_id: draft.claim_id, reason };
    });
  }
  if (isOshFacilityReviewCandidate(item.candidate)) {
    const candidate = item.candidate;
    return store.transaction(async (client) => {
      const sourceLeadId = candidate.payload.source_lead_id;
      if (sourceLeadId !== undefined) {
        await markLeadObservationPromoted(client, {
          leadId: sourceLeadId,
          reviewId: item.review_id,
          attrsPatch: {
            promoted_review_id: item.review_id,
            promoted_observation_id: candidate.payload.observation_id,
            promoted_osh_facility_id: candidate.payload.osh_candidate.os_id
          }
        });
      }
      const reason = `acknowledged OSH facility candidate ${candidate.payload.osh_candidate.os_id}; no graph edge is applied by design`;
      await markReviewCandidateApplied(client, { reviewId: item.review_id, reason });
      return {
        status: "acknowledged",
        review_id: item.review_id,
        kind: "osh_facility_candidate",
        reason,
        ...(sourceLeadId === undefined ? {} : { lead_id: sourceLeadId })
      };
    });
  }
  if (isClaimConflictReviewCandidate(item.candidate)) {
    const candidate = item.candidate;
    return store.transaction(async (client) => {
      const reason = `acknowledged claim conflict review for ${candidate.payload.claim_id}; no fact edge or claim status is changed by design`;
      await recordSemanticChange(client, {
        scope_kind: "claim",
        scope_id: candidate.payload.claim_id,
        change_type: "CLAIM_CONFLICT_REVIEW_APPLIED",
        after: {
          review_id: item.review_id,
          edge_id: candidate.payload.edge_id,
          conflict_state: candidate.payload.conflict_state,
          severity: candidate.payload.severity,
          recommended_action: candidate.payload.recommended_action,
          safe_write_status: candidate.payload.safe_write_status,
          edge_review_required: candidate.payload.edge_review_required,
          required_review_steps: candidate.payload.required_review_steps,
          fact_write_policy: candidate.payload.fact_write_policy
        },
        evidence_ids: candidate.payload.evidence_refs.map((ref) => ref.evidence_id),
        caused_by: reviewer
      });
      await markReviewCandidateApplied(client, { reviewId: item.review_id, reason });
      return {
        status: "acknowledged",
        review_id: item.review_id,
        kind: "claim_conflict_review",
        claim_id: candidate.payload.claim_id,
        edge_id: candidate.payload.edge_id,
        reason
      };
    });
  }
  if (isOfficialDisclosureSignalReviewCandidate(item.candidate)) {
    const candidate = item.candidate;
    return store.transaction(async (client) => {
      const reason = `acknowledged official disclosure signal ${candidate.payload.signal_title}; no fact edge is applied by design`;
      await recordSemanticChange(client, {
        scope_kind: "source",
        scope_id: candidate.payload.source_adapter_id,
        change_type: "OFFICIAL_DISCLOSURE_SIGNAL_REVIEW_APPLIED",
        after: {
          review_id: item.review_id,
          source_item_id: candidate.payload.source_item_id,
          doc_id: candidate.payload.doc_id,
          signal_title: candidate.payload.signal_title,
          evidence_level_hint: candidate.payload.evidence_level_hint,
          cite_locator: candidate.payload.cite_locator,
          fact_write_policy: candidate.payload.fact_write_policy
        },
        caused_by: reviewer
      });
      await markReviewCandidateApplied(client, { reviewId: item.review_id, reason });
      return {
        status: "acknowledged",
        review_id: item.review_id,
        kind: "official_disclosure_signal",
        signal_title: candidate.payload.signal_title,
        reason
      };
    });
  }
  return blockReviewCandidate(store, reviewId, `unsupported review candidate kind: ${item.kind}`);
}

function canApplyReviewItem(item: ReviewQueueItem): boolean {
  // blocked 候选允许人工补 seed/entity 后重试；批处理领取 approved 后会转成带 reviewed_at 的 in_review。
  return item.status === "approved" || item.status === "blocked" || (item.status === "in_review" && item.reviewed_at !== undefined);
}

async function applyEntityReviewCandidate(store: DatabaseStore, item: ReviewQueueItem, reviewer: string): Promise<ReviewApplyResult> {
  if (!isEntitySourceReviewCandidate(item.candidate)) {
    return blockReviewCandidate(store, item.review_id, `unsupported entity review candidate kind: ${item.kind}`);
  }
  const candidate = item.candidate;
  return store.transaction(async (client) => {
    const importResult = await applyEntitySourceReviewCandidate(client, candidate, reviewer);
    if (importResult.status === "blocked") return blockReviewCandidate(client, item.review_id, importResult.reason);
    await markReviewCandidateApplied(client, { reviewId: item.review_id, reason: `imported entity ${importResult.entity_id}` });
    return { status: "entity_applied", review_id: item.review_id, import_result: importResult };
  });
}

async function applySupplierListReviewCandidate(store: DatabaseStore, item: SupplierListReviewItem, reviewer: string): Promise<ReviewApplyResult> {
  return store.transaction(async (client) => {
    const reviewId = item.review_id;
    const supplierRelation = supplierListReviewToSupplierRelation(item.candidate);
    const resolver = new DbEntityResolver(client);
    const entityResolution = await resolveSupplierListEntities(client, item, resolver, supplierRelation);
    if (entityResolution.status === "blocked") return entityResolution;

    const facilityPreparation = await prepareSupplierListFacility(client, item, resolver, reviewer);
    if (facilityPreparation.status === "blocked") return facilityPreparation;
    const doc = await loadReviewDocument(client, item);
    if (doc.status === "blocked") return doc;
    const reviewedAt = new Date().toISOString();
    const scored = await scoreSupplierListRelations(supplierRelation, facilityPreparation.facilityRelation, doc.document, {
      reviewer,
      reviewed_at: reviewedAt
    });
    const citationChunks = locateSupplierListCitations(doc.document, scored);
    if (citationChunks.status === "blocked") return blockReviewCandidate(client, reviewId, citationChunks.reason);
    const builder = new GraphBuilder(store, resolver, { graphSyncMode: "defer" });
    const applyResults = await applySupplierListEdges(client, builder, scored, doc.docId, citationChunks, { reviewer, reviewed_at: reviewedAt });
    const pendingResolved = await resolvePendingEntitySurface(client, {
      surface: supplierRelation.object_resolve.surface,
      entityId: entityResolution.supplier_entity_id,
      reviewer
    });
    await markReviewCandidateApplied(client, { reviewId, reason: `applied edges ${applyResults.map((result) => result.edge_id).join(", ")}` });
    return {
      status: "applied",
      review_id: reviewId,
      apply_results: applyResults,
      pending_entities_resolved: pendingResolved,
      facility_import: facilityPreparation.facilityImport
    };
  });
}

type SupplierEntityResolution = { status: "ready"; supplier_entity_id: string } | Extract<ReviewApplyResult, { status: "blocked" }>;

async function resolveSupplierListEntities(
  client: DbClient,
  item: SupplierListReviewItem,
  resolver: DbEntityResolver,
  supplierRelation: ReturnType<typeof supplierListReviewToSupplierRelation>
): Promise<SupplierEntityResolution> {
  const buyerResolution = await resolver.resolve(supplierRelation.subject_resolve);
  if (buyerResolution.status !== "resolved" || buyerResolution.entity_id === undefined) {
    return blockReviewCandidate(client, item.review_id, `cannot resolve buyer: ${supplierRelation.subject_resolve.surface}`);
  }

  const supplierResolution = await resolver.resolve(supplierRelation.object_resolve);
  if (supplierResolution.status !== "resolved" || supplierResolution.entity_id === undefined) {
    const pending = await recordPendingEntity(client, {
      surface: supplierRelation.object_resolve.surface,
      context: {
        review_id: item.review_id,
        source_adapter_id: item.candidate.evidence.source_adapter_id,
        normalized_record_text: item.candidate.evidence.normalized_record_text,
        country_or_region: item.candidate.payload.country_or_region
      }
    });
    return blockReviewCandidate(client, item.review_id, `cannot resolve supplier: ${supplierRelation.object_resolve.surface}`, pending.pending_id);
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
  client: DbClient,
  item: SupplierListReviewItem,
  resolver: DbEntityResolver,
  reviewer: string
): Promise<FacilityPreparation> {
  const facilityImport = await ensureSupplierListFacilityEntity(client, item.candidate, reviewer);
  if (facilityImport.status === "blocked") return blockReviewCandidate(client, item.review_id, facilityImport.reason);

  const facilityRelation = supplierListReviewToFacilityRelation(item.candidate, facilityImport.display_name);
  const facilityResolution = await resolver.resolve(facilityRelation.object_resolve);
  if (facilityResolution.status !== "resolved" || facilityResolution.entity_id === undefined) {
    getLogger().warn(
      { review_id: item.review_id, facility_entity_id: facilityImport.entity_id },
      "facility entity was imported but could not be resolved by its canonical alias"
    );
    return blockReviewCandidate(client, item.review_id, `cannot resolve facility: ${facilityRelation.object_resolve.surface}`);
  }
  return { status: "ready", facilityImport, facilityRelation };
}

type LoadedReviewDocument = { status: "ready"; docId: string; document: DocumentWithChunks } | Extract<ReviewApplyResult, { status: "blocked" }>;

async function loadReviewDocument(client: DbClient, item: SupplierListReviewItem): Promise<LoadedReviewDocument> {
  const docId = item.candidate.evidence.doc_id;
  if (docId === undefined) return blockReviewCandidate(client, item.review_id, "supplier-list review candidate is missing doc_id");
  return { status: "ready", docId, document: await loadDocument(client, docId) };
}

interface ScoredSupplierListRelations {
  supplierScoring: ApprovedCandidate["scoring"];
  facilityScoring: ApprovedCandidate["scoring"];
  supplierRelation: ReturnType<typeof supplierListReviewToSupplierRelation>;
  facilityRelation: ReturnType<typeof supplierListReviewToFacilityRelation>;
}

interface SupplierListCitationChunks {
  status: "ready";
  supplierChunkId: string;
  facilityChunkId: string;
}

async function scoreSupplierListRelations(
  supplierRelation: ReturnType<typeof supplierListReviewToSupplierRelation>,
  facilityRelation: ReturnType<typeof supplierListReviewToFacilityRelation>,
  doc: DocumentWithChunks,
  reviewed: { reviewer: string; reviewed_at: string }
): Promise<ScoredSupplierListRelations> {
  const scorer = new DeterministicEvidenceScorer();
  const supplierScoring = await scorer.score(supplierRelation, doc, { reviewed });
  const facilityScoring = await scorer.score(facilityRelation, doc, { reviewed });
  return {
    supplierRelation,
    facilityRelation,
    supplierScoring,
    facilityScoring
  };
}

function locateSupplierListCitations(
  doc: DocumentWithChunks,
  scored: ScoredSupplierListRelations
): SupplierListCitationChunks | { status: "blocked"; reason: string } {
  const supplierLocation = locateCandidateCitation(doc.chunks, scored.supplierRelation);
  if (supplierLocation.status !== "located") {
    return { status: "blocked", reason: `supplier relation citation is not uniquely located: ${supplierLocation.reason}` };
  }
  const facilityLocation = locateCandidateCitation(doc.chunks, scored.facilityRelation);
  if (facilityLocation.status !== "located") {
    return { status: "blocked", reason: `facility relation citation is not uniquely located: ${facilityLocation.reason}` };
  }
  return {
    status: "ready",
    supplierChunkId: supplierLocation.chunk_id,
    facilityChunkId: facilityLocation.chunk_id
  };
}

async function applySupplierListEdges(
  client: DbTxClient,
  builder: GraphBuilder,
  scored: ScoredSupplierListRelations,
  docId: string,
  citationChunks: SupplierListCitationChunks,
  reviewed: { reviewer: string; reviewed_at: string }
): Promise<[AppliedReviewEdgeResult, AppliedReviewEdgeResult]> {
  const supplierApply = await applyReviewedRelation(
    builder,
    {
      candidate: scored.supplierRelation,
      scoring: scored.supplierScoring,
      approved_by: reviewed,
      doc_id: docId,
      chunk_id: citationChunks.supplierChunkId
    },
    client
  );
  const facilityApply = await applyReviewedRelation(
    builder,
    {
      candidate: scored.facilityRelation,
      scoring: scored.facilityScoring,
      approved_by: reviewed,
      doc_id: docId,
      chunk_id: citationChunks.facilityChunkId
    },
    client
  );
  return [
    { ...supplierApply, role: "supplier_relation", relation: scored.supplierRelation.relation },
    { ...facilityApply, role: "facility_relation", relation: scored.facilityRelation.relation }
  ];
}

async function blockReviewCandidate(
  client: DbClient,
  reviewId: string,
  reason: string,
  pendingId?: string
): Promise<Extract<ReviewApplyResult, { status: "blocked" }>> {
  await markReviewCandidateBlocked(client, { reviewId, reason });
  return { status: "blocked", review_id: reviewId, reason, ...(pendingId === undefined ? {} : { pending_id: pendingId }) };
}

export async function applyApprovedReviewCandidates(store: DatabaseStore, input: { reviewer: string; limit: number }): Promise<ReviewApplyBatchSummary> {
  const items = await store.transaction((client) => claimApprovedReviewCandidates(client, { limit: input.limit }));
  const results: ReviewApplyBatchItem[] = [];
  for (const item of items) {
    try {
      results.push(await applyApprovedReviewCandidate(store, item.review_id, input.reviewer));
    } catch (error) {
      const reason = messageFromUnknown(error);
      try {
        // 批处理已经把 approved 领取成 in_review；异常时必须显式落到 blocked，避免候选永远卡在领取态。
        await store.transaction((client) => markReviewCandidateBlocked(client, { reviewId: item.review_id, reason }));
      } catch (blockError) {
        results.push({
          status: "error",
          review_id: item.review_id,
          reason: `${reason}; additionally failed to block candidate: ${messageFromUnknown(blockError)}`
        });
        continue;
      }
      results.push({ status: "error", review_id: item.review_id, reason });
    }
  }
  const appliedItems = results.filter((item) => item.status === "applied");
  return {
    requested_limit: input.limit,
    scanned: items.length,
    applied: appliedItems.length,
    applied_edges: appliedItems.reduce((sum, item) => sum + item.apply_results.length, 0),
    entity_applied: results.filter((item) => item.status === "entity_applied").length,
    acknowledged: results.filter((item) => item.status === "acknowledged").length,
    blocked: results.filter((item) => item.status === "blocked").length,
    errors: results.filter((item) => item.status === "error").length,
    results
  };
}

async function applyReviewedRelation(builder: GraphBuilder, approved: ApprovedCandidate, client: DbTxClient): Promise<ApplyResult> {
  const committed = await builder.applySqlInTransaction(client, approved);
  return { ...committed, graph_sync: { status: "deferred" } };
}
