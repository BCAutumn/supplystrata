import type pg from "pg";
import { resolveEntityId } from "@supplystrata/db";
import type { EvidenceLevel, RelationType } from "@supplystrata/core";

type OutputFormat = "markdown" | "json";

interface EntityHeaderRow extends pg.QueryResultRow {
  entity_id: string;
  canonical_name: string;
  display_name: string;
}

export interface ChainEdge {
  depth: number;
  edge_id: string;
  relation: RelationType;
  subject_id: string;
  subject_name: string;
  object_id: string;
  object_name: string;
  upstream_id: string;
  upstream_name: string;
  component: string | null;
  component_id: string | null;
  evidence_level: EvidenceLevel;
  confidence: number;
  primary_evidence_id: string | null;
  cite_text: string | null;
}

interface ChainEdgeRow extends pg.QueryResultRow {
  depth: number;
  edge_id: string;
  relation: RelationType;
  subject_id: string;
  subject_name: string;
  object_id: string;
  object_name: string;
  upstream_id: string;
  upstream_name: string;
  component: string | null;
  component_id: string | null;
  evidence_level: EvidenceLevel;
  confidence: number;
  primary_evidence_id: string | null;
  cite_text: string | null;
}

export async function renderChain(
  pool: pg.Pool,
  query: string,
  input: { depth: number; format: OutputFormat },
): Promise<string> {
  const entityId = await resolveEntityId(pool, query);
  const headerResult = await pool.query<EntityHeaderRow>(
    "SELECT entity_id, canonical_name, display_name FROM entity_master WHERE entity_id = $1",
    [entityId],
  );
  const header = headerResult.rows[0];
  if (header === undefined) throw new Error(`Entity not found: ${entityId}`);
  const edges = await loadUpstreamChainEdges(pool, entityId, input.depth);
  return renderChainCard(
    {
      root: header,
      max_depth: input.depth,
      edges,
    },
    input.format,
  );
}

export function renderChainCard(
  card: {
    root: EntityHeaderRow;
    max_depth: number;
    edges: readonly ChainEdge[];
  },
  format: OutputFormat,
): string {
  if (format === "json")
    return JSON.stringify({ schema_version: "1.0.0", ...card }, null, 2);

  const lines = [
    `# Supply Chain ${card.root.display_name} [${card.root.entity_id}]`,
    "",
    `Max depth: ${card.max_depth}`,
    `Edges: ${card.edges.length}`,
    "",
    "## Upstream chain",
    "",
  ];
  if (card.edges.length === 0) {
    lines.push("(no Level 4-5 upstream chain edges yet)");
    return lines.join("\n");
  }
  for (const edge of card.edges) {
    const indent = "  ".repeat(edge.depth - 1);
    const component = edge.component === null ? "" : ` (${edge.component})`;
    lines.push(
      `${indent}- depth ${edge.depth}: ${edge.subject_name} -${edge.relation}${component}-> ${edge.object_name}`,
    );
    lines.push(
      `${indent}  Upstream node: ${edge.upstream_name} [${edge.upstream_id}]`,
    );
    lines.push(
      `${indent}  Evidence: Level ${edge.evidence_level}, conf ${edge.confidence.toFixed(3)}${edge.primary_evidence_id === null ? "" : `, ${edge.primary_evidence_id}`}`,
    );
    if (edge.cite_text !== null) lines.push(`${indent}  "${edge.cite_text}"`);
  }
  return lines.join("\n");
}

async function loadUpstreamChainEdges(
  pool: pg.Pool,
  rootEntityId: string,
  maxDepth: number,
): Promise<ChainEdge[]> {
  const depth = Math.min(Math.max(maxDepth, 1), 5);
  const result = await pool.query<ChainEdgeRow>(
    `WITH RECURSIVE walk AS (
       SELECT $1::text AS node_id, ARRAY[$1::text] AS path, 0 AS depth
       UNION ALL
       SELECT next_edge.upstream_id,
              walk.path || next_edge.upstream_id,
              walk.depth + 1
       FROM walk
       JOIN LATERAL (
         SELECT CASE
                  WHEN e.relation IN ('BUYS_FROM','USES_FOUNDRY') AND e.subject_id = walk.node_id THEN e.object_id
                  WHEN e.relation = 'SUPPLIES_TO' AND e.object_id = walk.node_id THEN e.subject_id
                  WHEN e.relation = 'MANUFACTURES_AT' AND e.subject_id = walk.node_id THEN e.object_id
                END AS upstream_id
         FROM edges e
         WHERE e.validity = 'current'
           AND e.evidence_level >= 4
           AND (
             (e.relation IN ('BUYS_FROM','USES_FOUNDRY','MANUFACTURES_AT') AND e.subject_id = walk.node_id)
             OR (e.relation = 'SUPPLIES_TO' AND e.object_id = walk.node_id)
           )
       ) next_edge ON next_edge.upstream_id IS NOT NULL
       WHERE walk.depth < $2
         AND NOT next_edge.upstream_id = ANY(walk.path)
     ),
     chain_edges AS (
       SELECT walk.depth + 1 AS depth,
              e.edge_id, e.relation,
              e.subject_id, s.display_name AS subject_name,
              e.object_id, o.display_name AS object_name,
              CASE
                WHEN e.relation IN ('BUYS_FROM','USES_FOUNDRY','MANUFACTURES_AT') AND e.subject_id = walk.node_id THEN e.object_id
                WHEN e.relation = 'SUPPLIES_TO' AND e.object_id = walk.node_id THEN e.subject_id
              END AS upstream_id,
              CASE
                WHEN e.relation IN ('BUYS_FROM','USES_FOUNDRY','MANUFACTURES_AT') AND e.subject_id = walk.node_id THEN o.display_name
                WHEN e.relation = 'SUPPLIES_TO' AND e.object_id = walk.node_id THEN s.display_name
              END AS upstream_name,
              e.component, e.component_id, e.evidence_level, e.confidence, e.primary_evidence_id, ev.cite_text
       FROM walk
       JOIN edges e ON e.validity = 'current'
        AND e.evidence_level >= 4
        AND (
          (e.relation IN ('BUYS_FROM','USES_FOUNDRY','MANUFACTURES_AT') AND e.subject_id = walk.node_id)
          OR (e.relation = 'SUPPLIES_TO' AND e.object_id = walk.node_id)
        )
       JOIN entity_master s ON s.entity_id = e.subject_id
       JOIN entity_master o ON o.entity_id = e.object_id
       LEFT JOIN evidence ev ON ev.evidence_id = e.primary_evidence_id
       WHERE walk.depth < $2
     )
     SELECT depth, edge_id, relation, subject_id, subject_name, object_id, object_name,
            upstream_id, upstream_name, component, component_id, evidence_level, confidence, primary_evidence_id, cite_text
     FROM chain_edges
     WHERE upstream_id IS NOT NULL
     ORDER BY depth, subject_name, relation, object_name`,
    [rootEntityId, depth],
  );
  return result.rows.map((row) => ({
    depth: row.depth,
    edge_id: row.edge_id,
    relation: row.relation,
    subject_id: row.subject_id,
    subject_name: row.subject_name,
    object_id: row.object_id,
    object_name: row.object_name,
    upstream_id: row.upstream_id,
    upstream_name: row.upstream_name,
    component: row.component,
    component_id: row.component_id,
    evidence_level: row.evidence_level,
    confidence: row.confidence,
    primary_evidence_id: row.primary_evidence_id,
    cite_text: row.cite_text,
  }));
}
