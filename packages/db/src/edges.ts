import type pg from "pg";
import type { RelationType } from "@supplystrata/core";
import { recordSemanticChange } from "./changes.js";
import type { DbClient, DbTxClient } from "./client.js";

interface DeprecatedEdgeRow extends pg.QueryResultRow {
  edge_id: string;
  subject_id: string;
  object_id: string;
  relation: RelationType;
  component: string | null;
  component_id: string | null;
  primary_evidence_id: string | null;
}

export type EdgeDeprecationSourceKind = "evidence" | "review" | "claim" | "unknown" | "semantic_change";

export interface EdgeDeprecationSourceRef {
  kind: EdgeDeprecationSourceKind;
  id: string;
}

export interface DeprecateEdgeInput {
  edge_id: string;
  reason: string;
  source_refs: readonly EdgeDeprecationSourceRef[];
  superseded_by_edge_id?: string;
  caused_by: string;
}

export interface DeprecateEdgeResult {
  edge_id: string;
  primary_evidence_id?: string;
  source_refs: EdgeDeprecationSourceRef[];
}

export async function deprecateEdge(client: DbTxClient, input: DeprecateEdgeInput): Promise<DeprecateEdgeResult> {
  const sourceRefs = normalizeDeprecationSourceRefs(input.source_refs);
  if (input.reason.trim().length === 0) throw new Error("edge deprecation requires a non-empty reason");
  await requireDeprecationSourceRefs(client, sourceRefs);

  const result = await client.query<DeprecatedEdgeRow>(
    `UPDATE edges
     SET validity = 'deprecated',
         deprecated_reason = $2,
         superseded_by_edge_id = $3,
         updated_at = now()
     WHERE edge_id = $1 AND validity = 'current'
     RETURNING edge_id, subject_id, object_id, relation, component, component_id, primary_evidence_id`,
    [input.edge_id, input.reason, input.superseded_by_edge_id ?? null]
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Current edge not found or already inactive: ${input.edge_id}`);
  await recordSemanticChange(client, {
    scope_kind: "edge",
    scope_id: row.edge_id,
    change_type: "EDGE_DEPRECATED",
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
      superseded_by_edge_id: input.superseded_by_edge_id,
      source_refs: sourceRefs
    },
    evidence_ids: edgeDeprecationEvidenceIds(row, sourceRefs),
    caused_by: input.caused_by
  });
  return {
    edge_id: row.edge_id,
    ...(row.primary_evidence_id === null ? {} : { primary_evidence_id: row.primary_evidence_id }),
    source_refs: sourceRefs
  };
}

function normalizeDeprecationSourceRefs(sourceRefs: readonly EdgeDeprecationSourceRef[]): EdgeDeprecationSourceRef[] {
  if (sourceRefs.length === 0) throw new Error("edge deprecation requires at least one source ref");
  const seen = new Set<string>();
  const normalized: EdgeDeprecationSourceRef[] = [];
  for (const sourceRef of sourceRefs) {
    const id = sourceRef.id.trim();
    if (id.length === 0) throw new Error(`edge deprecation source ref has empty id for kind ${sourceRef.kind}`);
    const key = `${sourceRef.kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ kind: sourceRef.kind, id });
  }
  return normalized;
}

async function requireDeprecationSourceRefs(client: DbClient, sourceRefs: readonly EdgeDeprecationSourceRef[]): Promise<void> {
  await requireExistingRefs(client, "evidence", "evidence", "evidence_id", idsByKind(sourceRefs, "evidence"));
  await requireExistingRefs(client, "review_candidates", "review", "review_id", idsByKind(sourceRefs, "review"));
  await requireExistingRefs(client, "claims", "claim", "claim_id", idsByKind(sourceRefs, "claim"));
  await requireExistingRefs(client, "unknown_items", "unknown", "unknown_id", idsByKind(sourceRefs, "unknown"));
  await requireExistingRefs(client, "change_records", "semantic_change", "change_id", idsByKind(sourceRefs, "semantic_change"));
}

async function requireExistingRefs(
  client: DbClient,
  tableName: "evidence" | "review_candidates" | "claims" | "unknown_items" | "change_records",
  kind: EdgeDeprecationSourceKind,
  idColumn: "evidence_id" | "review_id" | "claim_id" | "unknown_id" | "change_id",
  ids: readonly string[]
): Promise<void> {
  if (ids.length === 0) return;
  const result = await client.query<pg.QueryResultRow>(`SELECT ${idColumn} AS id FROM ${tableName} WHERE ${idColumn} = ANY($1::text[])`, [[...ids]]);
  const found = new Set(result.rows.map((row) => String(row["id"])));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) throw new Error(`Missing ${kind} source refs for edge deprecation: ${missing.join(", ")}`);
}

function idsByKind(sourceRefs: readonly EdgeDeprecationSourceRef[], kind: EdgeDeprecationSourceKind): string[] {
  return sourceRefs.filter((sourceRef) => sourceRef.kind === kind).map((sourceRef) => sourceRef.id);
}

function edgeDeprecationEvidenceIds(row: DeprecatedEdgeRow, sourceRefs: readonly EdgeDeprecationSourceRef[]): string[] {
  const ids = sourceRefs.filter((sourceRef) => sourceRef.kind === "evidence").map((sourceRef) => sourceRef.id);
  if (row.primary_evidence_id !== null) ids.push(row.primary_evidence_id);
  return [...new Set(ids)];
}
