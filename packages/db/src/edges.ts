import type pg from "pg";
import type { RelationType } from "@supplystrata/core";
import { recordSemanticChange } from "./changes.js";
import type { DbClient } from "./client.js";

interface DeprecatedEdgeRow extends pg.QueryResultRow {
  edge_id: string;
  subject_id: string;
  object_id: string;
  relation: RelationType;
  component: string | null;
  component_id: string | null;
  primary_evidence_id: string | null;
}

export interface DeprecateEdgeInput {
  edge_id: string;
  reason: string;
  superseded_by_edge_id?: string;
  caused_by: string;
}

export interface DeprecateEdgeResult {
  edge_id: string;
  primary_evidence_id?: string;
}

export async function deprecateEdge(client: DbClient, input: DeprecateEdgeInput): Promise<DeprecateEdgeResult> {
  const result = await client.query<DeprecatedEdgeRow>(
    `UPDATE edges
     SET validity = 'deprecated',
         deprecated_reason = $2,
         superseded_by_edge_id = $3,
         updated_at = now()
     WHERE edge_id = $1 AND validity <> 'deprecated'
     RETURNING edge_id, subject_id, object_id, relation, component, component_id, primary_evidence_id`,
    [input.edge_id, input.reason, input.superseded_by_edge_id ?? null]
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Edge not found or already deprecated: ${input.edge_id}`);
  await recordSemanticChange(client, {
    scope_kind: "edge",
    scope_id: row.edge_id,
    change_type: "edge_deprecated",
    before: {
      validity: "current",
      subject_id: row.subject_id,
      object_id: row.object_id,
      relation: row.relation,
      component: row.component,
      component_id: row.component_id
    },
    after: {
      validity: "deprecated",
      reason: input.reason,
      superseded_by_edge_id: input.superseded_by_edge_id
    },
    evidence_ids: row.primary_evidence_id === null ? [] : [row.primary_evidence_id],
    caused_by: input.caused_by
  });
  return {
    edge_id: row.edge_id,
    ...(row.primary_evidence_id === null ? {} : { primary_evidence_id: row.primary_evidence_id })
  };
}
