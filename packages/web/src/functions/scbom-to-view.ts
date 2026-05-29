import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import noverlap from "graphology-layout-noverlap";
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
  label: string;
  kind: ScbomViewGraphNode["kind"];
  x: number;
  y: number;
  size: number;
}

interface GraphEdgeAttributes {
  label: string;
  kind: ScbomViewGraphEdge["kind"];
  weight: number;
}

interface LabelBox {
  readonly nodeId: string;
  readonly centerX: number;
  readonly centerY: number;
  readonly width: number;
  readonly height: number;
}

const LABEL_HEIGHT = 14;
const LABEL_VERTICAL_GAP = 14;
const LABEL_HORIZONTAL_GAP = 12;
const MIN_NODE_GAP = 10;
const GRAPH_PADDING = 28;

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
  for (const entity of entities) graph.addNode(entity.id, { label: entity.name, kind: "entity", x: 0, y: 0, size: 8 });

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
      kind: "relationship",
      weight: 1
    });
  }

  const nodes = layoutGraphNodes(graph);
  return {
    nodes,
    edges: graph
      .edges()
      .sort((left, right) => left.localeCompare(right))
      .map((edge) => ({
        id: edge,
        source: graph.source(edge),
        target: graph.target(edge),
        kind: graph.getEdgeAttribute(edge, "kind"),
        label: graph.getEdgeAttribute(edge, "label")
      })),
    bounds: graphBounds(nodes)
  };
}

function layoutGraphNodes(graph: Graph<GraphNodeAttributes, GraphEdgeAttributes>): ScbomViewGraphNode[] {
  const nodes = graph.nodes().sort((left, right) => {
    const byLabel = graph.getNodeAttribute(left, "label").localeCompare(graph.getNodeAttribute(right, "label"));
    return byLabel === 0 ? left.localeCompare(right) : byLabel;
  });
  if (nodes.length === 0) return [];
  seedInitialGraphLayout(graph, nodes);
  for (const node of nodes) graph.setNodeAttribute(node, "size", nodeSize(graph, node));
  if (nodes.length > 1) {
    forceAtlas2.assign<GraphNodeAttributes, GraphEdgeAttributes>(graph, {
      iterations: layoutIterations(nodes.length),
      getEdgeWeight: "weight",
      settings: {
        adjustSizes: true,
        barnesHutOptimize: nodes.length > 80,
        gravity: 1.2,
        scalingRatio: 18,
        slowDown: 4
      }
    });
    noverlap.assign(graph, {
      maxIterations: 120,
      settings: {
        margin: MIN_NODE_GAP,
        ratio: 1.8,
        speed: 3
      }
    });
    normalizeGraphLayout(graph, nodes);
    resolveNodeCollisions(graph, nodes);
  }

  const labels = placeGraphLabels(graph, nodes);
  return nodes.map((node) => viewNode(graph, node, labels.get(node)));
}

function seedInitialGraphLayout(graph: Graph<GraphNodeAttributes, GraphEdgeAttributes>, nodes: readonly string[]): void {
  if (nodes.length === 1) {
    graph.setNodeAttribute(nodes[0] ?? "", "x", 0);
    graph.setNodeAttribute(nodes[0] ?? "", "y", 0);
    return;
  }

  const radius = initialLayoutRadius(nodes.length);
  nodes.forEach((node, index) => {
    const angle = (Math.PI * 2 * index) / nodes.length - Math.PI / 2;
    graph.setNodeAttribute(node, "x", Math.cos(angle) * radius);
    graph.setNodeAttribute(node, "y", Math.sin(angle) * radius);
  });
}

function normalizeGraphLayout(graph: Graph<GraphNodeAttributes, GraphEdgeAttributes>, nodes: readonly string[]): void {
  const xValues = nodes.map((node) => graph.getNodeAttribute(node, "x"));
  const yValues = nodes.map((node) => graph.getNodeAttribute(node, "y"));
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);
  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  const scale = Math.min(380 / width, 320 / height, 4);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  for (const node of nodes) {
    graph.setNodeAttribute(node, "x", roundLayoutValue((graph.getNodeAttribute(node, "x") - centerX) * scale));
    graph.setNodeAttribute(node, "y", roundLayoutValue((graph.getNodeAttribute(node, "y") - centerY) * scale));
  }
}

function placeGraphLabels(graph: Graph<GraphNodeAttributes, GraphEdgeAttributes>, nodes: readonly string[]): ReadonlyMap<string, LabelBox> {
  const labels = new Map<string, LabelBox>();
  const placed: LabelBox[] = [];
  const byPosition = nodes.slice().sort((left, right) => {
    const byY = graph.getNodeAttribute(left, "y") - graph.getNodeAttribute(right, "y");
    if (byY !== 0) return byY;
    const byX = graph.getNodeAttribute(left, "x") - graph.getNodeAttribute(right, "x");
    return byX === 0 ? left.localeCompare(right) : byX;
  });

  for (const node of byPosition) {
    const box = bestLabelBox(graph, node, placed);
    labels.set(node, box);
    placed.push(box);
  }

  return labels;
}

function bestLabelBox(graph: Graph<GraphNodeAttributes, GraphEdgeAttributes>, node: string, placed: readonly LabelBox[]): LabelBox {
  const x = graph.getNodeAttribute(node, "x");
  const y = graph.getNodeAttribute(node, "y");
  const size = graph.getNodeAttribute(node, "size");
  const width = labelWidth(graph.getNodeAttribute(node, "label"));
  const candidates = labelCandidates(node, x, y, size, width);
  const clear = candidates.find((candidate) => labelCollisionScore(candidate, placed) === 0);
  return (
    clear ??
    candidates.slice().sort((left, right) => labelCollisionScore(left, placed) - labelCollisionScore(right, placed))[0] ??
    candidates[0] ?? {
      nodeId: node,
      centerX: x,
      centerY: y + size + LABEL_VERTICAL_GAP,
      width,
      height: LABEL_HEIGHT
    }
  );
}

function labelCandidates(nodeId: string, x: number, y: number, size: number, width: number): LabelBox[] {
  const baseVertical = size + LABEL_VERTICAL_GAP;
  const baseHorizontal = size + LABEL_HORIZONTAL_GAP + width / 2;
  const directions = [
    { x: 0, y: 1 },
    { x: 0, y: -1 },
    { x: 1, y: 0.2 },
    { x: -1, y: 0.2 },
    { x: 0.8, y: 1 },
    { x: -0.8, y: 1 },
    { x: 0.8, y: -1 },
    { x: -0.8, y: -1 }
  ];
  const candidates: LabelBox[] = [];
  for (let step = 1; step <= 10; step += 1) {
    for (const direction of directions) {
      candidates.push({
        nodeId,
        centerX: x + direction.x * baseHorizontal * step,
        centerY: y + direction.y * baseVertical * step,
        width,
        height: LABEL_HEIGHT
      });
    }
  }
  return candidates.map((candidate) => ({
    ...candidate,
    centerX: roundLayoutValue(candidate.centerX),
    centerY: roundLayoutValue(candidate.centerY)
  }));
}

function labelCollisionScore(candidate: LabelBox, placed: readonly LabelBox[]): number {
  return placed.reduce((score, box) => score + labelOverlapArea(candidate, box), 0);
}

function labelOverlapArea(left: LabelBox, right: LabelBox): number {
  const overlapX = Math.max(0, Math.min(labelRight(left), labelRight(right)) - Math.max(labelLeft(left), labelLeft(right)));
  const overlapY = Math.max(0, Math.min(labelBottom(left), labelBottom(right)) - Math.max(labelTop(left), labelTop(right)));
  return overlapX * overlapY;
}

function graphBounds(nodes: readonly ScbomViewGraphNode[]): ScbomView["graph"]["bounds"] {
  if (nodes.length === 0) return { min_x: -240, min_y: -220, width: 480, height: 440 };
  const minX = Math.min(...nodes.map((node) => Math.min(node.x - node.size, node.label_x - node.label_width / 2))) - GRAPH_PADDING;
  const maxX = Math.max(...nodes.map((node) => Math.max(node.x + node.size, node.label_x + node.label_width / 2))) + GRAPH_PADDING;
  const minY = Math.min(...nodes.map((node) => Math.min(node.y - node.size, node.label_y - LABEL_HEIGHT))) - GRAPH_PADDING;
  const maxY = Math.max(...nodes.map((node) => Math.max(node.y + node.size, node.label_y + 2))) + GRAPH_PADDING;
  return {
    min_x: roundLayoutValue(minX),
    min_y: roundLayoutValue(minY),
    width: roundLayoutValue(Math.max(maxX - minX, 120)),
    height: roundLayoutValue(Math.max(maxY - minY, 120))
  };
}

function resolveNodeCollisions(graph: Graph<GraphNodeAttributes, GraphEdgeAttributes>, nodes: readonly string[]): void {
  for (let iteration = 0; iteration < 120; iteration += 1) {
    let moved = false;
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      const left = nodes[leftIndex];
      if (left === undefined) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const right = nodes[rightIndex];
        if (right === undefined) continue;
        const leftX = graph.getNodeAttribute(left, "x");
        const leftY = graph.getNodeAttribute(left, "y");
        const rightX = graph.getNodeAttribute(right, "x");
        const rightY = graph.getNodeAttribute(right, "y");
        const minDistance = graph.getNodeAttribute(left, "size") + graph.getNodeAttribute(right, "size") + MIN_NODE_GAP;
        const deltaX = rightX - leftX;
        const deltaY = rightY - leftY;
        const distance = Math.max(Math.hypot(deltaX, deltaY), 0.001);
        if (distance >= minDistance) continue;

        const push = (minDistance - distance) / 2 + 0.2;
        const direction = collisionDirection(left, right, deltaX, deltaY);
        graph.setNodeAttribute(left, "x", roundLayoutValue(leftX - direction.x * push));
        graph.setNodeAttribute(left, "y", roundLayoutValue(leftY - direction.y * push));
        graph.setNodeAttribute(right, "x", roundLayoutValue(rightX + direction.x * push));
        graph.setNodeAttribute(right, "y", roundLayoutValue(rightY + direction.y * push));
        moved = true;
      }
    }
    if (!moved) return;
  }
}

function collisionDirection(left: string, right: string, deltaX: number, deltaY: number): { readonly x: number; readonly y: number } {
  const distance = Math.hypot(deltaX, deltaY);
  if (distance > 0.001) return { x: deltaX / distance, y: deltaY / distance };
  const hash = stablePairHash(left, right);
  const angle = (hash / 360) * Math.PI * 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function stablePairHash(left: string, right: string): number {
  let hash = 0;
  for (const char of `${left}:${right}`) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

function viewNode(graph: Graph<GraphNodeAttributes, GraphEdgeAttributes>, nodeId: string, label: LabelBox | undefined): ScbomViewGraphNode {
  const x = roundLayoutValue(graph.getNodeAttribute(nodeId, "x"));
  const y = roundLayoutValue(graph.getNodeAttribute(nodeId, "y"));
  const labelWidth = label?.width ?? labelWidthForNode(graph, nodeId);
  return {
    id: nodeId,
    label: graph.getNodeAttribute(nodeId, "label"),
    kind: graph.getNodeAttribute(nodeId, "kind"),
    size: roundLayoutValue(graph.getNodeAttribute(nodeId, "size")),
    x,
    y,
    label_x: label?.centerX ?? x,
    label_y: label?.centerY ?? y + graph.getNodeAttribute(nodeId, "size") + LABEL_VERTICAL_GAP,
    label_width: labelWidth
  };
}

function initialLayoutRadius(nodeCount: number): number {
  return Math.max(120, Math.min(320, nodeCount * 12));
}

function layoutIterations(nodeCount: number): number {
  return Math.max(60, Math.min(180, nodeCount * 3));
}

function nodeSize(graph: Graph<GraphNodeAttributes, GraphEdgeAttributes>, nodeId: string): number {
  return 9 + Math.min(graph.degree(nodeId), 8) * 1.4;
}

function labelWidthForNode(graph: Graph<GraphNodeAttributes, GraphEdgeAttributes>, nodeId: string): number {
  return labelWidth(graph.getNodeAttribute(nodeId, "label"));
}

function labelWidth(label: string): number {
  return Math.min(shortGraphLabel(label).length * 6.6 + 8, 132);
}

function shortGraphLabel(label: string): string {
  return label.length > 18 ? `${label.slice(0, 15)}...` : label;
}

function labelLeft(box: LabelBox): number {
  return box.centerX - box.width / 2;
}

function labelRight(box: LabelBox): number {
  return box.centerX + box.width / 2;
}

function labelTop(box: LabelBox): number {
  return box.centerY - box.height;
}

function labelBottom(box: LabelBox): number {
  return box.centerY + 2;
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
