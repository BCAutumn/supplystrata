import type { EvidenceLevel } from "@supplystrata/core";
import { getComponentTradeTaxonomy } from "@supplystrata/component-context";
import {
  getEvidence,
  listEdgeFreshness,
  listEdgeStrengthEstimates,
  listObservationsByScope,
  listUnknownItems,
  resolveEntityId,
  type DbClient
} from "@supplystrata/db/read";
import { buildCompanyChainView } from "@supplystrata/chain-view-builder";
import type { ChainViewModel } from "@supplystrata/chain-view";
import { loadCompanyTopExposureNodes } from "./company-risk.js";
import type { CompanyEdgeRow, CompanyHeaderRow, ComponentEdgeRow, ComponentHeaderRow } from "./db-rows.js";
import { companyEdgeFromRow, companyEntityFromRow, componentHeaderFromRow, toComponentEvidenceEdge, unknownMapItemFromRow } from "./dto-mappers.js";
import { loadCompanyFinancialPeerMetrics } from "./financial-peer.js";
import { companyObservationFromRowWithAnomaly, componentObservationFromRowWithAnomaly } from "./observation-anomaly.js";
import { loadComponentRiskView } from "./risk-view.js";
import type {
  CompanyCardModel,
  CompanyObservation,
  ComponentCardModel,
  ComponentEvidenceEdge,
  ComponentLinkedCompanyObservations,
  ComponentObservation,
  ComponentParticipant,
  EdgeIntelligenceSummary,
  EvidenceCardModel,
  UnknownMapModel
} from "@supplystrata/render";

export async function loadChainCard(client: DbClient, query: string, input: { depth: number }): Promise<ChainViewModel> {
  return buildCompanyChainView(client, { query, depth: input.depth });
}

export async function loadCompanyCard(client: DbClient, query: string): Promise<CompanyCardModel> {
  const entityId = await resolveEntityId(client, query);
  const header = await loadCompanyHeader(client, entityId);
  const upstreamEdges = await loadCompanyEdges(client, entityId, "upstream");
  const downstreamEdges = await loadCompanyEdges(client, entityId, "downstream");
  const intelligenceByEdgeId = await loadEdgeIntelligence(
    client,
    [...upstreamEdges, ...downstreamEdges].map((edge) => edge.edge_id)
  );
  const unknownItems = await listUnknownItems(client, entityId);
  return {
    entity: companyEntityFromRow(header),
    directly_disclosed_upstream: upstreamEdges.map((edge) => companyEdgeFromRow(edge, intelligenceByEdgeId)),
    directly_disclosed_downstream: downstreamEdges.map((edge) => companyEdgeFromRow(edge, intelligenceByEdgeId)),
    related_observations: await loadCompanyObservations(client, entityId),
    financial_peer_metrics: await loadCompanyFinancialPeerMetrics(client, entityId),
    top_exposure_nodes: await loadCompanyTopExposureNodes(client, upstreamEdges),
    unknown_map: unknownItems.map(unknownMapItemFromRow)
  };
}

export async function loadComponentCard(client: DbClient, query: string): Promise<ComponentCardModel> {
  const component = await resolveComponent(client, query);
  const edges = await loadComponentEdges(client, component);
  const intelligenceByEdgeId = await loadEdgeIntelligence(
    client,
    edges.map((edge) => edge.edge_id)
  );
  const evidenceEdges = edges.map((edge) => toComponentEvidenceEdge(edge, intelligenceByEdgeId));
  const riskView = await loadComponentRiskView(client, component.component_id);
  return {
    component: componentHeaderFromRow(component),
    known_suppliers: summarizeComponentParticipants(evidenceEdges, "supplier"),
    known_consumers: summarizeComponentParticipants(evidenceEdges, "consumer"),
    evidence_edges: evidenceEdges,
    source_coverage: summarizeComponentSourceCoverage(evidenceEdges),
    trade_taxonomy: componentTradeTaxonomyFromCatalog(component.component_id),
    related_observations: await loadComponentObservations(client, component.component_id),
    linked_company_observations: await loadLinkedCompanyObservations(client, evidenceEdges),
    risk_view: riskView,
    unknown_map: (await listUnknownItems(client, component.component_id)).map(unknownMapItemFromRow)
  };
}

export async function loadEvidenceCard(client: DbClient, evidenceId: string): Promise<EvidenceCardModel> {
  const evidence = await getEvidence(client, evidenceId);
  if (evidence === undefined) throw new Error(`Evidence not found: ${evidenceId}`);
  return {
    ...evidence,
    source_date: evidence.source_date === null ? null : evidence.source_date.toISOString(),
    fetched_at: evidence.fetched_at.toISOString()
  };
}

export async function loadUnknownMap(client: DbClient, query: string): Promise<UnknownMapModel> {
  const entityId = await resolveEntityId(client, query);
  const items = await listUnknownItems(client, entityId);
  return { scope: entityId, items: items.map(unknownMapItemFromRow) };
}

async function loadCompanyHeader(client: DbClient, entityId: string): Promise<CompanyHeaderRow> {
  const headerResult = await client.query<CompanyHeaderRow>("SELECT entity_id, canonical_name, display_name FROM entity_master WHERE entity_id = $1", [
    entityId
  ]);
  const header = headerResult.rows[0];
  if (header === undefined) throw new Error(`Entity not found: ${entityId}`);
  return header;
}

async function loadCompanyEdges(client: DbClient, entityId: string, direction: "upstream" | "downstream"): Promise<CompanyEdgeRow[]> {
  const relationFilter = direction === "upstream" ? "e.relation IN ('BUYS_FROM','USES_FOUNDRY','MANUFACTURES_AT')" : "e.relation = 'SUPPLIES_TO'";
  const result = await client.query<CompanyEdgeRow>(
    `SELECT e.edge_id, e.relation, e.component, e.component_id, e.component_specificity,
            e.object_id AS counterparty_id,
            o.display_name AS counterparty_name,
            e.evidence_level, e.confidence, e.is_inferred, e.primary_evidence_id,
            ev.cite_text, d.source_url, d.source_date
     FROM edges e
     JOIN entity_master o ON o.entity_id = e.object_id
     LEFT JOIN evidence ev ON ev.evidence_id = e.primary_evidence_id
     LEFT JOIN documents d ON d.doc_id = ev.doc_id
     WHERE e.subject_id = $1 AND e.validity = 'current' AND e.evidence_level >= 4
       AND ${relationFilter}
     ORDER BY e.evidence_level DESC, e.confidence DESC, o.display_name`,
    [entityId]
  );
  return result.rows;
}

async function resolveComponent(client: DbClient, query: string): Promise<ComponentHeaderRow> {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) throw new Error("Component query must not be empty");
  const result = await client.query<ComponentHeaderRow>(
    `SELECT component_id, name, taxonomy_path, aliases
     FROM components
     WHERE lower(component_id) = $1
        OR lower(name) = $1
        OR EXISTS (SELECT 1 FROM unnest(aliases) AS alias WHERE lower(alias) = $1)
     ORDER BY CASE WHEN lower(component_id) = $1 THEN 0 WHEN lower(name) = $1 THEN 1 ELSE 2 END, component_id
     LIMIT 1`,
    [normalized]
  );
  const component = result.rows[0];
  if (component === undefined) throw new Error(`Component not found: ${query}`);
  return component;
}

async function loadComponentEdges(client: DbClient, component: ComponentHeaderRow): Promise<ComponentEdgeRow[]> {
  const result = await client.query<ComponentEdgeRow>(
    `SELECT e.edge_id, e.relation,
            e.subject_id,
            s.display_name AS subject_name,
            e.object_id,
            o.display_name AS object_name,
            e.evidence_level, e.confidence, e.is_inferred, e.primary_evidence_id,
            ev.cite_text, d.source_url, d.source_date
     FROM edges e
     JOIN entity_master s ON s.entity_id = e.subject_id
     JOIN entity_master o ON o.entity_id = e.object_id
     LEFT JOIN evidence ev ON ev.evidence_id = e.primary_evidence_id
     LEFT JOIN documents d ON d.doc_id = ev.doc_id
     WHERE e.validity = 'current'
       AND e.evidence_level >= 4
       AND (
         e.component_id = $1
         OR (e.component_id IS NULL AND lower(e.component) = lower($2))
         OR (e.component_id IS NULL AND EXISTS (SELECT 1 FROM unnest($3::text[]) AS alias WHERE lower(e.component) = lower(alias)))
       )
     ORDER BY e.evidence_level DESC, e.confidence DESC, s.display_name, o.display_name`,
    [component.component_id, component.name, component.aliases]
  );
  return result.rows;
}

async function loadEdgeIntelligence(client: DbClient, edgeIds: readonly string[]): Promise<Map<string, EdgeIntelligenceSummary>> {
  const uniqueEdgeIds = [...new Set(edgeIds)].sort();
  const output = new Map<string, EdgeIntelligenceSummary>();
  if (uniqueEdgeIds.length === 0) return output;

  const [strengths, freshness] = await Promise.all([
    listEdgeStrengthEstimates(client, uniqueEdgeIds),
    listEdgeFreshness(client, { edgeIds: uniqueEdgeIds, computedAt: new Date().toISOString() })
  ]);
  const strengthsByEdgeId = groupByEdgeId(strengths);
  const freshnessByEdgeId = new Map(freshness.map((item) => [item.edge_id, item]));

  for (const edgeId of uniqueEdgeIds) {
    const unknowns = await listUnknownItems(client, edgeId);
    const freshnessRecord = freshnessByEdgeId.get(edgeId);
    output.set(edgeId, {
      strengths: (strengthsByEdgeId.get(edgeId) ?? []).map((strength) => ({
        strength_kind: strength.strength_kind,
        value: strength.value ?? null,
        unit: strength.unit ?? null,
        method: strength.method,
        evidence_id: strength.evidence_id ?? null
      })),
      freshness:
        freshnessRecord === undefined
          ? null
          : {
              last_verified_at: freshnessRecord.last_verified_at,
              age_days: freshnessRecord.age_days,
              freshness_score: freshnessRecord.freshness_score,
              decay_model: freshnessRecord.decay_model
            },
      unknowns: unknowns.map(unknownMapItemFromRow)
    });
  }

  return output;
}

function groupByEdgeId<T extends { edge_id: string }>(items: readonly T[]): Map<string, T[]> {
  const output = new Map<string, T[]>();
  for (const item of items) {
    const group = output.get(item.edge_id) ?? [];
    group.push(item);
    output.set(item.edge_id, group);
  }
  return output;
}

function componentTradeTaxonomyFromCatalog(componentId: string): ComponentCardModel["trade_taxonomy"] {
  const taxonomy = getComponentTradeTaxonomy(componentId);
  return {
    hs_codes: taxonomy?.hs_codes ?? [],
    materials: taxonomy?.materials ?? []
  };
}

function summarizeComponentParticipants(edges: readonly ComponentEvidenceEdge[], role: "supplier" | "consumer"): ComponentParticipant[] {
  const byEntity = new Map<string, ComponentParticipant>();
  for (const edge of edges) {
    const entityId = role === "supplier" ? edge.supplier_id : edge.consumer_id;
    const name = role === "supplier" ? edge.supplier_name : edge.consumer_name;
    const item = byEntity.get(entityId) ?? {
      entity_id: entityId,
      name,
      roles: [],
      edge_count: 0,
      best_evidence_level: edge.evidence_level,
      best_confidence: edge.confidence
    };
    item.edge_count += 1;
    item.best_evidence_level = Math.max(item.best_evidence_level, edge.evidence_level) as EvidenceLevel;
    item.best_confidence = Math.max(item.best_confidence, edge.confidence);
    if (!item.roles.includes(edge.relation)) item.roles.push(edge.relation);
    byEntity.set(entityId, item);
  }
  return [...byEntity.values()].sort(
    (left, right) => right.best_evidence_level - left.best_evidence_level || right.best_confidence - left.best_confidence || left.name.localeCompare(right.name)
  );
}

function summarizeComponentSourceCoverage(edges: readonly ComponentEvidenceEdge[]): {
  sources: number;
  evidence_edges: number;
  latest_source_date: string | null;
} {
  const sources = new Set<string>();
  let latestSourceDate: string | null = null;
  for (const edge of edges) {
    if (edge.source_url !== null) sources.add(edge.source_url);
    if (edge.source_date !== null) {
      const sourceDate = edge.source_date.slice(0, 10);
      if (latestSourceDate === null || sourceDate > latestSourceDate) latestSourceDate = sourceDate;
    }
  }
  return {
    sources: sources.size,
    evidence_edges: edges.length,
    latest_source_date: latestSourceDate
  };
}

async function loadCompanyObservations(client: DbClient, entityId: string): Promise<CompanyObservation[]> {
  const observations = await listObservationsByScope(client, { scope_kind: "company", scope_id: entityId, limit: 10 });
  return Promise.all(observations.map((observation) => companyObservationFromRowWithAnomaly(client, observation)));
}

async function loadComponentObservations(client: DbClient, componentId: string): Promise<ComponentObservation[]> {
  const observations = await listObservationsByScope(client, { scope_kind: "component", scope_id: componentId, limit: 10 });
  return Promise.all(observations.map((observation) => componentObservationFromRowWithAnomaly(client, observation)));
}

async function loadLinkedCompanyObservations(client: DbClient, edges: readonly ComponentEvidenceEdge[]): Promise<ComponentLinkedCompanyObservations[]> {
  const contexts = linkedCompanyContexts(edges);
  const output: ComponentLinkedCompanyObservations[] = [];
  for (const context of contexts) {
    const observations = await listObservationsByScope(client, {
      scope_kind: "company",
      scope_id: context.entity_id,
      observation_type: "FINANCIAL_METRIC_OBSERVATION",
      limit: 5
    });
    output.push({
      ...context,
      observations: await Promise.all(observations.map((observation) => componentObservationFromRowWithAnomaly(client, observation)))
    });
  }
  return output;
}

function linkedCompanyContexts(edges: readonly ComponentEvidenceEdge[]): Array<Omit<ComponentLinkedCompanyObservations, "observations">> {
  const byKey = new Map<string, Omit<ComponentLinkedCompanyObservations, "observations">>();
  for (const edge of edges) {
    upsertLinkedCompanyContext(byKey, {
      entity_id: edge.supplier_id,
      entity_name: edge.supplier_name,
      role: "supplier",
      edge_id: edge.edge_id
    });
    upsertLinkedCompanyContext(byKey, {
      entity_id: edge.consumer_id,
      entity_name: edge.consumer_name,
      role: "consumer",
      edge_id: edge.edge_id
    });
  }
  return [...byKey.values()].sort(
    (left, right) =>
      roleRank(left.role) - roleRank(right.role) || left.entity_name.localeCompare(right.entity_name) || left.entity_id.localeCompare(right.entity_id)
  );
}

function upsertLinkedCompanyContext(
  byKey: Map<string, Omit<ComponentLinkedCompanyObservations, "observations">>,
  input: { entity_id: string; entity_name: string; role: ComponentLinkedCompanyObservations["role"]; edge_id: string }
): void {
  const key = `${input.role}:${input.entity_id}`;
  const existing = byKey.get(key);
  if (existing === undefined) {
    byKey.set(key, {
      entity_id: input.entity_id,
      entity_name: input.entity_name,
      role: input.role,
      edge_ids: [input.edge_id]
    });
    return;
  }
  if (!existing.edge_ids.includes(input.edge_id)) existing.edge_ids.push(input.edge_id);
}

function roleRank(role: ComponentLinkedCompanyObservations["role"]): number {
  return role === "supplier" ? 0 : 1;
}
