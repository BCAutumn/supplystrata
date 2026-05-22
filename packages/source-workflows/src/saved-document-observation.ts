import type { NormalizedDocument } from "@supplystrata/core";
import { type DbTxClient } from "@supplystrata/db";
import { recordDocumentObservation, type DocumentObservationResult } from "@supplystrata/source-monitor";
import type { SourceDocumentObservationStore } from "./document-observation-port.js";

export interface SavedDocumentObservationOptions {
  checkTargetId?: string;
}

export function recordSavedDocumentObservation(
  client: DbTxClient,
  normalized: NormalizedDocument,
  docId: string,
  options: SavedDocumentObservationOptions = {}
): Promise<DocumentObservationResult> {
  return recordDocumentObservation(client, {
    source_adapter_id: normalized.source_adapter_id,
    source_url: normalized.source_url,
    doc_id: docId,
    bytes_sha256: normalized.bytes_sha256,
    storage_key: normalized.storage_key,
    observed_at: normalized.fetched_at,
    ...(options.checkTargetId === undefined ? {} : { check_target_id: options.checkTargetId }),
    caused_by: "source-workflows"
  });
}

export const SAVED_DOCUMENT_OBSERVATION_STORE: SourceDocumentObservationStore = {
  async persistDocumentObservations(client, normalized, docId, options = {}) {
    const observation = await recordSavedDocumentObservation(client, normalized, docId, options);
    return {
      ...observation,
      stored_observations: 0,
      review_candidates: 0,
      semantic_changes: 0,
      relation_changes: 0
    };
  }
};
