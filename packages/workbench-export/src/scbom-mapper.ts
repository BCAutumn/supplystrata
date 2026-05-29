import { createHash } from "node:crypto";
import type {
  ScbomAssessment,
  ScbomChange,
  ScbomDocument,
  ScbomEntity,
  ScbomEvidence,
  ScbomIdentifier,
  ScbomObject,
  ScbomObservation,
  ScbomProducer,
  ScbomProvenance,
  ScbomRelationship,
  ScbomUnknown
} from "@scbom/spec";
import type { ChainEndpointKind, SemanticLayer } from "@supplystrata/core";
import type { ChainViewEndpoint } from "@supplystrata/chain-view";
import type { WorkbenchChangeTimelineItem, WorkbenchEdge, WorkbenchEvidence, WorkbenchModel, WorkbenchUnknownItem } from "./definitions.js";
import { assertScbomDocument } from "./scbom-validator.js";

const SCBOM_SCHEMA_VERSION = "0.0.1";
type ScbomEntityKind = NonNullable<ScbomEntity["entity_kind"]>;

const SUPPLYSTRATA_PRODUCER: ScbomProducer = {
  name: "SupplyStrata",
  version: "0.1.0",
  homepage: "https://github.com/BCAutumn/supplystrata"
};

export function toScbomDocument(model: WorkbenchModel): ScbomDocument {
  const context = createScbomContext(model);
  const objects: ScbomObject[] = [
    ...scbomEntities(model, context),
    ...scbomEvidences(model, context),
    ...scbomRelationships(model, context),
    ...scbomObservations(model, context),
    ...scbomUnknowns(model, context),
    ...scbomChanges(model, context)
  ];

  const document: ScbomDocument = {
    schema_version: SCBOM_SCHEMA_VERSION,
    document_id: scbomId(`document:${model.selected_company_id}:${model.generated_at}`),
    generated_at: model.generated_at,
    producer: SUPPLYSTRATA_PRODUCER,
    objects
  };
  assertScbomDocument(document);
  return document;
}

interface ScbomContext {
  readonly generatedAt: string;
  readonly rootEntityId: string;
  readonly entityIds: ReadonlySet<string>;
  readonly evidenceIds: ReadonlySet<string>;
  readonly relationshipIds: ReadonlySet<string>;
  readonly objectIds: ReadonlySet<string>;
}

function createScbomContext(model: WorkbenchModel): ScbomContext {
  const entityIds = new Set<string>();
  entityIds.add(model.selected_company_id);
  for (const company of model.companies) entityIds.add(company.entity_id);
  for (const segment of model.chain_segments) {
    entityIds.add(segment.from.id);
    entityIds.add(segment.to.id);
  }

  const evidenceIds = new Set(model.evidences.map((evidence) => evidence.evidence_id));
  // SCBOM relationship 必须可回链到已导出的 evidence；脏 edge 只能留在本地审计层，不能进入可发布包。
  const relationshipIds = new Set(model.edges.filter((edge) => hasExistingEvidenceRef(edge.evidence_ids, evidenceIds)).map((edge) => edge.edge_id));
  return {
    generatedAt: model.generated_at,
    rootEntityId: model.selected_company_id,
    entityIds,
    evidenceIds,
    relationshipIds,
    objectIds: new Set([...entityIds, ...evidenceIds, ...relationshipIds])
  };
}

function scbomEntities(model: WorkbenchModel, context: ScbomContext): ScbomEntity[] {
  const byId = new Map<string, ScbomEntity>();
  for (const company of model.companies) {
    byId.set(company.entity_id, scbomEntity({ id: company.entity_id, name: company.name, kind: "company" }, context));
  }
  byId.set(model.chain.root.id, scbomEntity({ id: model.chain.root.id, name: model.chain.root.name, kind: model.chain.root.kind }, context));
  for (const segment of model.chain_segments) {
    byId.set(segment.from.id, scbomEntity(segment.from, context));
    byId.set(segment.to.id, scbomEntity(segment.to, context));
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function scbomEntity(endpoint: ChainViewEndpoint, context: ScbomContext): ScbomEntity {
  return {
    object_type: "entity",
    id: scbomId(endpoint.id),
    name: endpoint.name,
    entity_kind: entityKind(endpoint.kind),
    identifiers: [producerIdentifier(endpoint)],
    provenance: provenance(context, "workbench-export.toScbomDocument.entity")
  };
}

function scbomEvidences(model: WorkbenchModel, context: ScbomContext): ScbomEvidence[] {
  return model.evidences.map((evidence) => {
    const publishedAt = toIsoLikeDateTime(evidence.source_date);
    return {
      object_type: "evidence",
      id: scbomId(evidence.evidence_id),
      source: {
        title: evidence.document_type,
        url: evidence.source_url,
        publisher: evidence.source_adapter_id,
        ...(publishedAt === undefined ? {} : { published_at: publishedAt }),
        retrieved_at: evidence.fetched_at
      },
      citation: { text: evidence.cite_text },
      locator: evidenceLocator(evidence),
      fingerprint: evidenceFingerprint(evidence),
      assessments: evidenceAssessments(evidence),
      provenance: provenance(context, "workbench-export.toScbomDocument.evidence")
    };
  });
}

function scbomRelationships(model: WorkbenchModel, context: ScbomContext): ScbomRelationship[] {
  return model.edges.flatMap((edge) => {
    if (!context.relationshipIds.has(edge.edge_id)) return [];
    const evidenceRefs = existingEvidenceRefs(edge.evidence_ids, context);
    return [
      {
        object_type: "relationship",
        id: scbomId(edge.edge_id),
        subject_ref: scbomId(edge.from_id),
        predicate: edge.relation,
        object_ref: scbomId(edge.to_id),
        evidence_refs: evidenceRefs,
        validity: { status: "active" },
        assessments: edgeAssessments(edge),
        provenance: provenance(context, "workbench-export.toScbomDocument.relationship", evidenceRefs)
      }
    ];
  });
}

function scbomObservations(model: WorkbenchModel, context: ScbomContext): ScbomObservation[] {
  return model.chain_segments.flatMap((segment) => {
    if (segment.semantic_layer !== "observation" || segment.observation_id === undefined) return [];
    const evidenceRefs = existingEvidenceRefs(segment.evidence_ids, context);
    return [
      {
        object_type: "observation",
        id: scbomId(segment.observation_id),
        scope_ref: scopeRef(segment.from.id, context),
        observation_kind: "chain_view_observation",
        statement: segment.label,
        does_not_assert_relationship: true,
        ...(evidenceRefs.length === 0 ? {} : { evidence_refs: evidenceRefs }),
        assessments: confidenceAssessment(segment.confidence),
        provenance: provenance(context, "workbench-export.toScbomDocument.observation", evidenceRefs)
      }
    ];
  });
}

function scbomUnknowns(model: WorkbenchModel, context: ScbomContext): ScbomUnknown[] {
  return model.unknown_items.map((unknown) => {
    const evidenceRefs = existingEvidenceRefs(unknown.proxies, context);
    return {
      object_type: "unknown",
      id: scbomId(unknown.unknown_id),
      scope_ref: scopeRef(unknown.scope_id, context),
      question: unknown.question,
      status: unknownStatus(unknown),
      reason: unknown.why_unknown,
      ...(evidenceRefs.length === 0 ? {} : { evidence_refs: evidenceRefs }),
      provenance: provenance(context, "workbench-export.toScbomDocument.unknown", evidenceRefs)
    };
  });
}

function scbomChanges(model: WorkbenchModel, context: ScbomContext): ScbomChange[] {
  return model.changes.filter(isScbomChangeCandidate).map((change) => {
    const evidenceRefs = existingEvidenceRefs(changeEvidenceRefs(change), context);
    return {
      object_type: "change",
      id: scbomId(change.event_id),
      changed_object_ref: changedObjectRef(change, context),
      change_type: changeType(change),
      changed_at: change.occurred_at,
      summary: changeSummary(change),
      ...(evidenceRefs.length === 0 ? {} : { evidence_refs: evidenceRefs }),
      provenance: provenance(context, "workbench-export.toScbomDocument.change", evidenceRefs)
    };
  });
}

function isScbomChangeCandidate(change: WorkbenchChangeTimelineItem): boolean {
  return change.event_family !== "risk";
}

function changedObjectRef(change: WorkbenchChangeTimelineItem, context: ScbomContext): string {
  for (const candidate of [change.edge_id, change.evidence_id, change.scope_id, change.subject_id, change.object_id]) {
    if (candidate !== undefined && context.objectIds.has(candidate)) return scbomId(candidate);
  }
  return scbomId(context.rootEntityId);
}

function changeEvidenceRefs(change: WorkbenchChangeTimelineItem): string[] {
  return [change.evidence_id, change.superseded_by_evidence_id, ...(change.superseded_evidence_ids ?? [])].filter(isDefinedString);
}

function changeType(change: WorkbenchChangeTimelineItem): ScbomChange["change_type"] {
  const value = `${change.event_type} ${change.caused_by}`.toLowerCase();
  if (value.includes("create") || value.includes("insert")) return "created";
  if (value.includes("correct")) return "corrected";
  if (value.includes("supersede")) return "superseded";
  if (value.includes("withdraw") || value.includes("deprecat")) return "withdrawn";
  if (value.includes("resolve")) return "resolved";
  return "updated";
}

function changeSummary(change: WorkbenchChangeTimelineItem): string {
  return `${change.event_type} (${change.event_family})`;
}

function entityKind(kind: ChainEndpointKind): ScbomEntityKind {
  switch (kind) {
    case "company":
    case "entity":
      return "legal_entity";
    case "facility":
      return "facility";
    case "component":
      return "component";
    case "document":
      return "other";
    case "country":
    case "port":
    case "vessel":
    case "carrier":
    case "mineral":
    case "route":
      return "other";
  }
}

function producerIdentifier(endpoint: ChainViewEndpoint): ScbomIdentifier {
  return {
    namespace: `supplystrata.${endpoint.kind}_id`,
    value: endpoint.id,
    authority: "SupplyStrata local cache"
  };
}

function evidenceLocator(evidence: WorkbenchEvidence): ScbomEvidence["locator"] {
  if (evidence.cite_locator !== null) return { kind: "locator", value: evidence.cite_locator };
  if (evidence.cite_start_char !== null && evidence.cite_end_char !== null)
    return { kind: "text_range", value: `${evidence.cite_start_char}-${evidence.cite_end_char}` };
  return { kind: "source", value: evidence.evidence_id };
}

function evidenceFingerprint(evidence: WorkbenchEvidence): ScbomEvidence["fingerprint"] {
  for (const [algorithm, value] of [
    ["sha256:normalized_citation", evidence.normalized_cite_text_sha256],
    ["sha256:citation", evidence.cite_text_sha256],
    ["sha256:source_snapshot", evidence.source_snapshot_sha256],
    ["hash:relation_candidate", evidence.relation_candidate_hash]
  ] as const) {
    if (value !== null && value.length >= 8) return { algorithm, value };
  }
  return {
    algorithm: "sha256:generated_from_citation",
    value: createHash("sha256")
      .update(`${evidence.source_url}\n${evidence.cite_locator ?? ""}\n${evidence.cite_text}`)
      .digest("hex")
  };
}

function evidenceAssessments(evidence: WorkbenchEvidence): ScbomAssessment[] {
  return [
    ...confidenceAssessment(evidence.confidence),
    {
      scheme: "urn:supplystrata:vocab:evidence_level",
      value: evidence.evidence_level,
      confidence: evidence.confidence
    },
    {
      scheme: "urn:supplystrata:vocab:extraction_method",
      value: evidence.extraction_method,
      confidence: evidence.confidence
    }
  ];
}

function edgeAssessments(edge: WorkbenchEdge): ScbomAssessment[] {
  return [
    ...confidenceAssessment(edge.confidence),
    {
      scheme: "urn:supplystrata:vocab:evidence_level",
      value: edge.evidence_level,
      confidence: edge.confidence
    },
    ...(edge.component === null
      ? []
      : [
          {
            scheme: "urn:supplystrata:vocab:component",
            value: edge.component,
            confidence: edge.confidence
          }
        ])
  ];
}

function confidenceAssessment(confidence: number): ScbomAssessment[] {
  return [
    {
      scheme: "urn:scbom:vocab:confidence",
      value: confidence,
      confidence
    }
  ];
}

function unknownStatus(unknown: WorkbenchUnknownItem): ScbomUnknown["status"] {
  switch (unknown.status) {
    case "resolved":
      return "resolved";
    case "superseded":
      return "superseded";
    case "withdrawn":
      return "withdrawn";
    default:
      return "open";
  }
}

function existingEvidenceRefs(evidenceIds: readonly string[], context: ScbomContext): string[] {
  return [...new Set(evidenceIds.filter((evidenceId) => context.evidenceIds.has(evidenceId)).map(scbomId))].sort();
}

function hasExistingEvidenceRef(evidenceIds: readonly string[], exportedEvidenceIds: ReadonlySet<string>): boolean {
  return evidenceIds.some((evidenceId) => exportedEvidenceIds.has(evidenceId));
}

function scopeRef(scopeId: string, context: ScbomContext): string {
  return scbomId(context.objectIds.has(scopeId) ? scopeId : context.rootEntityId);
}

function provenance(context: ScbomContext, method: string, sourceRefs: readonly string[] = []): ScbomProvenance {
  return {
    producer: SUPPLYSTRATA_PRODUCER,
    generated_at: context.generatedAt,
    method,
    ...(sourceRefs.length === 0 ? {} : { source_refs: [...sourceRefs].sort() })
  };
}

function toIsoLikeDateTime(value: string | null): string | undefined {
  if (value === null) return undefined;
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return `${value}T00:00:00.000Z`;
  return value;
}

function scbomId(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_.:-]/g, "_");
  if (/^[A-Za-z][A-Za-z0-9_.:-]{2,127}$/.test(normalized)) return normalized;
  return `s:${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function isDefinedString(value: string | undefined): value is string {
  return value !== undefined;
}
