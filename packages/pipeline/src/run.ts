import { type ApprovedCandidate, type CandidateRelation } from "@supplystrata/core";
import { saveNormalizedDocumentTx, type DatabaseStore } from "@supplystrata/db/write";
import { DbEntityResolver } from "@supplystrata/entity-resolver";
import { DeterministicEvidenceScorer } from "@supplystrata/evidence-scorer";
import { GraphBuilder } from "@supplystrata/graph-builder";
import { noopLogger } from "@supplystrata/observability";
import { ruleExtractors } from "@supplystrata/relation-extractor-rule";
import { isValidCandidate } from "./candidate-validation.js";
import { locateCandidateCitation } from "./citation-location.js";
import { persistDocumentObservations } from "./document-observations.js";
import type { NormalizedPipelineInput, PipelineSummary } from "./types.js";

export async function runSupplyChainPipelineFromNormalized(store: DatabaseStore, input: NormalizedPipelineInput): Promise<PipelineSummary> {
  const normalized = input.normalized;
  const logger = input.logger ?? noopLogger;
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
  let candidates = 0;
  let applied = 0;

  try {
    for (const extractor of ruleExtractors) {
      for await (const candidate of extractor.extract(normalized)) {
        candidates += 1;
        if (!isValidCandidate(candidate, normalized.text)) {
          logger.warn({ stage: "extract", extractor: candidate.extractor_id }, "candidate rejected by local validation");
          continue;
        }
        const scoring = await scorer.score(candidate, normalized);
        if (scoring.needs_review) {
          logger.warn({ stage: "score", candidate: candidate.extractor_id }, "candidate needs review and was not auto-applied");
          continue;
        }
        const citationLocation = locateCandidateCitation(savedDocument.chunks, candidate);
        if (citationLocation.status !== "located") {
          logger.warn(
            {
              stage: "citation-location",
              extractor: candidate.extractor_id,
              status: citationLocation.status,
              occurrence_count: citationLocation.occurrence_count,
              reason: citationLocation.reason
            },
            "candidate rejected because citation cannot be mapped to exactly one persisted chunk"
          );
          continue;
        }
        const approved: ApprovedCandidate = {
          candidate,
          scoring,
          approved_by: "auto",
          doc_id: savedDocument.doc_id,
          chunk_id: citationLocation.chunk_id
        };
        const result = await graphBuilder.apply(approved);
        evidenceIds.push(result.evidence_id);
        graphSync[result.graph_sync.status] += 1;
        applied += 1;
      }
    }
  } finally {
    await graphBuilder.close();
  }

  return {
    doc_id: savedDocument.doc_id,
    fetched_url: input.fetchedUrl ?? normalized.source_url,
    chunks: savedDocument.chunks.length,
    candidates,
    applied_edges: applied,
    observations: observationResult.stored_observations,
    evidence_ids: evidenceIds,
    graph_sync: graphSync
  };
}

export { isValidCandidate } from "./candidate-validation.js";
