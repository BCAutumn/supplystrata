import type pg from "pg";
import type { EvidenceLevel, RelationType } from "@supplystrata/core";
import type { DbClient } from "@supplystrata/db/read";

export interface Gate1AdjacentOfficialFactsInput {
  generated_at: string;
  company_id: string;
  component_ids: readonly string[];
  visible_edge_ids: readonly string[];
  limit?: number;
}

export interface Gate1AdjacentOfficialFactsReport {
  schema_version: "1.0.0";
  generated_at: string;
  company_id: string;
  summary: Gate1AdjacentOfficialFactsSummary;
  edges: Gate1AdjacentOfficialFactEdge[];
}

export interface Gate1AdjacentOfficialFactsSummary {
  fact_edges: number;
  companies: number;
  components: number;
  source_adapters: number;
  visible_edge_exclusions: number;
  policy: "adjacent_context_only_no_fact_mutation";
}

export interface Gate1AdjacentOfficialFactEdge {
  edge_id: string;
  from_id: string;
  from_name: string;
  from_industry: string[];
  to_id: string;
  to_name: string;
  to_industry: string[];
  relation: RelationType;
  component_id: string;
  component_name: string | null;
  component_attribution_kind: "edge_component" | "counterparty_industry";
  component_attribution_reason: string;
  evidence_level: EvidenceLevel;
  confidence: number;
  evidence_ids: string[];
  source_adapters: string[];
  source_urls: string[];
}

interface AdjacentOfficialFactEdgeRow extends pg.QueryResultRow {
  edge_id: string;
  from_id: string;
  from_name: string;
  from_kind: string;
  from_industry: string[];
  to_id: string;
  to_name: string;
  to_kind: string;
  to_industry: string[];
  relation: RelationType;
  component_id: string | null;
  component_name: string | null;
  evidence_level: EvidenceLevel;
  confidence: number;
  evidence_ids: string[];
  source_adapters: string[];
  source_urls: string[];
}

export async function loadGate1AdjacentOfficialFacts(client: DbClient, input: Gate1AdjacentOfficialFactsInput): Promise<Gate1AdjacentOfficialFactsReport> {
  const componentIds = uniqueSorted(input.component_ids);
  const visibleEdgeIds = uniqueSorted(input.visible_edge_ids);
  if (componentIds.length === 0) return emptyAdjacentFacts(input, visibleEdgeIds.length);

  const result = await client.query<AdjacentOfficialFactEdgeRow>(
    `SELECT e.edge_id,
            e.subject_id AS from_id,
            subject.display_name AS from_name,
            subject.kind AS from_kind,
            subject.industry AS from_industry,
            e.object_id AS to_id,
            object.display_name AS to_name,
            object.kind AS to_kind,
            object.industry AS to_industry,
            e.relation,
            e.component_id,
            c.name AS component_name,
            e.evidence_level,
            e.confidence,
            COALESCE(
              array_agg(DISTINCT ev.evidence_id) FILTER (WHERE ev.evidence_id IS NOT NULL),
              '{}'::text[]
            ) AS evidence_ids,
            COALESCE(
              array_agg(DISTINCT d.source_adapter_id) FILTER (WHERE d.source_adapter_id IS NOT NULL),
              '{}'::text[]
            ) AS source_adapters,
            COALESCE(
              array_agg(DISTINCT d.source_url) FILTER (WHERE d.source_url IS NOT NULL AND d.source_url <> ''),
              '{}'::text[]
            ) AS source_urls
       FROM edges e
       JOIN entity_master subject ON subject.entity_id = e.subject_id
       JOIN entity_master object ON object.entity_id = e.object_id
       LEFT JOIN components c ON c.component_id = e.component_id
       LEFT JOIN evidence ev
         ON ev.edge_id = e.edge_id
        AND ev.superseded_by IS NULL
        AND ev.evidence_level >= 4
        AND ev.is_inferred = false
       LEFT JOIN documents d ON d.doc_id = ev.doc_id
      WHERE e.validity = 'current'
        AND e.is_inferred = false
        AND e.evidence_level >= 4
        AND (
          e.component_id = ANY($1::text[])
          OR e.component_id IS NULL
        )
        AND NOT (e.edge_id = ANY($2::text[]))
        AND subject.kind IN ('company', 'business_unit')
        AND object.kind IN ('company', 'business_unit')
      GROUP BY e.edge_id, subject.display_name, subject.kind, subject.industry, object.display_name, object.kind, object.industry, c.name
      ORDER BY e.evidence_level DESC, e.confidence DESC, e.edge_id
      LIMIT $3`,
    [componentIds, visibleEdgeIds, input.limit ?? 500]
  );

  const edges = result.rows.flatMap((row) => adjacentFactEdgesFromRow(row, componentIds));
  return {
    schema_version: "1.0.0",
    generated_at: input.generated_at,
    company_id: input.company_id,
    summary: {
      fact_edges: edges.length,
      companies: uniqueSorted(edges.flatMap((edge) => [edge.from_id, edge.to_id])).length,
      components: uniqueSorted(edges.map((edge) => edge.component_id)).length,
      source_adapters: uniqueSorted(edges.flatMap((edge) => edge.source_adapters)).length,
      visible_edge_exclusions: visibleEdgeIds.length,
      policy: "adjacent_context_only_no_fact_mutation"
    },
    edges
  };
}

function adjacentFactEdgesFromRow(row: AdjacentOfficialFactEdgeRow, componentIds: readonly string[]): Gate1AdjacentOfficialFactEdge[] {
  if (row.component_id !== null) {
    return [
      adjacentFactEdgeFromRow(row, {
        componentId: row.component_id,
        componentName: row.component_name,
        attributionKind: "edge_component",
        attributionReason: "The fact edge already carries this component_id."
      })
    ];
  }

  return inferredRelevantComponentIds(row, componentIds).map((match) =>
    adjacentFactEdgeFromRow(row, {
      componentId: match.componentId,
      componentName: null,
      attributionKind: "counterparty_industry",
      attributionReason: match.reason
    })
  );
}

function adjacentFactEdgeFromRow(
  row: AdjacentOfficialFactEdgeRow,
  component: {
    componentId: string;
    componentName: string | null;
    attributionKind: Gate1AdjacentOfficialFactEdge["component_attribution_kind"];
    attributionReason: string;
  }
): Gate1AdjacentOfficialFactEdge {
  return {
    edge_id: row.edge_id,
    from_id: row.from_id,
    from_name: row.from_name,
    from_industry: uniqueSorted(row.from_industry),
    to_id: row.to_id,
    to_name: row.to_name,
    to_industry: uniqueSorted(row.to_industry),
    relation: row.relation,
    component_id: component.componentId,
    component_name: component.componentName,
    component_attribution_kind: component.attributionKind,
    component_attribution_reason: component.attributionReason,
    evidence_level: row.evidence_level,
    confidence: row.confidence,
    evidence_ids: uniqueSorted(row.evidence_ids),
    source_adapters: uniqueSorted(row.source_adapters),
    source_urls: uniqueSorted(row.source_urls)
  };
}

function inferredRelevantComponentIds(
  row: Pick<AdjacentOfficialFactEdgeRow, "from_industry" | "to_industry">,
  componentIds: readonly string[]
): { componentId: string; reason: string }[] {
  const industryTokens = uniqueSorted([...row.from_industry, ...row.to_industry].map((token) => token.toLowerCase()));
  return componentIds
    .flatMap((componentId) => {
      const matchedTokens = componentIndustryTokens(componentId).filter((token) => industryTokens.includes(token));
      if (matchedTokens.length === 0) return [];
      return [
        {
          componentId,
          reason: `Matched curated counterparty industry tag(s): ${matchedTokens.join(", ")}.`
        }
      ];
    })
    .slice(0, 3);
}

export function componentIndustryTokens(componentId: string): string[] {
  const tokensByComponent: Record<string, string[]> = {
    "COMP-MANUFACTURING-SERVICES": ["odm", "server", "electronics-manufacturing"],
    "COMP-MEMORY": ["memory", "hbm"],
    "COMP-HBM": ["hbm", "memory"],
    "COMP-DRAM": ["dram", "memory"],
    "COMP-PCB": ["pcb", "substrate"],
    "COMP-CCL": ["laminate", "laminate-resin", "pcb"],
    "COMP-LAMINATE-RESIN": ["laminate-resin", "adhesives"],
    "COMP-COPPER-FOIL": ["copper"],
    "COMP-ELECTRONIC-GLASS-CLOTH": ["glass", "electronic-materials"],
    "COMP-OPTICAL-MODULE": ["optical"],
    "COMP-POWER-SUPPLY": ["power"],
    "COMP-COOLING": ["cooling"],
    "COMP-SILICON-WAFER": ["silicon-wafer"],
    "COMP-WAFER": ["semiconductor-fab"],
    "COMP-PHOTORESIST": ["photoresist"],
    "COMP-SPECIALTY-GASES": ["gases"]
  };
  return tokensByComponent[componentId] ?? [];
}

function emptyAdjacentFacts(input: Gate1AdjacentOfficialFactsInput, visibleEdgeExclusions: number): Gate1AdjacentOfficialFactsReport {
  return {
    schema_version: "1.0.0",
    generated_at: input.generated_at,
    company_id: input.company_id,
    summary: {
      fact_edges: 0,
      companies: 0,
      components: 0,
      source_adapters: 0,
      visible_edge_exclusions: visibleEdgeExclusions,
      policy: "adjacent_context_only_no_fact_mutation"
    },
    edges: []
  };
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
