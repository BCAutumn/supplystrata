import { createId } from "@supplystrata/core";
import type { ChangeTimelineInput, ChangeTimelineItem, SemanticChangeInput } from "./change-timeline-definitions.js";
import { graphChangeRowToItem, matchesChangeScope, sourceChangeRowToItem, type GraphChangeRow, type SourceChangeRow } from "./change-timeline-mappers.js";
import type { DbClient, DbTxClient } from "./client.js";

export type { ChangeTimelineInput, ChangeTimelineItem, ChangeTimelineScope, SemanticChangeInput } from "./change-timeline-definitions.js";

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

export async function recordSemanticChange(client: DbTxClient, input: SemanticChangeInput): Promise<{ change_id: string }> {
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
