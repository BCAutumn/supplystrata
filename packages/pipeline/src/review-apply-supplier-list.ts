import { type ApplyResult, type ApprovedCandidate } from "@supplystrata/core";
import { loadDocument, type DocumentWithChunks } from "@supplystrata/db/read";
import { recordPendingEntity, type DatabaseStore, type DbTxClient } from "@supplystrata/db/write";
import { ensureSupplierListFacilityEntity, resolvePendingEntitySurface, type FacilityImportResult } from "@supplystrata/entity-import";
import { DbEntityResolver } from "@supplystrata/entity-resolver";
import { DeterministicEvidenceScorer } from "@supplystrata/evidence-scorer";
import { GraphSqlWriter } from "@supplystrata/graph-builder";
import { supplierListReviewToFacilityRelation, supplierListReviewToSupplierRelation, type SupplierListReviewCandidate } from "@supplystrata/review-candidates";
import { markReviewCandidateApplied, type ReviewQueueItem } from "@supplystrata/review-store";
import { locateCandidateCitation, type CitationLocation, type SavedChunkRef } from "./citation-location.js";
import { assertReviewItemKind, blockReviewCandidate } from "./review-apply-blocking.js";
import type { AppliedReviewEdgeResult, ReviewApplyOptions, ReviewApplyResult, SupplierListReviewItem } from "./review-apply-definitions.js";

export async function applySupplierListReviewStrategy(
  store: DatabaseStore,
  item: ReviewQueueItem,
  reviewer: string,
  options: Required<ReviewApplyOptions>
): Promise<ReviewApplyResult> {
  assertReviewItemKind(item, "supplier_list_row");
  return applySupplierListReviewCandidate(store, item, reviewer, options);
}

async function applySupplierListReviewCandidate(
  store: DatabaseStore,
  item: SupplierListReviewItem,
  reviewer: string,
  options: Required<ReviewApplyOptions>
): Promise<ReviewApplyResult> {
  return store.transaction(async (client) => {
    const reviewId = item.review_id;
    const supplierRelation = supplierListReviewToSupplierRelation(item.candidate);
    const resolver = new DbEntityResolver(client);
    const entityResolution = await resolveSupplierListEntities(client, item, resolver, supplierRelation);
    if (entityResolution.status === "blocked") return entityResolution;

    const facilityPreparation = await prepareSupplierListFacility(client, item, resolver, reviewer, options);
    if (facilityPreparation.status === "blocked") return facilityPreparation;
    const doc = await loadReviewDocument(client, item);
    if (doc.status === "blocked") return doc;
    if (item.reviewed_at === undefined) {
      return blockReviewCandidate(client, reviewId, "supplier list review candidate cannot be applied without reviewed_at");
    }
    const reviewedAt = item.reviewed_at;
    const scored = await scoreSupplierListRelations(supplierRelation, facilityPreparation.facilityRelation, doc.document, {
      reviewer,
      reviewed_at: reviewedAt
    });
    const citationChunks = locateSupplierListCitations(doc.document, item.candidate, scored);
    if (citationChunks.status === "blocked") return blockReviewCandidate(client, reviewId, citationChunks.reason);
    const sqlWriter = new GraphSqlWriter(resolver);
    const applyResults = await applySupplierListEdges(client, sqlWriter, scored, doc.docId, citationChunks, { reviewer, reviewed_at: reviewedAt });
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
  client: DbTxClient,
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
  client: DbTxClient,
  item: SupplierListReviewItem,
  resolver: DbEntityResolver,
  reviewer: string,
  options: Required<ReviewApplyOptions>
): Promise<FacilityPreparation> {
  const facilityImport = await ensureSupplierListFacilityEntity(client, item.candidate, reviewer);
  if (facilityImport.status === "blocked") return blockReviewCandidate(client, item.review_id, facilityImport.reason);

  const facilityRelation = supplierListReviewToFacilityRelation(item.candidate, facilityImport.display_name);
  const facilityResolution = await resolver.resolve(facilityRelation.object_resolve);
  if (facilityResolution.status !== "resolved" || facilityResolution.entity_id === undefined) {
    options.logger.warn(
      { review_id: item.review_id, facility_entity_id: facilityImport.entity_id },
      "facility entity was imported but could not be resolved by its canonical alias"
    );
    return blockReviewCandidate(client, item.review_id, `cannot resolve facility: ${facilityRelation.object_resolve.surface}`);
  }
  return { status: "ready", facilityImport, facilityRelation };
}

type LoadedReviewDocument = { status: "ready"; docId: string; document: DocumentWithChunks } | Extract<ReviewApplyResult, { status: "blocked" }>;

async function loadReviewDocument(client: DbTxClient, item: SupplierListReviewItem): Promise<LoadedReviewDocument> {
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
  candidate: SupplierListReviewCandidate,
  scored: ScoredSupplierListRelations
): SupplierListCitationChunks | { status: "blocked"; reason: string } {
  const supplierLocation = locateSupplierListCitation(doc.chunks, candidate, scored.supplierRelation);
  if (supplierLocation.status !== "located") {
    return { status: "blocked", reason: `supplier relation citation is not uniquely located: ${supplierLocation.reason}` };
  }
  const facilityLocation = locateSupplierListCitation(doc.chunks, candidate, scored.facilityRelation);
  if (facilityLocation.status !== "located") {
    return { status: "blocked", reason: `facility relation citation is not uniquely located: ${facilityLocation.reason}` };
  }
  return {
    status: "ready",
    supplierChunkId: supplierLocation.chunk_id,
    facilityChunkId: facilityLocation.chunk_id
  };
}

function locateSupplierListCitation(
  chunks: readonly SavedChunkRef[],
  candidate: SupplierListReviewCandidate,
  relation: ReturnType<typeof supplierListReviewToSupplierRelation> | ReturnType<typeof supplierListReviewToFacilityRelation>
): CitationLocation {
  const exact = locateCandidateCitation(chunks, relation);
  if (exact.status === "located") return exact;
  return locateSupplierListRowContext(chunks, candidate);
}

export function locateSupplierListRowContext(chunks: readonly SavedChunkRef[], candidate: SupplierListReviewCandidate): CitationLocation {
  const supplierName = normalizeSupplierListContext(candidate.payload.supplier_name);
  const rowText = normalizeSupplierListContext(candidate.evidence.source_row_text);
  const locationAndCountry = normalizeSupplierListContext(`${candidate.payload.location_text} ${candidate.payload.country_or_region}`);

  const matches = chunks.filter((chunk) => {
    const text = normalizeSupplierListContext(chunk.text);
    // Apple Supplier List 的 continuation row 经常只保留地点行。要求同一 chunk 同时出现供应商名和该行地点，
    // 这样保留 chunk 级可追溯性，同时避免把常见地点文本误匹配到别的供应商。
    if (!text.includes(supplierName)) return false;
    if (rowText.length > 0 && text.includes(rowText)) return true;
    return locationAndCountry.length > 0 && text.includes(locationAndCountry);
  });

  if (matches.length === 0) {
    return {
      status: "not_found",
      occurrence_count: 0,
      reason: "supplier-list row context is not present in persisted document chunks"
    };
  }
  if (matches.length > 1) {
    return {
      status: "ambiguous",
      occurrence_count: matches.length,
      reason: "supplier-list row context appears in multiple persisted chunks"
    };
  }
  const match = matches[0];
  if (match === undefined) {
    return {
      status: "not_found",
      occurrence_count: 0,
      reason: "supplier-list row context is not present in persisted document chunks"
    };
  }
  return { status: "located", chunk_id: match.chunk_id, occurrence_count: 1 };
}

function normalizeSupplierListContext(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim();
}

async function applySupplierListEdges(
  client: DbTxClient,
  sqlWriter: GraphSqlWriter,
  scored: ScoredSupplierListRelations,
  docId: string,
  citationChunks: SupplierListCitationChunks,
  reviewed: { reviewer: string; reviewed_at: string }
): Promise<[AppliedReviewEdgeResult, AppliedReviewEdgeResult]> {
  const supplierApply = await applyReviewedRelation(
    sqlWriter,
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
    sqlWriter,
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

async function applyReviewedRelation(sqlWriter: GraphSqlWriter, approved: ApprovedCandidate, client: DbTxClient): Promise<ApplyResult> {
  const committed = await sqlWriter.applyApprovedCandidate(client, approved);
  return { ...committed, graph_sync: { status: "deferred" } };
}
