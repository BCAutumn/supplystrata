import type { CandidateRelation, DocumentType, NormalizedDocument, ResolveResult } from "@supplystrata/core";
import type { GraphSyncMode } from "@supplystrata/graph-builder";
import type { GraphStore } from "@supplystrata/graph-store";
import type { AppleSupplierCandidate } from "@supplystrata/sources-apple-suppliers";
import type { OfficialDisclosureSignal } from "@supplystrata/signal-extractor";

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

export interface SupplyChainPreviewCandidate {
  relation: CandidateRelation["relation"];
  subject_surface: string;
  subject_resolution: ResolveResult["status"];
  subject_entity_id?: string;
  subject_name?: string;
  object_surface: string;
  object_resolution: ResolveResult["status"];
  object_entity_id?: string;
  object_name?: string;
  component?: string;
  evidence_level: number;
  confidence: number;
  is_inferred: boolean;
  needs_review: boolean;
  extractor_id: string;
  cite_text: string;
  cite_locator: string;
}

export interface SupplyChainPreview {
  doc_id: string;
  fetched_url: string;
  document_type: DocumentType;
  source_date?: string;
  chunks: number;
  candidates: SupplyChainPreviewCandidate[];
}

export type TsmcIrSignal = OfficialDisclosureSignal;

export interface OfficialDisclosurePreview {
  doc_id: string;
  source_adapter_id: string;
  fetched_url: string;
  source_date?: string;
  chunks: number;
  signals: TsmcIrSignal[];
  error_message?: string;
}

export interface TsmcIrPreview {
  doc_id: string;
  fetched_url: string;
  source_date?: string;
  chunks: number;
  mentions_nvidia: boolean;
  signals: TsmcIrSignal[];
}

export interface NvidiaResearchReportPreview {
  nvidia: SupplyChainPreview;
  tsmc: TsmcIrPreview;
  samsung: OfficialDisclosurePreview;
  skhynix: OfficialDisclosurePreview;
  asml: OfficialDisclosurePreview;
}

export interface AppleSuppliersPreview {
  doc_id: string;
  fetched_url: string;
  source_date?: string;
  chunks: number;
  candidates: AppleSupplierCandidate[];
}

export interface ReviewEnqueueSummary {
  doc_id: string;
  source_url: string;
  candidates: number;
  inserted: number;
  skipped: number;
}
