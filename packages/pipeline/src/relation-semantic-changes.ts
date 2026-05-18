import type { CandidateRelation, NormalizedDocument, RelationType } from "@supplystrata/core";
import { recordSemanticChange, type DbClient } from "@supplystrata/db";
import { ruleExtractors } from "@supplystrata/relation-extractor-rule";
import { buildSemanticChangeReviewCandidate, type SemanticChangeReviewPayloadSnapshot } from "@supplystrata/review-candidates";
import { enqueueReviewCandidates } from "@supplystrata/review-store";
import { isValidCandidate } from "./candidate-validation.js";

export interface RelationSemanticChangeInput {
  previous: NormalizedDocument;
  next: NormalizedDocument;
  nextDocId: string;
  sourceItemId: string;
}

export async function recordRelationSemanticChanges(client: DbClient, input: RelationSemanticChangeInput): Promise<number> {
  const before = relationSnapshotsByKey(await extractRelationSnapshots(input.previous));
  const after = relationSnapshotsByKey(await extractRelationSnapshots(input.next));
  let count = 0;

  for (const [key, next] of after.entries()) {
    if (before.has(key)) continue;
    await recordRelationChange(client, {
      changeType: changeTypeForRelation(next, "added"),
      sourceAdapterId: input.next.source_adapter_id,
      sourceItemId: input.sourceItemId,
      nextDocId: input.nextDocId,
      nextSourceUrl: input.next.source_url,
      next
    });
    count += 1;
  }

  for (const [key, previous] of before.entries()) {
    if (after.has(key)) continue;
    await recordRelationChange(client, {
      changeType: changeTypeForRelation(previous, "removed"),
      sourceAdapterId: input.next.source_adapter_id,
      sourceItemId: input.sourceItemId,
      nextDocId: input.nextDocId,
      nextSourceUrl: input.next.source_url,
      previousDocId: input.previous.doc_id,
      previousSourceUrl: input.previous.source_url,
      previous
    });
    count += 1;
  }

  for (const [key, next] of after.entries()) {
    const previous = before.get(key);
    if (previous === undefined || previous.fingerprint === next.fingerprint || !shouldRecordRelationFingerprintChange(next)) continue;
    await recordRelationChange(client, {
      changeType: changeTypeForRelation(next, "changed"),
      sourceAdapterId: input.next.source_adapter_id,
      sourceItemId: input.sourceItemId,
      nextDocId: input.nextDocId,
      nextSourceUrl: input.next.source_url,
      previousDocId: input.previous.doc_id,
      previousSourceUrl: input.previous.source_url,
      next,
      previous
    });
    count += 1;
  }

  return count;
}

interface RelationSnapshot {
  relation: RelationType;
  semantic_kind: RelationSemanticKind;
  subject_surface: string;
  object_surface: string;
  component_id?: string;
  component?: string;
  component_specificity?: CandidateRelation["component_specificity"];
  extractor_id: string;
  cite_text: string;
  cite_locator: string;
  fingerprint: string;
}

type RelationSemanticKind =
  | "supplier_relation"
  | "customer_relation"
  | "foundry_relation"
  | "purchase_obligation"
  | "capacity_reservation"
  | "single_source_risk";

async function extractRelationSnapshots(document: NormalizedDocument): Promise<RelationSnapshot[]> {
  const snapshots: RelationSnapshot[] = [];
  const seen = new Set<string>();
  for (const extractor of ruleExtractors) {
    for await (const candidate of extractor.extract(document)) {
      if (!isValidCandidate(candidate, document.text)) continue;
      const snapshot = relationSnapshotFromCandidate(candidate);
      const key = relationSnapshotKey(snapshot);
      if (seen.has(key)) continue;
      seen.add(key);
      snapshots.push(snapshot);
    }
  }
  return snapshots;
}

function relationSnapshotFromCandidate(candidate: CandidateRelation): RelationSnapshot {
  const snapshot: RelationSnapshot = {
    relation: candidate.relation,
    semantic_kind: semanticKindForCandidate(candidate),
    subject_surface: normalizeSurface(candidate.subject_resolve.surface),
    object_surface: normalizeSurface(candidate.object_resolve.surface),
    extractor_id: candidate.extractor_id,
    cite_text: candidate.cite_text,
    cite_locator: candidate.cite_locator,
    fingerprint: relationFingerprint(candidate.cite_text)
  };
  if (candidate.component_id !== undefined) snapshot.component_id = candidate.component_id;
  if (candidate.component !== undefined) snapshot.component = normalizeSurface(candidate.component);
  if (candidate.component_specificity !== undefined) snapshot.component_specificity = candidate.component_specificity;
  return snapshot;
}

function relationSnapshotsByKey(items: readonly RelationSnapshot[]): Map<string, RelationSnapshot> {
  return new Map(items.map((item) => [relationSnapshotKey(item), item]));
}

function relationSnapshotKey(item: RelationSnapshot): string {
  return [
    item.semantic_kind,
    item.relation,
    item.subject_surface,
    item.object_surface,
    item.component_id ?? "",
    item.component ?? "",
    item.component_specificity ?? ""
  ].join("\u0001");
}

function changeTypeForRelation(snapshot: RelationSnapshot, status: "added" | "changed" | "removed"): string {
  const baseByKind: Record<RelationSemanticKind, string> = {
    supplier_relation: "SUPPLIER_RELATION",
    customer_relation: "CUSTOMER_RELATION",
    foundry_relation: "FOUNDRY_RELATION",
    purchase_obligation: "PURCHASE_OBLIGATION",
    capacity_reservation: "CAPACITY_RESERVATION",
    single_source_risk: "SINGLE_SOURCE_RISK"
  };
  return `${baseByKind[snapshot.semantic_kind]}_${status.toUpperCase()}`;
}

async function recordRelationChange(
  client: DbClient,
  input: {
    changeType: string;
    sourceAdapterId: string;
    sourceItemId: string;
    nextDocId: string;
    nextSourceUrl: string;
    previousDocId?: string;
    previousSourceUrl?: string;
    next?: RelationSnapshot;
    previous?: RelationSnapshot;
  }
): Promise<void> {
  await recordSemanticChange(client, {
    scope_kind: "source",
    scope_id: input.sourceAdapterId,
    change_type: input.changeType,
    ...(input.previous === undefined
      ? {}
      : {
          before: relationChangePayload(
            input.previous,
            input.previousDocId ?? input.nextDocId,
            input.sourceItemId,
            input.previousSourceUrl ?? input.nextSourceUrl
          )
        }),
    ...(input.next === undefined ? {} : { after: relationChangePayload(input.next, input.nextDocId, input.sourceItemId, input.nextSourceUrl) }),
    caused_by: "relation-semantic-changes"
  });
  await enqueueSemanticChangeReviewCandidate(client, input);
}

function relationChangePayload(snapshot: RelationSnapshot, docId: string, sourceItemId: string, sourceUrl: string): Record<string, unknown> {
  return {
    source_item_id: sourceItemId,
    doc_id: docId,
    source_url: sourceUrl,
    relation: snapshot.relation,
    semantic_relation_kind: snapshot.semantic_kind,
    subject_surface: snapshot.subject_surface,
    object_surface: snapshot.object_surface,
    component_id: snapshot.component_id,
    component: snapshot.component,
    component_specificity: snapshot.component_specificity,
    extractor_id: snapshot.extractor_id,
    cite_text: snapshot.cite_text,
    cite_locator: snapshot.cite_locator,
    fingerprint: snapshot.fingerprint
  };
}

async function enqueueSemanticChangeReviewCandidate(
  client: DbClient,
  input: {
    changeType: string;
    sourceAdapterId: string;
    sourceItemId: string;
    nextDocId: string;
    nextSourceUrl: string;
    previousDocId?: string;
    previousSourceUrl?: string;
    next?: RelationSnapshot;
    previous?: RelationSnapshot;
  }
): Promise<void> {
  const snapshot = input.next ?? input.previous;
  if (snapshot === undefined) throw new Error("Relation semantic review candidate requires a before or after snapshot");
  const docId = input.next === undefined ? (input.previousDocId ?? input.nextDocId) : input.nextDocId;
  const sourceUrl = input.next === undefined ? (input.previousSourceUrl ?? input.nextSourceUrl) : input.nextSourceUrl;
  await enqueueReviewCandidates(client, [
    buildSemanticChangeReviewCandidate({
      changeType: input.changeType,
      sourceItemId: input.sourceItemId,
      sourceUrl,
      snapshot: relationSnapshotToReviewPayload(snapshot, docId, input.sourceAdapterId)
    })
  ]);
}

function relationSnapshotToReviewPayload(snapshot: RelationSnapshot, docId: string, sourceAdapterId: string): SemanticChangeReviewPayloadSnapshot {
  return {
    doc_id: docId,
    source_adapter_id: sourceAdapterId,
    relation: snapshot.relation,
    semantic_relation_kind: snapshot.semantic_kind,
    subject_surface: snapshot.subject_surface,
    object_surface: snapshot.object_surface,
    cite_text: snapshot.cite_text,
    cite_locator: snapshot.cite_locator,
    fingerprint: snapshot.fingerprint,
    extractor_id: snapshot.extractor_id,
    ...(snapshot.component_id === undefined ? {} : { component_id: snapshot.component_id }),
    ...(snapshot.component === undefined ? {} : { component: snapshot.component }),
    ...(snapshot.component_specificity === undefined ? {} : { component_specificity: snapshot.component_specificity })
  };
}

function normalizeSurface(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

function semanticKindForCandidate(candidate: CandidateRelation): RelationSemanticKind {
  if (candidate.relation === "SUPPLIES_TO") return "customer_relation";
  if (candidate.relation === "USES_FOUNDRY") return "foundry_relation";
  if (isCapacityReservationDisclosure(candidate.cite_text)) return "capacity_reservation";
  if (isPurchaseObligationDisclosure(candidate.cite_text)) return "purchase_obligation";
  if (isSingleSourceRiskDisclosure(candidate.cite_text)) return "single_source_risk";
  return "supplier_relation";
}

function shouldRecordRelationFingerprintChange(snapshot: RelationSnapshot): boolean {
  return (
    snapshot.semantic_kind === "purchase_obligation" || snapshot.semantic_kind === "capacity_reservation" || snapshot.semantic_kind === "single_source_risk"
  );
}

function isCapacityReservationDisclosure(text: string): boolean {
  return /\b(?:capacity reservations?|capacity commitments?|prepayments?)\b/i.test(text);
}

function isPurchaseObligationDisclosure(text: string): boolean {
  return /\b(?:purchase obligations?|purchase commitments?|long[-\s]?term supply agreements?|wafer supply agreements?|take[-\s]?or[-\s]?pay)\b/i.test(text);
}

function isSingleSourceRiskDisclosure(text: string): boolean {
  return /\b(?:sole source|single source|single-source|sole supplier|limited number of suppliers|limited suppliers)\b/i.test(text);
}

function relationFingerprint(text: string): string {
  return normalizeSurface(text).replace(/[^\p{L}\p{N}.$% -]+/gu, "");
}
