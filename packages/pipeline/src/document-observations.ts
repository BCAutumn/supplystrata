import type { NormalizedDocument } from "@supplystrata/core";
import { loadDocument, type DbClient } from "@supplystrata/db/read";
import { recordSemanticChange, type DbTxClient, type SemanticChangeInput } from "@supplystrata/db/write";
import {
  extractDisclosureObservations,
  extractSemanticSections,
  type SemanticSectionKind,
  type SemanticSectionSnapshot
} from "@supplystrata/observation-extractor";
import { storeObservation } from "@supplystrata/observation-store";
import { recordDocumentObservation, type DocumentObservationResult } from "@supplystrata/source-monitor";
import { enqueueOfficialDisclosureSignalReviewCandidates } from "./official-disclosure-signal-candidates.js";
import { recordRelationSemanticChanges } from "./relation-semantic-changes.js";

export interface PersistDocumentObservationResult extends DocumentObservationResult {
  stored_observations: number;
  semantic_changes: number;
  relation_changes: number;
  review_candidates: number;
}

export interface PersistDocumentObservationOptions {
  checkTargetId?: string;
}

export async function recordSavedDocumentObservation(
  client: DbTxClient,
  normalized: NormalizedDocument,
  docId: string,
  options: PersistDocumentObservationOptions = {}
): Promise<DocumentObservationResult> {
  return recordDocumentObservation(client, {
    source_adapter_id: normalized.source_adapter_id,
    source_url: normalized.source_url,
    doc_id: docId,
    bytes_sha256: normalized.bytes_sha256,
    storage_key: normalized.storage_key,
    observed_at: normalized.fetched_at,
    ...(options.checkTargetId === undefined ? {} : { check_target_id: options.checkTargetId }),
    caused_by: "pipeline"
  });
}

export async function persistDocumentObservations(
  client: DbTxClient,
  normalized: NormalizedDocument,
  docId: string,
  options: PersistDocumentObservationOptions = {}
): Promise<PersistDocumentObservationResult> {
  const documentObservation = await recordSavedDocumentObservation(client, normalized, docId, options);
  const storedObservations = await storeOfficialDisclosureObservations(client, normalized, docId);
  const previous = await loadPreviousDocumentForChangedSourceItem(client, documentObservation);
  const semanticChanges =
    previous === undefined
      ? 0
      : await recordOfficialDisclosureSectionChanges(client, { previous, next: normalized, nextDocId: docId, observation: documentObservation });
  const relationChanges =
    previous === undefined
      ? 0
      : await recordRelationSemanticChanges(client, { previous, next: normalized, nextDocId: docId, sourceItemId: documentObservation.source_item_id });
  const reviewCandidates = await enqueueOfficialDisclosureSignalReviewCandidates(client, {
    normalized,
    docId,
    sourceItemId: documentObservation.source_item_id
  });
  return {
    ...documentObservation,
    stored_observations: storedObservations,
    semantic_changes: semanticChanges,
    relation_changes: relationChanges,
    review_candidates: reviewCandidates.inserted
  };
}

async function storeOfficialDisclosureObservations(client: DbClient, normalized: NormalizedDocument, docId: string): Promise<number> {
  const drafts = extractDisclosureObservations(normalized);
  let count = 0;
  for (const draft of drafts) {
    // 观测抽取器只产“官方披露观测”草稿；这里统一补 DB 文档 ID 并幂等写入。
    await storeObservation(client, { ...draft, doc_id: docId });
    count += 1;
  }
  return count;
}

async function recordOfficialDisclosureSectionChanges(
  client: DbClient,
  input: {
    previous: NormalizedDocument;
    next: NormalizedDocument;
    nextDocId: string;
    observation: DocumentObservationResult;
  }
): Promise<number> {
  const before = semanticSectionsByKey(extractSemanticSections(input.previous));
  const after = semanticSectionsByKey(extractSemanticSections(input.next));
  let count = 0;

  for (const [key, next] of after.entries()) {
    const prior = before.get(key);
    if (prior === undefined) {
      await recordSectionChange(client, {
        changeType: changeTypeForSection(next.section_kind, "added"),
        normalized: input.next,
        docId: input.nextDocId,
        sourceItemId: input.observation.source_item_id,
        next
      });
      count += 1;
      continue;
    }
    if (prior.fingerprint === next.fingerprint) continue;
    await recordSectionChange(client, {
      changeType: changeTypeForSection(next.section_kind, "changed"),
      normalized: input.next,
      docId: input.nextDocId,
      previousDocId: input.previous.doc_id,
      previousSourceUrl: input.previous.source_url,
      sourceItemId: input.observation.source_item_id,
      next,
      prior
    });
    count += 1;
  }

  for (const [key, prior] of before.entries()) {
    if (after.has(key)) continue;
    await recordSectionChange(client, {
      changeType: changeTypeForSection(prior.section_kind, "removed"),
      normalized: input.next,
      docId: input.nextDocId,
      previousDocId: input.previous.doc_id,
      previousSourceUrl: input.previous.source_url,
      sourceItemId: input.observation.source_item_id,
      prior
    });
    count += 1;
  }

  return count;
}

async function loadPreviousDocumentForChangedSourceItem(client: DbClient, observation: DocumentObservationResult): Promise<NormalizedDocument | undefined> {
  if (observation.change_type !== "DOCUMENT_CHANGED" || observation.previous_doc_id === null) return undefined;
  return loadDocument(client, observation.previous_doc_id);
}

function semanticSectionsByKey(sections: readonly SemanticSectionSnapshot[]): Map<string, SemanticSectionSnapshot> {
  return new Map(sections.map((section) => [semanticSectionKey(section), section]));
}

function semanticSectionKey(section: SemanticSectionSnapshot): string {
  return `${section.section_kind}:${section.scope_kind}:${section.scope_id}`;
}

function changeTypeForSection(sectionKind: SemanticSectionKind, status: "added" | "changed" | "removed"): string {
  const prefixByKind: Record<SemanticSectionKind, string> = {
    inventory: "INVENTORY",
    backlog: "BACKLOG",
    capex: "CAPEX",
    customer_concentration: "CUSTOMER_CONCENTRATION",
    procurement: "PROCUREMENT"
  };
  if (status === "added") return `${prefixByKind[sectionKind]}_SECTION_ADDED`;
  if (status === "removed") return `${prefixByKind[sectionKind]}_SECTION_REMOVED`;
  return `${prefixByKind[sectionKind]}_CHANGED`;
}

async function recordSectionChange(
  client: DbClient,
  input: {
    changeType: string;
    normalized: NormalizedDocument;
    docId: string;
    previousDocId?: string;
    previousSourceUrl?: string;
    sourceItemId: string;
    next?: SemanticSectionSnapshot;
    prior?: SemanticSectionSnapshot;
  }
): Promise<void> {
  const section = input.next ?? input.prior;
  if (section === undefined) throw new Error("Semantic section change requires a before or after snapshot");
  const change: SemanticChangeInput = {
    scope_kind: "source",
    scope_id: input.normalized.source_adapter_id,
    change_type: input.changeType,
    caused_by: "document-observations"
  };
  if (input.prior !== undefined) {
    change.before = sectionChangePayload(
      input.prior,
      input.previousDocId ?? input.docId,
      input.sourceItemId,
      input.previousSourceUrl ?? input.normalized.source_url
    );
  }
  if (input.next !== undefined) {
    change.after = sectionChangePayload(input.next, input.docId, input.sourceItemId, input.normalized.source_url);
  }
  await recordSemanticChange(client, change);
}

function sectionChangePayload(section: SemanticSectionSnapshot, docId: string, sourceItemId: string, sourceUrl: string): Record<string, unknown> {
  return {
    source_adapter_id: section.source_adapter_id,
    source_item_id: sourceItemId,
    doc_id: docId,
    source_url: sourceUrl,
    section_kind: section.section_kind,
    observation_type: section.observation_type,
    scope_kind: section.scope_kind,
    scope_id: section.scope_id,
    component_id: section.component_id,
    title: section.title,
    cite_text: section.cite_text,
    fingerprint: section.fingerprint
  };
}
