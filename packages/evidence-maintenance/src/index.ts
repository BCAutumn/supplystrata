import type pg from "pg";
import { createHash } from "node:crypto";
import type { CandidateRelation, ComponentSpecificity, EdgeStrengthKind, EvidenceLevel, RelationType } from "@supplystrata/core";
import type { DbClient } from "@supplystrata/db";
import { listEdgeStrengthEstimates, recordSemanticChange, refreshEdgeFreshness, upsertEdgeStrengthEstimate, upsertUnknownItem } from "@supplystrata/db";
import { buildEvidenceTrace } from "@supplystrata/evidence-trace";

export * from "./alerts.js";
export * from "./calibration.js";
export * from "./component-risk.js";
export * from "./financial-peer-comparison.js";
export * from "./observation-anomaly.js";

interface EvidenceTraceBackfillRow extends pg.QueryResultRow {
  evidence_id: string;
  cite_text: string;
  extractor_id: string | null;
  llm_meta: unknown;
  doc_id: string;
  chunk_id: string | null;
  bytes_sha256: string;
  metadata: Record<string, unknown>;
  chunk_text: string | null;
  subject_id: string | null;
  object_id: string | null;
  relation: RelationType | null;
  component: string | null;
  component_id: string | null;
  component_specificity: ComponentSpecificity | null;
}

interface IntelligenceRefreshEdgeRow extends pg.QueryResultRow {
  edge_id: string;
  subject_id: string;
  subject_name: string;
  object_id: string;
  object_name: string;
  relation: RelationType;
  component: string | null;
  component_id: string | null;
  evidence_level: EvidenceLevel;
  primary_evidence_id: string;
  cite_text: string;
  source_date: Date | string | null;
}

export interface EvidenceTraceBackfillSummary {
  scanned: number;
  updated: number;
  offset_missing: number;
}

export interface RefreshEdgeIntelligenceInput {
  min_evidence_level?: 4 | 5;
  limit?: number;
  computed_at?: string;
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

export interface EdgeStrengthDraft {
  strength_kind: EdgeStrengthKind;
  value?: string;
  lower_bound?: string;
  upper_bound?: string;
  unit?: string;
  method: string;
  attrs: Record<string, unknown>;
}

export async function backfillEvidenceTrace(client: DbClient, input: { limit?: number } = {}): Promise<EvidenceTraceBackfillSummary> {
  const limit = input.limit ?? 1000;
  const rows = await client.query<EvidenceTraceBackfillRow>(
    `SELECT ev.evidence_id, ev.cite_text, ev.extractor_id, ev.llm_meta, ev.doc_id, ev.chunk_id,
            d.bytes_sha256, d.metadata, c.text AS chunk_text,
            e.subject_id, e.object_id, e.relation, e.component, e.component_id, e.component_specificity
     FROM evidence ev
     JOIN documents d ON d.doc_id = ev.doc_id
     LEFT JOIN document_chunks c ON c.chunk_id = ev.chunk_id
     LEFT JOIN edges e ON e.edge_id = ev.edge_id
     WHERE ev.cite_text_sha256 IS NULL
        OR ev.normalized_cite_text_sha256 IS NULL
        OR ev.source_snapshot_sha256 IS NULL
        OR ev.parser_version IS NULL
        OR ev.extractor_version IS NULL
        OR ev.relation_candidate_hash IS NULL
        OR (ev.chunk_id IS NOT NULL AND (ev.cite_start_char IS NULL OR ev.cite_end_char IS NULL))
     ORDER BY ev.created_at, ev.evidence_id
     LIMIT $1`,
    [limit]
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

export async function refreshEdgeIntelligenceContext(client: DbClient, input: RefreshEdgeIntelligenceInput = {}): Promise<EdgeIntelligenceRefreshSummary> {
  const generatedBy = input.generated_by ?? "evidence-maintenance.intelligence-refresh.v1";
  const computedAt = input.computed_at ?? new Date().toISOString();
  const edges = await listRefreshableIntelligenceEdges(client, { minEvidenceLevel: input.min_evidence_level ?? 4, limit: input.limit ?? 1000 });
  const edgeIds = edges.map((edge) => edge.edge_id);
  const freshness = await refreshEdgeFreshness(client, { edgeIds, computedAt });
  const existingStrengths = await listEdgeStrengthEstimates(client, edgeIds);
  const existingStrengthEdgeIds = new Set(existingStrengths.map((strength) => strength.edge_id));

  let strengthsUpserted = 0;
  let edgesWithStrength = 0;
  let unknownsInserted = 0;
  let unknownsUpdated = 0;
  let unknownsResolved = 0;

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
      unknownsResolved += await resolveGeneratedStrengthUnknownIfOpen(client, {
        edge,
        evidenceId: edge.primary_evidence_id,
        reviewer: generatedBy
      });
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
    unknowns_resolved: unknownsResolved,
    generated_by: generatedBy,
    computed_at: computedAt
  };
}

export function inferEdgeStrengthDrafts(edge: { cite_text: string; object_name: string }): EdgeStrengthDraft[] {
  const text = normalizeWhitespace(edge.cite_text);
  // 强度只能来自命名 counterparty 的原文证据；匿名 customer/supplier concentration 只能留下 unknown。
  if (!mentionsCounterparty(text, edge.object_name)) return [];

  const drafts: EdgeStrengthDraft[] = [];
  const share = extractNamedShare(text);
  if (share !== undefined) {
    drafts.push({
      strength_kind: "share",
      value: share,
      unit: "percent",
      method: "intelligence-refresh.named-share-text.v1",
      attrs: { source: "primary_evidence_cite_text", signal: "named_percentage_share" }
    });
  }

  const dependency = dependencySignal(text);
  if (dependency !== undefined) drafts.push(dependency);

  if (
    /\b(?:capacity reservations?|capacity commitments?|capacity reservation agreements?|take[-\s]?or[-\s]?pay|purchase obligations?|purchase commitments?|long[-\s]?term supply agreements?|wafer supply agreements?)\b/i.test(
      text
    )
  ) {
    drafts.push({
      strength_kind: "capacity",
      value: "1",
      unit: "disclosed_commitment",
      method: "intelligence-refresh.capacity-text.v1",
      attrs: { source: "primary_evidence_cite_text", signal: "capacity_or_purchase_commitment" }
    });
  }

  const qualitative = qualitativeSignal(text);
  if (qualitative !== undefined) drafts.push(qualitative);

  return dedupeStrengthDrafts(drafts);
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

function extractNamedShare(text: string): string | undefined {
  if (!/\b(?:accounted for|represented|comprised|made up|contributed)\b/i.test(text)) return undefined;
  if (!/\b(?:revenue|sales|purchases?|spend|supply|capacity|cost|costs|obligations?)\b/i.test(text)) return undefined;
  const match = /\b(\d{1,2}(?:\.\d+)?|100(?:\.0+)?)\s?%/u.exec(text);
  if (match?.[1] === undefined) return undefined;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0 || value > 100) return undefined;
  return value.toString();
}

function dependencySignal(text: string): EdgeStrengthDraft | undefined {
  if (/\b(?:sole source|single source|single-source|sole supplier|single supplier)\b/i.test(text)) {
    return {
      strength_kind: "dependency",
      value: "1",
      unit: "dependency_index",
      method: "intelligence-refresh.dependency-text.v1",
      attrs: { source: "primary_evidence_cite_text", signal: "single_source_dependency", dependency_kind: "single_source" }
    };
  }
  if (/\b(?:limited number of suppliers|limited suppliers|limited supplier base|few suppliers)\b/i.test(text)) {
    return {
      strength_kind: "dependency",
      value: "0.7",
      unit: "dependency_index",
      method: "intelligence-refresh.dependency-text.v1",
      attrs: { source: "primary_evidence_cite_text", signal: "limited_supplier_dependency", dependency_kind: "limited_supplier" }
    };
  }
  return undefined;
}

function qualitativeSignal(text: string): EdgeStrengthDraft | undefined {
  if (/\b(?:primary|principal|strategic|key|major|significant|main)\s+(?:supplier|customer|foundry|manufacturer|partner)\b/i.test(text)) {
    return {
      strength_kind: "qualitative",
      value: "1",
      unit: "qualitative_flag",
      method: "intelligence-refresh.qualitative-text.v1",
      attrs: { source: "primary_evidence_cite_text", signal: "explicit_strong_relationship_language" }
    };
  }
  return undefined;
}

function dedupeStrengthDrafts(drafts: readonly EdgeStrengthDraft[]): EdgeStrengthDraft[] {
  const byKind = new Map<EdgeStrengthKind, EdgeStrengthDraft>();
  for (const draft of drafts) {
    if (!byKind.has(draft.strength_kind)) byKind.set(draft.strength_kind, draft);
  }
  return [...byKind.values()];
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

async function resolveGeneratedStrengthUnknownIfOpen(
  client: DbClient,
  input: { edge: IntelligenceRefreshEdgeRow; evidenceId: string; reviewer: string }
): Promise<number> {
  const unknownId = deterministicEdgeStrengthUnknownId(input.edge.edge_id);
  const result = await client.query<{ unknown_id: string } & pg.QueryResultRow>(
    `UPDATE unknown_items
     SET status = 'resolved',
         resolved_at = now(),
         resolved_evidence_ids = $2
     WHERE unknown_id = $1 AND status = 'open'
     RETURNING unknown_id`,
    [unknownId, [input.evidenceId]]
  );
  const row = result.rows[0];
  if (row === undefined) return 0;
  await recordSemanticChange(client, {
    scope_kind: "unknown",
    scope_id: row.unknown_id,
    change_type: "UNKNOWN_RESOLVED",
    after: { resolved_by: "edge_strength_estimate", edge_id: input.edge.edge_id },
    evidence_ids: [input.evidenceId],
    caused_by: input.reviewer
  });
  return 1;
}

function deterministicEdgeStrengthUnknownId(edgeId: string): string {
  const digest = createHash("sha256").update(`edge-strength:${edgeId}`).digest("hex").slice(0, 20).toUpperCase();
  return `UNK-EDGE-STRENGTH-${digest}`;
}

function mentionsCounterparty(text: string, objectName: string): boolean {
  const textTokens = normalizeForMention(text);
  const objectTokens = normalizeForMention(objectName);
  if (objectTokens.length === 0) return false;
  return textTokens.includes(objectTokens);
}

function normalizeForMention(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\b(?:inc|incorporated|corp|corporation|co|company|ltd|limited|plc)\b\.?/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function normalizeWhitespace(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
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
