import { type ApplyResult, type ApprovedCandidate } from "@supplystrata/core";
import { loadDocument, type DocumentWithChunks } from "@supplystrata/db/read";
import { recordPendingEntity, type DatabaseStore, type DbTxClient } from "@supplystrata/db/write";
import { ensureSupplierListFacilityEntity, resolvePendingEntitySurface, type FacilityImportResult } from "@supplystrata/entity-import";
import { DbEntityResolver } from "@supplystrata/entity-resolver";
import { DeterministicEvidenceScorer } from "@supplystrata/evidence-scorer";
import { GraphSqlWriter } from "@supplystrata/graph-builder";
import {
  supplierListFacilityDisplayName,
  supplierListReviewToFacilityRelation,
  supplierListReviewToSupplierRelation,
  type SupplierListReviewCandidate
} from "@supplystrata/review-candidates";
import { lockReviewCandidateForApply, markReviewCandidateApplied, type ReviewQueueItem } from "@supplystrata/review-store";
import { findSupplierListCitationWindow } from "@supplystrata/supplier-list";
import { locateCandidateCitation, type CitationLocation, type SavedChunkRef } from "./citation-location.js";
import { assertReviewItemKind, blockReviewCandidate } from "./review-apply-blocking.js";
import { isReviewItemApplicable, type AppliedReviewEdgeResult, type ReviewApplyOptions, type ReviewApplyResult, type SupplierListReviewItem } from "./review-apply-definitions.js";

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
    // 事务内先对 review 行加锁并复检状态，避免与并发 apply/decide 之间的 TOCTOU：
    // 只有锁定后仍处于可 apply 状态，才会继续写入 fact edge。
    const locked = await lockReviewCandidateForApply(client, reviewId);
    if (locked === undefined) return { status: "blocked", review_id: reviewId, reason: "review candidate not found at apply time" };
    if (!isReviewItemApplicable(locked)) {
      return { status: "blocked", review_id: reviewId, reason: `review candidate status changed to ${locked.status} before apply` };
    }
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
    const citationChunks = locateSupplierListCitations(doc.document, item.candidate, scored.supplierRelation, scored.facilityRelation);
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
  supplierCitation: SupplierListCitationBinding;
  facilityCitation: SupplierListCitationBinding;
}

interface SupplierListCitationBinding {
  chunkId: string;
  citeText: string;
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

export function locateSupplierListReviewCitations(
  doc: DocumentWithChunks,
  candidate: SupplierListReviewCandidate
): SupplierListCitationChunks | { status: "blocked"; reason: string } {
  return locateSupplierListCitations(
    doc,
    candidate,
    supplierListReviewToSupplierRelation(candidate),
    supplierListReviewToFacilityRelation(candidate, supplierListFacilityDisplayName(candidate))
  );
}

function locateSupplierListCitations(
  doc: DocumentWithChunks,
  candidate: SupplierListReviewCandidate,
  supplierRelation: ReturnType<typeof supplierListReviewToSupplierRelation>,
  facilityRelation: ReturnType<typeof supplierListReviewToFacilityRelation>
): SupplierListCitationChunks | { status: "blocked"; reason: string } {
  const supplierLocation = locateSupplierListCitation(doc.chunks, candidate, supplierRelation);
  if (supplierLocation.status !== "located") {
    return { status: "blocked", reason: `supplier relation citation is not uniquely located: ${supplierLocation.reason}` };
  }
  const facilityLocation = locateSupplierListCitation(doc.chunks, candidate, facilityRelation);
  if (facilityLocation.status !== "located") {
    return { status: "blocked", reason: `facility relation citation is not uniquely located: ${facilityLocation.reason}` };
  }
  return {
    status: "ready",
    supplierCitation: supplierLocation.binding,
    facilityCitation: facilityLocation.binding
  };
}

function locateSupplierListCitation(
  chunks: readonly SavedChunkRef[],
  candidate: SupplierListReviewCandidate,
  relation: ReturnType<typeof supplierListReviewToSupplierRelation> | ReturnType<typeof supplierListReviewToFacilityRelation>
): { status: "located"; binding: SupplierListCitationBinding; occurrence_count: number } | Exclude<CitationLocation, { status: "located" }> {
  const exact = locateCandidateCitation(chunks, relation);
  if (exact.status === "located" && relation.cite_text.length >= 30) {
    return { status: "located", binding: { chunkId: exact.chunk_id, citeText: relation.cite_text }, occurrence_count: exact.occurrence_count };
  }

  const rowContext = locateSupplierListRowContext(chunks, candidate);
  if (rowContext.status !== "located") return rowContext;
  const chunk = chunks.find((item) => item.chunk_id === rowContext.chunk_id);
  if (chunk === undefined) {
    return {
      status: "not_found",
      occurrence_count: 0,
      reason: "supplier-list row context matched a chunk that is no longer present"
    };
  }
  const citeText = supplierListCitationWindow(chunk.text, candidate);
  if (citeText === undefined) {
    return {
      status: "not_found",
      occurrence_count: 0,
      reason: "supplier-list row context could not be converted to an exact citation window"
    };
  }
  return { status: "located", binding: { chunkId: chunk.chunk_id, citeText }, occurrence_count: 1 };
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
      candidate: { ...scored.supplierRelation, cite_text: citationChunks.supplierCitation.citeText },
      scoring: scored.supplierScoring,
      approved_by: reviewed,
      doc_id: docId,
      chunk_id: citationChunks.supplierCitation.chunkId
    },
    client
  );
  const facilityApply = await applyReviewedRelation(
    sqlWriter,
    {
      candidate: { ...scored.facilityRelation, cite_text: citationChunks.facilityCitation.citeText },
      scoring: scored.facilityScoring,
      approved_by: reviewed,
      doc_id: docId,
      chunk_id: citationChunks.facilityCitation.chunkId
    },
    client
  );
  return [
    { ...supplierApply, role: "supplier_relation", relation: scored.supplierRelation.relation },
    { ...facilityApply, role: "facility_relation", relation: scored.facilityRelation.relation }
  ];
}

function supplierListCitationWindow(chunkText: string, candidate: SupplierListReviewCandidate): string | undefined {
  return findSupplierListCitationWindow({
    chunkText,
    supplierName: candidate.payload.supplier_name,
    sourceRowText: candidate.evidence.source_row_text,
    locationText: candidate.payload.location_text,
    countryOrRegion: candidate.payload.country_or_region
  });
}

async function applyReviewedRelation(sqlWriter: GraphSqlWriter, approved: ApprovedCandidate, client: DbTxClient): Promise<ApplyResult> {
  const committed = await sqlWriter.applyApprovedCandidate(client, approved);
  return { ...committed, graph_sync: { status: "deferred" } };
}
