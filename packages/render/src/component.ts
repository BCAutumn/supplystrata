import type { EvidenceLevel, ObservationType, RelationType, RiskMetricKind } from "@supplystrata/core";
import { appendEdgeIntelligence, appendObservationAnomaly, type EdgeIntelligenceSummary, type ObservationAnomalySummary } from "./company.js";
import type { OutputFormat } from "./types.js";
import type { UnknownMapItem } from "./unknown.js";

export interface ComponentHeader {
  component_id: string;
  name: string;
  taxonomy_path: string[];
  aliases: string[];
}

export interface ComponentParticipant {
  entity_id: string;
  name: string;
  roles: string[];
  edge_count: number;
  best_evidence_level: EvidenceLevel;
  best_confidence: number;
}

export interface ComponentEvidenceEdge {
  edge_id: string;
  relation: RelationType;
  supplier_id: string;
  supplier_name: string;
  consumer_id: string;
  consumer_name: string;
  evidence_level: EvidenceLevel;
  confidence: number;
  is_inferred: boolean;
  primary_evidence_id: string | null;
  cite_text: string | null;
  source_url: string | null;
  source_date: string | null;
  intelligence?: EdgeIntelligenceSummary;
}

export interface ComponentTradeCode {
  system: string;
  code: string;
  description: string;
  confidence: number;
  proxy_only: boolean;
  notes: string;
}

export interface ComponentMaterialExposure {
  material_id: string;
  name: string;
  role: string;
  confidence: number;
  source_suggestions: string[];
}

export interface ComponentTradeTaxonomyModel {
  hs_codes: ComponentTradeCode[];
  materials: ComponentMaterialExposure[];
}

export interface ComponentObservation {
  observation_id: string;
  observation_type: ObservationType;
  source_adapter_id: string;
  source_item_id: string | null;
  doc_id: string | null;
  scope_kind: string;
  scope_id: string;
  geography_kind: string | null;
  geography_id: string | null;
  component_id: string | null;
  metric_name: string;
  metric_value: string | null;
  metric_unit: string | null;
  time_window_start: string | null;
  time_window_end: string | null;
  baseline_value: string | null;
  change_value: string | null;
  change_percent: number | null;
  confidence: number;
  provenance: Record<string, unknown>;
  attrs: Record<string, unknown>;
  anomaly: ObservationAnomalySummary | null;
  created_at: string;
}

export interface ComponentLinkedCompanyObservations {
  entity_id: string;
  entity_name: string;
  role: "supplier" | "consumer";
  edge_ids: string[];
  observations: ComponentObservation[];
}

export interface ComponentRiskMetric {
  metric_id: string;
  metric_kind: RiskMetricKind;
  subject_kind: string;
  subject_id: string;
  component_id: string | null;
  value: string | null;
  confidence: number;
  provenance: Record<string, unknown>;
  attrs: Record<string, unknown>;
}

export interface ComponentRiskView {
  risk_view_id: string;
  generated_at: string;
  model_version: string;
  inputs_fingerprint: string;
  summary: Record<string, unknown>;
  attrs: Record<string, unknown>;
  metrics: ComponentRiskMetric[];
}

export interface ComponentCardModel {
  component: ComponentHeader;
  known_suppliers: ComponentParticipant[];
  known_consumers: ComponentParticipant[];
  evidence_edges: ComponentEvidenceEdge[];
  source_coverage: {
    sources: number;
    evidence_edges: number;
    latest_source_date: string | null;
  };
  trade_taxonomy: ComponentTradeTaxonomyModel;
  related_observations: ComponentObservation[];
  linked_company_observations: ComponentLinkedCompanyObservations[];
  risk_view: ComponentRiskView | null;
  unknown_map: UnknownMapItem[];
}

export function renderComponentCard(card: ComponentCardModel, format: OutputFormat): string {
  if (format === "json") {
    return JSON.stringify(
      {
        schema_version: "1.0.0",
        component: card.component,
        known_suppliers: card.known_suppliers,
        known_consumers: card.known_consumers,
        evidence_edges: card.evidence_edges,
        source_coverage: card.source_coverage,
        trade_taxonomy: card.trade_taxonomy,
        related_observations: card.related_observations,
        linked_company_observations: card.linked_company_observations,
        risk_view: card.risk_view,
        unknown_map: card.unknown_map
      },
      null,
      2
    );
  }

  const lines = [
    `# Component ${card.component.name} [${card.component.component_id}]`,
    "",
    `Taxonomy: ${card.component.taxonomy_path.join(" > ")}`,
    `Aliases: ${card.component.aliases.length === 0 ? "(none)" : card.component.aliases.join(", ")}`,
    "",
    "## Known suppliers",
    ""
  ];
  appendComponentParticipants(lines, card.known_suppliers);
  lines.push("", "## Known consumers", "");
  appendComponentParticipants(lines, card.known_consumers);
  lines.push("", "## Evidence edges", "");
  appendComponentEvidenceEdges(lines, card.evidence_edges);
  lines.push("", "## Trade and material taxonomy", "");
  appendTradeTaxonomy(lines, card.trade_taxonomy);
  lines.push("", "## Related observations", "");
  appendRelatedObservations(lines, card.related_observations);
  lines.push("", "## Linked company financial signals", "");
  appendLinkedCompanyObservations(lines, card.linked_company_observations);
  lines.push("", "## Risk baseline", "");
  appendComponentRiskView(lines, card.risk_view);
  lines.push("", "## Source coverage", "");
  appendSourceCoverage(lines, card.source_coverage);
  lines.push("", "## Unknown map", "");
  if (card.unknown_map.length === 0) {
    lines.push("- No component-scoped unknown items recorded yet.");
  } else {
    for (const item of card.unknown_map) {
      lines.push(`- ${item.question}`);
      lines.push(`  Scope: ${item.scope_kind}:${item.scope_id}`);
      lines.push(`  Why unknown: ${item.why_unknown}`);
    }
  }
  return lines.join("\n");
}

function appendComponentRiskView(lines: string[], riskView: ComponentRiskView | null): void {
  if (riskView === null) {
    lines.push("(no component risk baseline generated yet)");
    return;
  }
  lines.push(`- View: ${riskView.risk_view_id}`);
  lines.push(`  Model: ${riskView.model_version}; generated ${riskView.generated_at}`);
  lines.push(`  Inputs: ${riskView.inputs_fingerprint.slice(0, 12)}`);
  for (const metric of riskView.metrics) {
    const value = metric.value ?? "unknown";
    lines.push(`- ${metric.metric_kind}: ${value} (conf ${metric.confidence.toFixed(2)})`);
    const shareUnknown = metric.attrs["share_unknown"] === true;
    if (shareUnknown) lines.push("  Share unknown: yes");
    const strengthUnknown = metric.attrs["strength_unknown"] === true;
    const freshnessMissing = metric.attrs["freshness_missing"] === true;
    if (strengthUnknown || freshnessMissing) {
      lines.push(`  Gaps: strength ${strengthUnknown ? "unknown" : "known"}, freshness ${freshnessMissing ? "missing" : "available"}`);
    }
  }
}

function appendTradeTaxonomy(lines: string[], taxonomy: ComponentTradeTaxonomyModel): void {
  if (taxonomy.hs_codes.length === 0 && taxonomy.materials.length === 0) {
    lines.push("(no trade or material taxonomy recorded yet)");
    return;
  }
  if (taxonomy.hs_codes.length > 0) {
    lines.push("Trade proxies:");
    for (const code of taxonomy.hs_codes) {
      lines.push(`- ${code.system} ${code.code}: ${code.description}`);
      lines.push(`  Proxy only: ${code.proxy_only ? "yes" : "no"}; confidence ${code.confidence.toFixed(2)}`);
      lines.push(`  Notes: ${code.notes}`);
    }
  }
  if (taxonomy.materials.length > 0) {
    lines.push("Materials:");
    for (const material of taxonomy.materials) {
      lines.push(`- ${material.name} [${material.material_id}]`);
      lines.push(`  Role: ${material.role}; confidence ${material.confidence.toFixed(2)}`);
      lines.push(`  Sources to check: ${material.source_suggestions.join(", ")}`);
    }
  }
}

function appendComponentParticipants(lines: string[], items: readonly ComponentParticipant[]): void {
  if (items.length === 0) {
    lines.push("(none recorded at Level 4-5)");
    return;
  }
  for (const item of items) {
    lines.push(`- ${item.name} [${item.entity_id}]`);
    lines.push(`  Evidence: Level ${item.best_evidence_level}, conf ${item.best_confidence.toFixed(3)}, edges ${item.edge_count}`);
    lines.push(`  Roles: ${item.roles.join(", ")}`);
  }
}

function appendComponentEvidenceEdges(lines: string[], edges: readonly ComponentEvidenceEdge[]): void {
  if (edges.length === 0) {
    lines.push("(no Level 4-5 component edges yet)");
    return;
  }
  for (const edge of edges) {
    lines.push(`- ${edge.supplier_name} -> ${edge.consumer_name} via ${edge.relation} [Level ${edge.evidence_level}, conf ${edge.confidence.toFixed(3)}]`);
    if (edge.source_date !== null) lines.push(`  Source date: ${edge.source_date.slice(0, 10)}`);
    if (edge.cite_text !== null) lines.push(`  "${edge.cite_text}"`);
    if (edge.primary_evidence_id !== null) lines.push(`  Evidence: ${edge.primary_evidence_id}`);
    appendEdgeIntelligence(lines, edge.intelligence);
  }
}

function appendRelatedObservations(lines: string[], observations: readonly ComponentObservation[]): void {
  if (observations.length === 0) {
    lines.push("(no component-scoped observations recorded yet)");
    return;
  }
  for (const observation of observations) {
    lines.push(`- ${observation.observation_type}: ${observation.metric_name}`);
    lines.push(`  Scope: ${observation.scope_kind}:${observation.scope_id}; source: ${observation.source_adapter_id}`);
    lines.push(`  Value: ${observation.metric_value ?? "(n/a)"}${observation.metric_unit === null ? "" : ` ${observation.metric_unit}`}`);
    if (observation.baseline_value !== null && observation.change_percent !== null) {
      const changeValue = observation.change_value === null ? "" : `; delta ${observation.change_value}`;
      lines.push(`  Change: ${observation.change_percent.toFixed(2)}% vs baseline ${observation.baseline_value}${changeValue}`);
    }
    lines.push(`  Confidence: ${observation.confidence.toFixed(3)}`);
    appendObservationAnomaly(lines, observation.anomaly);
  }
}

function appendLinkedCompanyObservations(lines: string[], items: readonly ComponentLinkedCompanyObservations[]): void {
  if (items.length === 0) {
    lines.push("(no company-scoped financial signals linked to current component edges yet)");
    return;
  }
  for (const item of items) {
    lines.push(`- ${item.entity_name} [${item.entity_id}] as ${item.role}`);
    lines.push(`  Linked edges: ${item.edge_ids.join(", ")}`);
    if (item.observations.length === 0) {
      lines.push("  Financial observations: none recorded yet");
      continue;
    }
    for (const observation of item.observations) {
      lines.push(
        `  - ${observation.metric_name}: ${observation.metric_value ?? "(n/a)"}${observation.metric_unit === null ? "" : ` ${observation.metric_unit}`}`
      );
      if (observation.time_window_end !== null) lines.push(`    Period end: ${observation.time_window_end.slice(0, 10)}`);
      if (observation.baseline_value !== null && observation.change_percent !== null) {
        const changeValue = observation.change_value === null ? "" : `; delta ${observation.change_value}`;
        lines.push(`    Change: ${observation.change_percent.toFixed(2)}% vs baseline ${observation.baseline_value}${changeValue}`);
      }
      appendObservationAnomaly(lines, observation.anomaly);
    }
  }
}

function appendSourceCoverage(
  lines: string[],
  coverage: {
    sources: number;
    evidence_edges: number;
    latest_source_date: string | null;
  }
): void {
  lines.push(`- Evidence edges: ${coverage.evidence_edges}`);
  lines.push(`- Distinct source URLs: ${coverage.sources}`);
  lines.push(`- Latest source date: ${coverage.latest_source_date ?? "(none)"}`);
}
