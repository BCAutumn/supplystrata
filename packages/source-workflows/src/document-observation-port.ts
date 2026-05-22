import type { NormalizedDocument } from "@supplystrata/core";
import type { DbTxClient } from "@supplystrata/db";
import type { SourceDocumentChangeType } from "@supplystrata/source-monitor";

export interface SourceDocumentObservationPersistOptions {
  checkTargetId?: string;
}

export interface SourceDocumentObservationPersistResult {
  change_type: SourceDocumentChangeType;
  source_item_id: string;
  event_id: string;
  stored_observations: number;
  review_candidates: number;
  semantic_changes: number;
  relation_changes: number;
}

export interface SourceDocumentObservationStore {
  persistDocumentObservations(
    client: DbTxClient,
    normalized: NormalizedDocument,
    docId: string,
    options?: SourceDocumentObservationPersistOptions
  ): Promise<SourceDocumentObservationPersistResult>;
}
