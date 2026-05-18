import type { NormalizedDocument } from "@supplystrata/core";
import type { GraphSyncMode } from "@supplystrata/graph-builder";
import type { GraphStore } from "@supplystrata/graph-store";

export interface PipelineSummary {
  doc_id: string;
  fetched_url: string;
  chunks: number;
  candidates: number;
  applied_edges: number;
  observations: number;
  evidence_ids: string[];
  graph_sync: {
    synced: number;
    deferred: number;
    failed: number;
  };
}

export interface NormalizedPipelineInput {
  normalized: NormalizedDocument;
  fetchedUrl?: string;
  graphSyncMode?: GraphSyncMode;
  graphStore?: GraphStore;
}
