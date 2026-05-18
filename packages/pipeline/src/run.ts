import { type ApprovedCandidate, type CandidateRelation } from "@supplystrata/core";
import { saveNormalizedDocument, type DatabaseStore } from "@supplystrata/db";
import { DbEntityResolver } from "@supplystrata/entity-resolver";
import { DeterministicEvidenceScorer } from "@supplystrata/evidence-scorer";
import { GraphBuilder } from "@supplystrata/graph-builder";
import { getLogger } from "@supplystrata/observability";
import { ruleExtractors } from "@supplystrata/relation-extractor-rule";
import { isValidCandidate } from "./candidate-validation.js";
import { persistDocumentObservations } from "./document-observations.js";
import type { NormalizedPipelineInput, PipelineSummary } from "./types.js";

export async function runSupplyChainPipelineFromNormalized(store: DatabaseStore, input: NormalizedPipelineInput): Promise<PipelineSummary> {
  const normalized = input.normalized;
  const savedDocument = await saveNormalizedDocument(store, normalized);
  const observationResult = await persistDocumentObservations(store, normalized, savedDocument.doc_id);

  const resolver = new DbEntityResolver(store);
  const scorer = new DeterministicEvidenceScorer();
  const graphBuilder = new GraphBuilder(store, resolver, {
    graphSyncMode: input.graphSyncMode ?? "defer",
    ...(input.graphStore === undefined ? {} : { graphStore: input.graphStore })
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
          getLogger().warn({ stage: "extract", extractor: candidate.extractor_id }, "candidate rejected by local validation");
          continue;
        }
        const scoring = await scorer.score(candidate, normalized);
        if (scoring.needs_review) {
          getLogger().warn({ stage: "score", candidate: candidate.extractor_id }, "candidate needs review and was not auto-applied");
          continue;
        }
        const chunkId = savedDocument.chunks.find((chunk) => chunk.text.includes(candidate.cite_text))?.chunk_id;
        const approved: ApprovedCandidate = {
          candidate,
          scoring,
          approved_by: "auto",
          doc_id: savedDocument.doc_id,
          ...(chunkId === undefined ? {} : { chunk_id: chunkId })
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
