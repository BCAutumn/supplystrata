import type pg from "pg";
import { RELATION_TYPES, type EvidenceLevel, type RelationType } from "@supplystrata/core";
import type { ChangeTimelineItem, ChangeTimelineScope } from "./change-timeline-definitions.js";

export interface GraphChangeRow extends pg.QueryResultRow {
  change_id: string;
  change_type: string;
  detected_at: Date;
  scope_kind: string;
  scope_id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  caused_by: string;
  evidence_id: string | null;
  evidence_level: EvidenceLevel | null;
  source_adapter_id: string | null;
  doc_id: string | null;
  edge_id: string | null;
  subject_id: string | null;
  subject_name: string | null;
  object_id: string | null;
  object_name: string | null;
  relation: RelationType | null;
  component: string | null;
}

export interface SourceChangeRow extends pg.QueryResultRow {
  event_id: string;
  event_type: string;
  detected_at: Date;
  source_adapter_id: string;
  source_item_id: string | null;
  doc_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  caused_by: string;
}

export function graphChangeRowToItem(row: GraphChangeRow): ChangeTimelineItem {
  const item: ChangeTimelineItem = {
    event_id: row.change_id,
    event_family: eventFamilyForGraphRow(row.scope_kind),
    event_type: normalizeGraphChangeType(row.change_type),
    occurred_at: row.detected_at.toISOString(),
    scope_kind: row.scope_kind,
    scope_id: row.scope_id,
    caused_by: row.caused_by,
    requires_attention: graphChangeRequiresAttention(row.change_type)
  };
  const docId = row.doc_id ?? stringValue(row.after, "doc_id") ?? stringValue(row.before, "doc_id") ?? null;
  const timelineItem = withOptionalChangeFields(item, {
    source_adapter_id: row.source_adapter_id,
    doc_id: docId,
    edge_id: row.edge_id,
    evidence_id: row.evidence_id,
    evidence_level: row.evidence_level,
    subject_id: row.subject_id,
    subject_name: row.subject_name,
    object_id: row.object_id,
    object_name: row.object_name,
    relation: row.relation,
    component: row.component,
    before: row.before,
    after: row.after
  });
  return withSemanticChangeFields(timelineItem, row);
}

export function sourceChangeRowToItem(row: SourceChangeRow): ChangeTimelineItem {
  const item: ChangeTimelineItem = {
    event_id: row.event_id,
    event_family: "source",
    event_type: row.event_type,
    occurred_at: row.detected_at.toISOString(),
    source_adapter_id: row.source_adapter_id,
    caused_by: row.caused_by,
    requires_attention: sourceChangeRequiresAttention(row.event_type)
  };
  return withOptionalChangeFields(item, {
    source_item_id: row.source_item_id,
    doc_id: row.doc_id,
    before: row.before,
    after: row.after
  });
}

export function matchesChangeScope(item: ChangeTimelineItem, scope: ChangeTimelineScope | undefined): boolean {
  if (scope === undefined) return true;
  if (scope.kind === "source") return item.source_adapter_id === scope.id;
  if (scope.kind === "edge") return item.edge_id === scope.id || (item.scope_kind === "edge" && item.scope_id === scope.id);
  if (item.observation_scope_kind === scope.kind && item.observation_scope_id === scope.id) return true;
  if (
    scope.kind === "claim" ||
    scope.kind === "observation" ||
    scope.kind === "lead" ||
    scope.kind === "unknown" ||
    scope.kind === "alert" ||
    scope.kind === "risk_view" ||
    scope.kind === "risk_metric" ||
    scope.kind === "review"
  ) {
    return item.scope_kind === scope.kind && item.scope_id === scope.id;
  }
  return item.scope_id === scope.id || item.subject_id === scope.id || item.object_id === scope.id;
}

function withOptionalChangeFields(
  item: ChangeTimelineItem,
  fields: {
    source_adapter_id?: string | null;
    source_item_id?: string | null;
    doc_id?: string | null;
    edge_id?: string | null;
    evidence_id?: string | null;
    evidence_level?: EvidenceLevel | null;
    subject_id?: string | null;
    subject_name?: string | null;
    object_id?: string | null;
    object_name?: string | null;
    relation?: RelationType | null;
    component?: string | null;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  }
): ChangeTimelineItem {
  const output = { ...item };
  if (fields.source_adapter_id !== undefined && fields.source_adapter_id !== null) output.source_adapter_id = fields.source_adapter_id;
  if (fields.source_item_id !== undefined && fields.source_item_id !== null) output.source_item_id = fields.source_item_id;
  if (fields.doc_id !== undefined && fields.doc_id !== null) output.doc_id = fields.doc_id;
  if (fields.edge_id !== undefined && fields.edge_id !== null) output.edge_id = fields.edge_id;
  if (fields.evidence_id !== undefined && fields.evidence_id !== null) output.evidence_id = fields.evidence_id;
  if (fields.evidence_level !== undefined && fields.evidence_level !== null) output.evidence_level = fields.evidence_level;
  if (fields.subject_id !== undefined && fields.subject_id !== null) output.subject_id = fields.subject_id;
  if (fields.subject_name !== undefined && fields.subject_name !== null) output.subject_name = fields.subject_name;
  if (fields.object_id !== undefined && fields.object_id !== null) output.object_id = fields.object_id;
  if (fields.object_name !== undefined && fields.object_name !== null) output.object_name = fields.object_name;
  if (fields.relation !== undefined && fields.relation !== null) output.relation = fields.relation;
  if (fields.component !== undefined && fields.component !== null) output.component = fields.component;
  if (fields.before !== undefined && fields.before !== null) output.before = fields.before;
  if (fields.after !== undefined && fields.after !== null) output.after = fields.after;
  return output;
}

function withSemanticChangeFields(item: ChangeTimelineItem, row: GraphChangeRow): ChangeTimelineItem {
  if (row.change_type === "evidence_superseded") return withEvidenceSupersessionFields(item, row);
  if (isRelationSemanticChange(row.change_type)) return withRelationSemanticChangeFields(item, row);
  if (row.change_type !== "OBSERVATION_ANOMALY") return item;
  const output = { ...item };
  const observationScopeKind = stringValue(row.after, "observation_scope_kind");
  const observationScopeId = stringValue(row.after, "observation_scope_id");
  const metricName = stringValue(row.after, "metric_name");
  const metricValue = stringValue(row.after, "metric_value");
  const metricUnit = stringValue(row.after, "metric_unit");
  const baselineMethod = stringValue(row.after, "baseline_method");
  const baselineValue = stringValue(row.after, "baseline_value");
  const changePercent = numberValue(row.after, "change_percent");
  const severity = stringValue(row.after, "severity");
  const direction = stringValue(row.after, "direction");
  if (observationScopeKind !== undefined) output.observation_scope_kind = observationScopeKind;
  if (observationScopeId !== undefined) output.observation_scope_id = observationScopeId;
  if (metricName !== undefined) output.metric_name = metricName;
  if (metricValue !== undefined) output.metric_value = metricValue;
  if (metricUnit !== undefined) output.metric_unit = metricUnit;
  if (baselineMethod !== undefined) output.baseline_method = baselineMethod;
  if (baselineValue !== undefined) output.baseline_value = baselineValue;
  if (changePercent !== undefined) output.change_percent = changePercent;
  if (severity !== undefined) output.anomaly_severity = severity;
  if (direction !== undefined) output.anomaly_direction = direction;
  return output;
}

function withEvidenceSupersessionFields(item: ChangeTimelineItem, row: GraphChangeRow): ChangeTimelineItem {
  const output = { ...item };
  const supersededEvidenceIds = stringArrayValue(row.before, "superseded_evidence_ids");
  const supersededBy = stringValue(row.after, "superseded_by");
  if (supersededEvidenceIds.length > 0) output.superseded_evidence_ids = supersededEvidenceIds;
  if (supersededBy !== undefined) output.superseded_by_evidence_id = supersededBy;
  return output;
}

function withRelationSemanticChangeFields(item: ChangeTimelineItem, row: GraphChangeRow): ChangeTimelineItem {
  const after = row.after;
  const before = row.before;
  const output = { ...item };
  const sourceItemId = stringValue(after, "source_item_id") ?? stringValue(before, "source_item_id");
  const previousDocId = stringValue(before, "doc_id");
  const nextDocId = stringValue(after, "doc_id");
  const relation = relationValue(after, "relation") ?? relationValue(before, "relation");
  const component = stringValue(after, "component") ?? stringValue(before, "component");
  const semanticRelationKind = stringValue(after, "semantic_relation_kind") ?? stringValue(before, "semantic_relation_kind");
  const subjectSurface = stringValue(after, "subject_surface") ?? stringValue(before, "subject_surface");
  const objectSurface = stringValue(after, "object_surface") ?? stringValue(before, "object_surface");
  const fingerprint = stringValue(after, "fingerprint") ?? stringValue(before, "fingerprint");
  if (sourceItemId !== undefined) output.source_item_id = sourceItemId;
  if (previousDocId !== undefined) output.previous_doc_id = previousDocId;
  if (nextDocId !== undefined) output.next_doc_id = nextDocId;
  if (relation !== undefined) output.relation = relation;
  if (component !== undefined) output.component = component;
  if (semanticRelationKind !== undefined) output.semantic_relation_kind = semanticRelationKind;
  if (subjectSurface !== undefined) output.relation_subject_surface = subjectSurface;
  if (objectSurface !== undefined) output.relation_object_surface = objectSurface;
  if (fingerprint !== undefined) output.relation_fingerprint = fingerprint;
  return output;
}

function isRelationSemanticChange(changeType: string): boolean {
  return /_(?:RELATION|OBLIGATION|RESERVATION|RISK)_(?:ADDED|CHANGED|REMOVED)$/u.test(changeType);
}

function normalizeGraphChangeType(changeType: string): string {
  if (changeType === "new_edge") return "EDGE_ADDED";
  if (changeType === "edge_evidence_added") return "EVIDENCE_ADDED";
  if (changeType === "evidence_superseded") return "EVIDENCE_SUPERSEDED";
  if (changeType === "entity_source_import") return "ENTITY_IMPORTED";
  if (changeType === "facility_source_import") return "FACILITY_IMPORTED";
  return changeType.toUpperCase();
}

function eventFamilyForGraphRow(scopeKind: string): ChangeTimelineItem["event_family"] {
  if (
    scopeKind === "claim" ||
    scopeKind === "observation" ||
    scopeKind === "lead" ||
    scopeKind === "unknown" ||
    scopeKind === "alert" ||
    scopeKind === "review" ||
    scopeKind === "source"
  ) {
    return "semantic";
  }
  if (scopeKind === "risk_view" || scopeKind === "risk_metric") return "risk";
  return "graph";
}

function graphChangeRequiresAttention(changeType: string): boolean {
  return /changed|removed|deprecated|conflict|failed|blocked|rejected|superseded|anomaly/i.test(changeType);
}

function sourceChangeRequiresAttention(eventType: string): boolean {
  return /CHANGED|FAILED|RECOVERED/i.test(eventType);
}

function stringValue(source: Record<string, unknown> | null, key: string): string | undefined {
  const value = source?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(source: Record<string, unknown> | null, key: string): number | undefined {
  const value = source?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArrayValue(source: Record<string, unknown> | null, key: string): string[] {
  const value = source?.[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function relationValue(source: Record<string, unknown> | null, key: string): RelationType | undefined {
  const value = source?.[key];
  return typeof value === "string" && isRelationType(value) ? value : undefined;
}

function isRelationType(value: string): value is RelationType {
  return (RELATION_TYPES as readonly string[]).includes(value);
}
