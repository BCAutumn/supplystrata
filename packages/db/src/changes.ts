import type pg from "pg";
import { createId, type EvidenceLevel, type RelationType } from "@supplystrata/core";
import type { DbClient } from "./client.js";

export type ChangeTimelineScope =
  | { kind: "company"; id: string }
  | { kind: "entity"; id: string }
  | { kind: "edge"; id: string }
  | { kind: "claim"; id: string }
  | { kind: "observation"; id: string }
  | { kind: "lead"; id: string }
  | { kind: "unknown"; id: string }
  | { kind: "review"; id: string }
  | { kind: "source"; id: string };

export interface ChangeTimelineInput {
  since: string;
  limit: number;
  scope?: ChangeTimelineScope;
  changeType?: string;
  sourceAdapterId?: string;
  attentionOnly?: boolean;
}

export interface ChangeTimelineItem {
  event_id: string;
  event_family: "graph" | "source" | "semantic";
  event_type: string;
  occurred_at: string;
  scope_kind?: string;
  scope_id?: string;
  source_adapter_id?: string;
  source_item_id?: string;
  doc_id?: string;
  edge_id?: string;
  evidence_id?: string;
  evidence_level?: EvidenceLevel;
  subject_id?: string;
  subject_name?: string;
  object_id?: string;
  object_name?: string;
  relation?: RelationType;
  component?: string;
  caused_by: string;
  requires_attention: boolean;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export interface SemanticChangeInput {
  scope_kind: string;
  scope_id: string;
  change_type: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  evidence_ids?: readonly string[];
  caused_by: string;
}

interface GraphChangeRow extends pg.QueryResultRow {
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

interface SourceChangeRow extends pg.QueryResultRow {
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

export async function listChangeTimeline(client: DbClient, input: ChangeTimelineInput): Promise<ChangeTimelineItem[]> {
  const graphRows = await listGraphChangeRows(client, input);
  const sourceRows = await listSourceChangeRows(client, input);
  const items = [...graphRows.map(graphChangeRowToItem), ...sourceRows.map(sourceChangeRowToItem)]
    .filter((item) => matchesChangeScope(item, input.scope))
    .filter((item) => input.sourceAdapterId === undefined || item.source_adapter_id === input.sourceAdapterId)
    .filter((item) => input.attentionOnly !== true || item.requires_attention)
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  return items.slice(0, input.limit);
}

export async function recordSemanticChange(client: DbClient, input: SemanticChangeInput): Promise<{ change_id: string }> {
  const changeId = createId("CHG");
  await client.query(
    `INSERT INTO change_records (change_id, scope_kind, scope_id, change_type, before, after, evidence_ids, caused_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [changeId, input.scope_kind, input.scope_id, input.change_type, input.before ?? null, input.after ?? null, [...(input.evidence_ids ?? [])], input.caused_by]
  );
  return { change_id: changeId };
}

async function listGraphChangeRows(client: DbClient, input: ChangeTimelineInput): Promise<GraphChangeRow[]> {
  const params: unknown[] = [input.since];
  const predicates = ["cr.detected_at >= $1::timestamptz"];
  if (input.changeType !== undefined) {
    params.push(input.changeType);
    predicates.push(`cr.change_type = $${params.length}`);
  }
  params.push(Math.max(input.limit * 4, 25));
  const limitParam = `$${params.length}`;
  const result = await client.query<GraphChangeRow>(
    `SELECT cr.change_id,
            cr.change_type,
            cr.detected_at,
            cr.scope_kind,
            cr.scope_id,
            cr.before,
            cr.after,
            cr.caused_by,
            ev.evidence_id,
            ev.evidence_level,
            COALESCE(d.source_adapter_id, cr.after->>'source_adapter_id', cr.before->>'source_adapter_id') AS source_adapter_id,
            d.doc_id,
            COALESCE(ev.edge_id, CASE WHEN cr.scope_kind = 'edge' THEN cr.scope_id ELSE NULL END) AS edge_id,
            ed.subject_id,
            subject.display_name AS subject_name,
            ed.object_id,
            object.display_name AS object_name,
            ed.relation,
            ed.component
     FROM change_records cr
     LEFT JOIN LATERAL (
       SELECT evidence.evidence_id, evidence.edge_id, evidence.evidence_level, evidence.doc_id
       FROM unnest(cr.evidence_ids) evidence_ids(evidence_id)
       JOIN evidence ON evidence.evidence_id = evidence_ids.evidence_id
       ORDER BY evidence.created_at DESC, evidence.evidence_id DESC
       LIMIT 1
     ) ev ON true
     LEFT JOIN documents d ON d.doc_id = ev.doc_id
     LEFT JOIN edges ed ON ed.edge_id = COALESCE(ev.edge_id, CASE WHEN cr.scope_kind = 'edge' THEN cr.scope_id ELSE NULL END)
     LEFT JOIN entity_master subject ON subject.entity_id = ed.subject_id
     LEFT JOIN entity_master object ON object.entity_id = ed.object_id
     WHERE ${predicates.join(" AND ")}
     ORDER BY cr.detected_at DESC
     LIMIT ${limitParam}`,
    params
  );
  return result.rows;
}

async function listSourceChangeRows(client: DbClient, input: ChangeTimelineInput): Promise<SourceChangeRow[]> {
  const params: unknown[] = [input.since];
  const predicates = ["detected_at >= $1::timestamptz"];
  if (input.changeType !== undefined) {
    params.push(input.changeType);
    predicates.push(`event_type = $${params.length}`);
  }
  if (input.sourceAdapterId !== undefined) {
    params.push(input.sourceAdapterId);
    predicates.push(`source_adapter_id = $${params.length}`);
  }
  params.push(Math.max(input.limit * 4, 25));
  const limitParam = `$${params.length}`;
  const result = await client.query<SourceChangeRow>(
    `SELECT event_id, event_type, detected_at, source_adapter_id, source_item_id, doc_id, before, after, caused_by
     FROM source_change_events
     WHERE ${predicates.join(" AND ")}
     ORDER BY detected_at DESC
     LIMIT ${limitParam}`,
    params
  );
  return result.rows;
}

function graphChangeRowToItem(row: GraphChangeRow): ChangeTimelineItem {
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
  return withOptionalChangeFields(item, {
    source_adapter_id: row.source_adapter_id,
    doc_id: row.doc_id,
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
}

function sourceChangeRowToItem(row: SourceChangeRow): ChangeTimelineItem {
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
    scopeKind === "review" ||
    scopeKind === "source"
  ) {
    return "semantic";
  }
  return "graph";
}

function graphChangeRequiresAttention(changeType: string): boolean {
  return /changed|removed|deprecated|conflict|failed|blocked|rejected|superseded/i.test(changeType);
}

function sourceChangeRequiresAttention(eventType: string): boolean {
  return /CHANGED|FAILED|RECOVERED/i.test(eventType);
}

function matchesChangeScope(item: ChangeTimelineItem, scope: ChangeTimelineScope | undefined): boolean {
  if (scope === undefined) return true;
  if (scope.kind === "source") return item.source_adapter_id === scope.id;
  if (scope.kind === "edge") return item.edge_id === scope.id || (item.scope_kind === "edge" && item.scope_id === scope.id);
  if (scope.kind === "claim" || scope.kind === "observation" || scope.kind === "lead" || scope.kind === "unknown" || scope.kind === "review") {
    return item.scope_kind === scope.kind && item.scope_id === scope.id;
  }
  return item.scope_id === scope.id || item.subject_id === scope.id || item.object_id === scope.id;
}
