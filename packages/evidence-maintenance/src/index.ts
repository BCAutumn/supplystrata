import { createHash } from "node:crypto";
import type { CandidateRelation, EvidenceLevel, RelationType } from "@supplystrata/core";
import { listEdgeStrengthEstimates, type DbClient } from "@supplystrata/db/read";
import { refreshEdgeFreshness, upsertEdgeStrengthEstimate, upsertUnknownItem, type DatabaseStore, type DbTxClient } from "@supplystrata/db/write";
import { buildEvidenceTrace } from "@supplystrata/evidence-trace";
import type { EvidenceTraceBackfillRow, IntelligenceRefreshEdgeRow } from "./db-rows.js";
import { inferEdgeStrengthDrafts } from "./edge-strength-rules.js";
export { inferEdgeStrengthDrafts, type EdgeStrengthDraft } from "./edge-strength-rules.js";

export * from "./alerts.js";
export * from "./calibration.js";
export * from "./component-risk.js";
export * from "./financial-peer-comparison.js";
export * from "./observation-anomaly.js";
export * from "./single-source-disposition.js";

export interface EvidenceTraceBackfillSummary {
  scanned: number;
  updated: number;
  offset_missing: number;
}

export interface EvidenceTraceBackfillInput {
  limit?: number;
  batch_size?: number;
  active_only?: boolean;
}

export interface RefreshEdgeIntelligenceInput {
  min_evidence_level?: 4 | 5;
  limit?: number;
  computed_at: string;
  generated_by?: string;
  create_unknowns?: boolean;
}

export interface EdgeIntelligenceRefreshSummary {
  scanned: number;
  freshness_refreshed: number;
  strengths_upserted: number;
  edges_with_strength: number;
  unknowns_inserted: number;
  unknowns_updated: number;
  unknowns_resolved: number;
  generated_by: string;
  computed_at: string;
}

export async function backfillEvidenceTrace(client: DbTxClient, input: EvidenceTraceBackfillInput = {}): Promise<EvidenceTraceBackfillSummary> {
  const limit = input.limit ?? 1000;
  const activeOnly = input.active_only !== false;
  const rows = await client.query<EvidenceTraceBackfillRow>(
    `SELECT ev.evidence_id, ev.cite_text, ev.extractor_id, ev.llm_meta, ev.doc_id, ev.chunk_id,
            d.bytes_sha256, d.metadata, c.text AS chunk_text,
            e.subject_id, e.object_id, e.relation, e.component, e.component_id, e.component_specificity
     FROM evidence ev
     JOIN documents d ON d.doc_id = ev.doc_id
     LEFT JOIN document_chunks c ON c.chunk_id = ev.chunk_id
     LEFT JOIN edges e ON e.edge_id = ev.edge_id
     WHERE ($2::boolean = false OR ev.superseded_by IS NULL)
       AND (
         ev.cite_text_sha256 IS NULL
         OR ev.normalized_cite_text_sha256 IS NULL
         OR ev.source_snapshot_sha256 IS NULL
         OR ev.parser_version IS NULL
         OR ev.extractor_version IS NULL
         OR ev.relation_candidate_hash IS NULL
         OR (ev.chunk_id IS NOT NULL AND (ev.cite_start_char IS NULL OR ev.cite_end_char IS NULL))
       )
     ORDER BY ev.created_at, ev.evidence_id
     LIMIT $1`,
    [limit, activeOnly]
  );

  let updated = 0;
  let offsetMissing = 0;
  for (const row of rows.rows) {
    const llmMeta = parseLlmMeta(row.llm_meta);
    const trace = buildEvidenceTrace({
      cite_text: row.cite_text,
      extractor_id: row.extractor_id,
      ...(llmMeta === undefined ? {} : { llm_meta: llmMeta }),
      source_snapshot_sha256: row.bytes_sha256,
      document_metadata: row.metadata,
      identity: {
        subject_id: row.subject_id,
        object_id: row.object_id,
        relation: row.relation,
        component: {
          component: row.component,
          component_id: row.component_id,
          component_specificity: row.component_specificity
        }
      },
      ...(row.chunk_text === null ? {} : { chunk_text: row.chunk_text })
    });

    await client.query(
      `UPDATE evidence
       SET cite_start_char = $2,
           cite_end_char = $3,
           cite_text_sha256 = $4,
           normalized_cite_text_sha256 = $5,
           source_snapshot_sha256 = $6,
           parser_version = $7,
           extractor_version = $8,
           relation_candidate_hash = $9
       WHERE evidence_id = $1`,
      [
        row.evidence_id,
        trace.cite_start_char,
        trace.cite_end_char,
        trace.cite_text_sha256,
        trace.normalized_cite_text_sha256,
        trace.source_snapshot_sha256,
        trace.parser_version,
        trace.extractor_version,
        trace.relation_candidate_hash
      ]
    );
    updated += 1;
    if (row.chunk_id !== null && (trace.cite_start_char === null || trace.cite_end_char === null)) offsetMissing += 1;
  }

  return { scanned: rows.rowCount ?? rows.rows.length, updated, offset_missing: offsetMissing };
}

export async function backfillEvidenceTraceTransactionally(
  store: DatabaseStore,
  input: EvidenceTraceBackfillInput = {}
): Promise<EvidenceTraceBackfillSummary> {
  const limit = input.limit ?? 1000;
  const batchSize = input.batch_size ?? Math.min(limit, 100);
  if (!Number.isInteger(limit) || limit <= 0) throw new Error(`Evidence trace backfill limit must be a positive integer: ${limit}`);
  if (!Number.isInteger(batchSize) || batchSize <= 0) throw new Error(`Evidence trace backfill batch_size must be a positive integer: ${batchSize}`);

  let scanned = 0;
  let updated = 0;
  let offsetMissing = 0;
  while (scanned < limit) {
    const nextLimit = Math.min(batchSize, limit - scanned);
    const batch = await store.transaction((client) =>
      backfillEvidenceTrace(client, {
        limit: nextLimit,
        ...(input.active_only === undefined ? {} : { active_only: input.active_only })
      })
    );
    scanned += batch.scanned;
    updated += batch.updated;
    offsetMissing += batch.offset_missing;
    if (batch.scanned < nextLimit) break;
  }
  return { scanned, updated, offset_missing: offsetMissing };
}

export async function refreshEdgeIntelligenceContext(client: DbTxClient, input: RefreshEdgeIntelligenceInput): Promise<EdgeIntelligenceRefreshSummary> {
  const generatedBy = input.generated_by ?? "evidence-maintenance.intelligence-refresh.v1";
  const computedAt = input.computed_at;
  const edges = await listRefreshableIntelligenceEdges(client, { minEvidenceLevel: input.min_evidence_level ?? 4, limit: input.limit ?? 1000 });
  const edgeIds = edges.map((edge) => edge.edge_id);
  const freshness = await refreshEdgeFreshness(client, { edgeIds, computedAt });
  const existingStrengths = await listEdgeStrengthEstimates(client, edgeIds);
  const existingStrengthEdgeIds = new Set(existingStrengths.map((strength) => strength.edge_id));

  let strengthsUpserted = 0;
  let edgesWithStrength = 0;
  let unknownsInserted = 0;
  let unknownsUpdated = 0;

  for (const edge of edges) {
    const drafts = inferEdgeStrengthDrafts(edge);
    for (const draft of drafts) {
      await upsertEdgeStrengthEstimate(client, {
        edge_id: edge.edge_id,
        strength_kind: draft.strength_kind,
        ...(draft.value === undefined ? {} : { value: draft.value }),
        ...(draft.lower_bound === undefined ? {} : { lower_bound: draft.lower_bound }),
        ...(draft.upper_bound === undefined ? {} : { upper_bound: draft.upper_bound }),
        ...(draft.unit === undefined ? {} : { unit: draft.unit }),
        evidence_id: edge.primary_evidence_id,
        method: draft.method,
        ...(edge.source_date === null ? {} : { valid_from: toDateOnly(edge.source_date) }),
        attrs: { ...draft.attrs, generated_by: generatedBy }
      });
      strengthsUpserted += 1;
    }

    const hasStrength = drafts.length > 0 || existingStrengthEdgeIds.has(edge.edge_id);
    if (hasStrength) {
      edgesWithStrength += 1;
      continue;
    }

    if (input.create_unknowns !== false) {
      const unknown = await upsertUnknownItem(client, missingStrengthUnknown(edge, generatedBy));
      if (unknown.inserted) {
        unknownsInserted += 1;
      } else {
        unknownsUpdated += 1;
      }
    }
  }

  return {
    scanned: edges.length,
    freshness_refreshed: freshness.length,
    strengths_upserted: strengthsUpserted,
    edges_with_strength: edgesWithStrength,
    unknowns_inserted: unknownsInserted,
    unknowns_updated: unknownsUpdated,
    unknowns_resolved: 0,
    generated_by: generatedBy,
    computed_at: computedAt
  };
}

export async function refreshEdgeIntelligenceContextTransactionally(
  store: DatabaseStore,
  input: RefreshEdgeIntelligenceInput
): Promise<EdgeIntelligenceRefreshSummary> {
  return store.transaction((client) => refreshEdgeIntelligenceContext(client, input));
}

async function listRefreshableIntelligenceEdges(client: DbClient, input: { minEvidenceLevel: 4 | 5; limit: number }): Promise<IntelligenceRefreshEdgeRow[]> {
  const result = await client.query<IntelligenceRefreshEdgeRow>(
    `SELECT e.edge_id, e.subject_id, s.display_name AS subject_name,
            e.object_id, o.display_name AS object_name, e.relation, e.component, e.component_id,
            e.evidence_level, e.primary_evidence_id, ev.cite_text, d.source_date
     FROM edges e
     JOIN entity_master s ON s.entity_id = e.subject_id
     JOIN entity_master o ON o.entity_id = e.object_id
     JOIN evidence ev ON ev.evidence_id = e.primary_evidence_id
     JOIN documents d ON d.doc_id = ev.doc_id
     WHERE e.validity = 'current'
       AND e.evidence_level >= $1
       AND e.is_inferred = false
       AND e.primary_evidence_id IS NOT NULL
     ORDER BY e.evidence_level DESC, e.confidence DESC, e.edge_id
     LIMIT $2`,
    [input.minEvidenceLevel, input.limit]
  );
  return result.rows;
}

function missingStrengthUnknown(edge: IntelligenceRefreshEdgeRow, createdBy: string) {
  const componentText = edge.component_id ?? edge.component ?? "the disclosed component or relationship scope";
  return {
    unknown_id: deterministicEdgeStrengthUnknownId(edge.edge_id),
    scope_kind: "edge",
    scope_id: edge.edge_id,
    question: `What public evidence quantifies relationship strength for ${edge.subject_name} -> ${edge.object_name} (${componentText})?`,
    why_unknown:
      "The Level 4/5 fact edge has primary evidence, but the cited text does not disclose share, spend band, dependency, capacity, or explicit qualitative strength.",
    blocking_data_sources: ["counterparty allocation disclosure", "contract pricing or capacity schedule", "supplier/customer corroborating filing"],
    proxies: ["purchase obligation observations", "supplier capex commentary", "component trade or material observations"],
    created_by: createdBy
  };
}

function deterministicEdgeStrengthUnknownId(edgeId: string): string {
  const digest = createHash("sha256").update(`edge-strength:${edgeId}`).digest("hex").slice(0, 20).toUpperCase();
  return `UNK-EDGE-STRENGTH-${digest}`;
}

function toDateOnly(value: Date | string): string {
  return (value instanceof Date ? value.toISOString() : value).slice(0, 10);
}

function parseLlmMeta(value: unknown): CandidateRelation["llm_meta"] | undefined {
  if (!isRecord(value)) return undefined;
  const model = value["model"];
  const promptHash = value["prompt_hash"];
  if (typeof model !== "string" || typeof promptHash !== "string") return undefined;
  return { model, prompt_hash: promptHash };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
