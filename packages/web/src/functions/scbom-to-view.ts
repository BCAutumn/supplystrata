import Graph from "graphology";
import type {
  ScbomAssessment,
  ScbomChange,
  ScbomDocument,
  ScbomEntity,
  ScbomEvidence,
  ScbomObject,
  ScbomObservation,
  ScbomRelationship,
  ScbomUnknown
} from "@scbom/spec";
import type {
  ScbomEvidenceVisualWeight,
  ScbomView,
  ScbomViewChange,
  ScbomViewEntity,
  ScbomViewEvidence,
  ScbomViewEvidenceRef,
  ScbomViewGraphEdge,
  ScbomViewGraphNode,
  ScbomViewObservation,
  ScbomViewRelationship,
  ScbomViewUnknown,
  ScbomViewWarning
} from "../definitions/scbom-view.js";

interface GraphNodeAttributes {
  readonly label: string;
  readonly kind: ScbomViewGraphNode["kind"];
}

interface GraphEdgeAttributes {
  readonly label: string;
  readonly kind: ScbomViewGraphEdge["kind"];
}

export function createScbomView(document: ScbomDocument): ScbomView {
  const warnings: ScbomViewWarning[] = [];
  const entities = sortedObjects(document.objects, "entity").map(toViewEntity);
  const evidences = sortedObjects(document.objects, "evidence").map(toViewEvidence);
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const evidenceById = new Map(evidences.map((evidence) => [evidence.id, evidence]));
  const evidenceTrail = (refs: readonly string[] | undefined, objectId: string): ScbomViewEvidenceRef[] => evidenceRefs(refs, evidenceById, warnings, objectId);

  const relationships = sortedObjects(document.objects, "relationship").map((relationship) =>
    toViewRelationship(relationship, entityById, evidenceTrail(relationship.evidence_refs, relationship.id))
  );

  return {
    metadata: {
      schema_version: document.schema_version,
      document_id: document.document_id,
      generated_at: document.generated_at,
      producer_name: document.producer.name
    },
    warnings,
    entities,
    evidences,
    relationships,
    observations: sortedObjects(document.objects, "observation").map((observation) =>
      toViewObservation(observation, evidenceTrail(observation.evidence_refs, observation.id))
    ),
    unknowns: sortedObjects(document.objects, "unknown").map((unknown) => toViewUnknown(unknown, evidenceTrail(unknown.evidence_refs, unknown.id))),
    changes: sortedObjects(document.objects, "change").map((change) => toViewChange(change, evidenceTrail(change.evidence_refs, change.id))),
    graph: buildGraphView(entities, relationships, warnings)
  };
}

function sortedObjects<TType extends ScbomObject["object_type"]>(
  objects: readonly ScbomObject[],
  objectType: TType
): Extract<ScbomObject, { object_type: TType }>[] {
  return objects
    .filter((object): object is Extract<ScbomObject, { object_type: TType }> => object.object_type === objectType)
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id));
}

function toViewEntity(entity: ScbomEntity): ScbomViewEntity {
  return {
    id: entity.id,
    name: entity.name,
    entity_kind: entity.entity_kind ?? "other",
    identifier_labels: entity.identifiers.map((identifier) => `${identifier.namespace}:${identifier.value}`)
  };
}

function toViewEvidence(evidence: ScbomEvidence): ScbomViewEvidence {
  const evidenceLevel = evidenceLevelFromAssessments(evidence.assessments);
  return {
    id: evidence.id,
    source_title: evidence.source.title,
    source_url: evidence.source.url,
    citation_text: evidence.citation.text,
    locator_label: `${evidence.locator.kind}:${evidence.locator.value}`,
    ...(evidenceLevel === undefined ? {} : { evidence_level: evidenceLevel }),
    visual_weight: visualWeightForEvidenceLevel(evidenceLevel),
    assessment_labels: assessmentLabels(evidence.assessments)
  };
}

function toViewRelationship(
  relationship: ScbomRelationship,
  entityById: ReadonlyMap<string, ScbomViewEntity>,
  evidenceTrail: readonly ScbomViewEvidenceRef[]
): ScbomViewRelationship {
  const evidenceLevel = evidenceLevelFromAssessments(relationship.assessments);
  return {
    id: relationship.id,
    subject_ref: relationship.subject_ref,
    subject_name: entityById.get(relationship.subject_ref)?.name ?? relationship.subject_ref,
    predicate: relationship.predicate,
    object_ref: relationship.object_ref,
    object_name: entityById.get(relationship.object_ref)?.name ?? relationship.object_ref,
    validity_status: relationship.validity.status,
    ...(evidenceLevel === undefined ? {} : { evidence_level: evidenceLevel }),
    visual_weight: visualWeightForEvidenceLevel(evidenceLevel),
    evidence_trail: evidenceTrail,
    assessment_labels: assessmentLabels(relationship.assessments)
  };
}

function toViewObservation(observation: ScbomObservation, evidenceTrail: readonly ScbomViewEvidenceRef[]): ScbomViewObservation {
  return {
    id: observation.id,
    scope_ref: observation.scope_ref,
    observation_kind: observation.observation_kind,
    statement: observation.statement,
    evidence_trail: evidenceTrail
  };
}

function toViewUnknown(unknown: ScbomUnknown, evidenceTrail: readonly ScbomViewEvidenceRef[]): ScbomViewUnknown {
  return {
    id: unknown.id,
    scope_ref: unknown.scope_ref,
    question: unknown.question,
    status: unknown.status,
    ...(unknown.reason === undefined ? {} : { reason: unknown.reason }),
    evidence_trail: evidenceTrail
  };
}

function toViewChange(change: ScbomChange, evidenceTrail: readonly ScbomViewEvidenceRef[]): ScbomViewChange {
  return {
    id: change.id,
    changed_object_ref: change.changed_object_ref,
    change_type: change.change_type,
    changed_at: change.changed_at,
    summary: change.summary,
    evidence_trail: evidenceTrail
  };
}

function evidenceRefs(
  refs: readonly string[] | undefined,
  evidenceById: ReadonlyMap<string, ScbomViewEvidence>,
  warnings: ScbomViewWarning[],
  objectId: string
): ScbomViewEvidenceRef[] {
  return (refs ?? []).map((evidenceId) => {
    const evidence = evidenceById.get(evidenceId);
    if (evidence === undefined) {
      warnings.push({
        code: "missing_ref",
        message: `Object ${objectId} references missing evidence ${evidenceId}`,
        object_id: objectId,
        ref: evidenceId
      });
      return { evidence_id: evidenceId };
    }
    return { evidence_id: evidenceId, evidence };
  });
}

function buildGraphView(
  entities: readonly ScbomViewEntity[],
  relationships: readonly ScbomViewRelationship[],
  warnings: ScbomViewWarning[]
): ScbomView["graph"] {
  const graph = new Graph<GraphNodeAttributes, GraphEdgeAttributes>({ type: "directed", multi: true });
  for (const entity of entities) graph.addNode(entity.id, { label: entity.name, kind: "entity" });

  for (const relationship of relationships) {
    if (!graph.hasNode(relationship.subject_ref) || !graph.hasNode(relationship.object_ref)) {
      warnings.push({
        code: "missing_ref",
        message: `Relationship ${relationship.id} references a missing graph endpoint`,
        object_id: relationship.id
      });
      continue;
    }
    graph.addDirectedEdgeWithKey(relationship.id, relationship.subject_ref, relationship.object_ref, {
      label: relationship.predicate,
      kind: "relationship"
    });
  }

  return {
    nodes: layoutGraphNodes(graph),
    edges: graph
      .edges()
      .sort((left, right) => left.localeCompare(right))
      .map((edge) => ({
        id: edge,
        source: graph.source(edge),
        target: graph.target(edge),
        kind: graph.getEdgeAttribute(edge, "kind"),
        label: graph.getEdgeAttribute(edge, "label")
      }))
  };
}

function layoutGraphNodes(graph: Graph<GraphNodeAttributes, GraphEdgeAttributes>): ScbomViewGraphNode[] {
  const nodes = graph.nodes().sort((left, right) => {
    const byLabel = graph.getNodeAttribute(left, "label").localeCompare(graph.getNodeAttribute(right, "label"));
    return byLabel === 0 ? left.localeCompare(right) : byLabel;
  });
  if (nodes.length === 0) return [];
  if (nodes.length === 1) return [viewNode(graph, nodes[0] ?? "", 0, 0)];

  const radius = 160;
  return nodes.map((node, index) => {
    const angle = (Math.PI * 2 * index) / nodes.length - Math.PI / 2;
    return viewNode(graph, node, roundLayoutValue(Math.cos(angle) * radius), roundLayoutValue(Math.sin(angle) * radius));
  });
}

function viewNode(graph: Graph<GraphNodeAttributes, GraphEdgeAttributes>, nodeId: string, x: number, y: number): ScbomViewGraphNode {
  return {
    id: nodeId,
    label: graph.getNodeAttribute(nodeId, "label"),
    kind: graph.getNodeAttribute(nodeId, "kind"),
    x,
    y
  };
}

function roundLayoutValue(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function assessmentLabels(assessments: readonly ScbomAssessment[] | undefined): string[] {
  return (assessments ?? []).map((assessment) => `${assessment.scheme}:${String(assessment.value)}`);
}

function evidenceLevelFromAssessments(assessments: readonly ScbomAssessment[] | undefined): number | undefined {
  const match = (assessments ?? []).find((assessment) => assessment.scheme.endsWith(":evidence_level") && typeof assessment.value === "number");
  if (match === undefined || typeof match.value !== "number") return undefined;
  return match.value;
}

function visualWeightForEvidenceLevel(evidenceLevel: number | undefined): ScbomEvidenceVisualWeight {
  switch (evidenceLevel) {
    case 5:
      return "level_5";
    case 4:
      return "level_4";
    case 3:
      return "level_3";
    case 2:
      return "level_2";
    case 1:
      return "level_1";
    default:
      return "unknown";
  }
}
