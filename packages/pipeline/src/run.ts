import { saveNormalizedDocumentTx, type DatabaseStore } from "@supplystrata/db/write";
import { DbEntityResolver } from "@supplystrata/entity-resolver";
import { DeterministicEvidenceScorer } from "@supplystrata/evidence-scorer";
import { GraphBuilder } from "@supplystrata/graph-builder";
import { noopLogger } from "@supplystrata/observability";
import { persistDocumentObservations } from "./document-observations.js";
import { decideAutoPromotableCandidates, recordUnresolvedCounterpartyUnknowns } from "./promote-document-facts.js";
import type { NormalizedPipelineInput, PipelineSummary } from "./types.js";

export async function runSupplyChainPipelineFromNormalized(store: DatabaseStore, input: NormalizedPipelineInput): Promise<PipelineSummary> {
  const normalized = input.normalized;
  const logger = input.logger ?? noopLogger;
  // 自动通过的候选也必须携带审计时间；默认绑定到文档抓取时间，避免 graph-builder 在写库时隐式取当前时钟。
  const autoReviewedAt = input.autoReviewedAt ?? normalized.fetched_at;
  const { savedDocument, observationResult } = await store.transaction(async (client) => {
    const documentRef = await saveNormalizedDocumentTx(client, normalized);
    const observations = await persistDocumentObservations(client, normalized, documentRef.doc_id);
    return { savedDocument: documentRef, observationResult: observations };
  });

  const resolver = new DbEntityResolver(store.read);
  const scorer = new DeterministicEvidenceScorer();
  const graphBuilder = new GraphBuilder(store, resolver, {
    graphSyncMode: input.graphSyncMode ?? "defer",
    ...(input.graphStore === undefined ? {} : { graphStore: input.graphStore }),
    logger
  });
  const evidenceIds: string[] = [];
  const graphSync = { synced: 0, deferred: 0, failed: 0 };
  let applied = 0;

  const decision = await decideAutoPromotableCandidates({
    normalized,
    chunks: savedDocument.chunks,
    docId: savedDocument.doc_id,
    scorer,
    resolver,
    autoReviewedAt,
    logger
  });

  try {
    for (const approved of decision.approved) {
      const result = await graphBuilder.apply(approved);
      evidenceIds.push(result.evidence_id);
      graphSync[result.graph_sync.status] += 1;
      applied += 1;
    }
  } finally {
    await graphBuilder.close();
  }

  const unknownResult = await recordUnresolvedCounterpartyUnknowns(store, decision.unresolved_counterparties, "auto-promote:pipeline");

  return {
    doc_id: savedDocument.doc_id,
    fetched_url: input.fetchedUrl ?? normalized.source_url,
    chunks: savedDocument.chunks.length,
    candidates: decision.candidates,
    applied_edges: applied,
    unresolved_counterparties: unknownResult.recorded,
    recorded_unknowns: unknownResult.inserted,
    observations: observationResult.stored_observations,
    evidence_ids: evidenceIds,
    graph_sync: graphSync
  };
}

export { isValidCandidate } from "./candidate-validation.js";
