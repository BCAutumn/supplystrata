import { createHash } from "node:crypto";
import type { SourcePlanItem } from "@supplystrata/source-plan";
import { buildSourceManagementCatalog } from "@supplystrata/source-management";
import type { WorkbenchEdge, WorkbenchEvidence, WorkbenchModel, WorkbenchUnknownItem } from "@supplystrata/workbench-export";
import type { SourceTargetCoverageReport } from "./source-target-coverage.js";

export type OfficialDisclosureTraceabilityState = "complete" | "partial" | "missing";
export type OfficialDisclosureCorroborationState = "cross_source" | "single_source" | "missing_evidence";

export interface OfficialDisclosureReadinessTargets {
  core_nodes: number;
  level_4_5_fact_edges: number;
  corroboration_ratio: number;
}

export interface OfficialDisclosureReadinessSummary {
  visible_research_nodes: number;
  target_research_nodes: number;
  company_nodes: number;
  component_nodes: number;
  nodes_with_fact_edges: number;
  target_nodes_with_fact_edges: number;
  nodes_with_official_source_plan: number;
  target_nodes_with_official_source_plan: number;
  nodes_with_runnable_official_targets: number;
  target_nodes_with_runnable_official_targets: number;
  nodes_with_official_observations: number;
  target_nodes_with_official_observations: number;
  nodes_missing_official_coverage: number;
  target_nodes_missing_official_coverage: number;
  level_4_5_fact_edges: number;
  traceable_edges: number;
  partial_traceability_edges: number;
  missing_traceability_edges: number;
  cross_source_edges: number;
  single_source_edges: number;
  missing_evidence_edges: number;
  corroboration_ratio: number;
  corroboration_queue_items: number;
  corroboration_queue_with_runnable_targets: number;
  corroboration_queue_needing_disposition: number;
  corroboration_queue_with_recorded_disposition: number;
  corroboration_queue_proposed_unknowns: number;
  edges_with_strength: number;
  edges_with_freshness: number;
  edges_missing_strength: number;
  edges_missing_freshness: number;
  explicit_unknowns: number;
  official_source_plan_items: number;
  expected_official_source_links: number;
  expected_official_source_links_with_coverage: number;
  expected_official_source_links_runnable: number;
  expected_official_source_links_connector_available: number;
  expected_official_source_links_unimplemented: number;
  expected_official_source_links_missing: number;
  runnable_official_targets: number;
  synced_official_targets: number;
  due_official_targets: number;
  degraded_official_targets: number;
  official_targets_with_observations: number;
}

export interface OfficialDisclosureGateStatus {
  gate_id: string;
  status: "pass" | "partial" | "blocked";
  measured: number;
  target: number;
  rationale: string;
}

export interface OfficialDisclosureGate1Scorecard {
  scorecard_id: "gate_1_official_disclosure";
  status: "pass" | "partial" | "blocked";
  overall_progress: number;
  data_progress: number;
  source_path_progress: number;
  criteria: OfficialDisclosureGate1ScorecardCriterion[];
  next_actions: string[];
}

export interface OfficialDisclosureGate1ScorecardCriterion {
  criterion_id:
    | "core_node_official_coverage"
    | "level_4_5_fact_edge_coverage"
    | "cross_source_corroboration"
    | "fact_edge_traceability"
    | "expected_source_path_coverage";
  label: string;
  kind: "completion" | "operability";
  status: "pass" | "partial" | "blocked";
  measured: number;
  target: number;
  progress: number;
  rationale: string;
}

export interface OfficialDisclosureReadinessEdge {
  edge_id: string;
  from_id: string;
  from_name: string;
  to_id: string;
  to_name: string;
  relation: string;
  component_id: string | null;
  evidence_level: number;
  confidence: number;
  evidence_ids: string[];
  source_adapters: string[];
  source_urls: string[];
  source_documents: string[];
  traceability_state: OfficialDisclosureTraceabilityState;
  corroboration_state: OfficialDisclosureCorroborationState;
  has_strength: boolean;
  has_freshness: boolean;
  unknown_ids: string[];
  single_source_disposition_unknown_ids: string[];
}

export type OfficialDisclosureCorroborationDisposition =
  | "needs_counterparty_check"
  | "needs_counterparty_source_target"
  | "needs_explicit_single_source_disposition"
  | "single_source_disposition_recorded"
  | "needs_traceability_backfill";

export interface OfficialDisclosureProposedUnknown {
  unknown_id: string;
  scope_kind: "edge";
  scope_id: string;
  question: string;
  why_unknown: string;
  blocking_data_sources: string[];
  proxies: string[];
  created_by: string;
}

export interface OfficialDisclosureCorroborationQueueItem {
  edge_id: string;
  priority: "P1" | "P2";
  disposition: OfficialDisclosureCorroborationDisposition;
  reason: string;
  from_id: string;
  from_name: string;
  to_id: string;
  to_name: string;
  component_id: string | null;
  existing_source_adapters: string[];
  candidate_node_ids: string[];
  candidate_source_ids: string[];
  source_plan_refs: string[];
  source_targets: OfficialDisclosureReadinessSourceTarget[];
  unknown_ids: string[];
  proposed_unknown: OfficialDisclosureProposedUnknown | null;
  action: string;
}

export interface OfficialDisclosureReadinessGap {
  gap_id: string;
  priority: "P0" | "P1" | "P2";
  kind:
    | "core_node_coverage"
    | "level_4_5_edge_coverage"
    | "expected_official_source_coverage"
    | "traceability"
    | "cross_source_corroboration"
    | "edge_strength"
    | "edge_freshness";
  title: string;
  rationale: string;
  action: string;
  edge_ids: string[];
  component_ids: string[];
  source_adapters: string[];
  source_plan_refs: string[];
  source_targets: OfficialDisclosureReadinessSourceTarget[];
}

export interface OfficialDisclosureReadinessSourcePlanItem {
  source_id: string;
  source_name: string;
  priority: string;
  expected_output_layer: string;
  relation_policy: string;
  component_ids: string[];
  target_ids: string[];
  reasons: string[];
  source_targets: OfficialDisclosureReadinessSourceTarget[];
}

export interface OfficialDisclosureReadinessSourceTarget {
  source_adapter_id: string;
  target_kind: string;
  runnable: boolean;
  target_key: string;
  target_entity_id: string | null;
  target_component_id: string | null;
  check_target_id: string | null;
  state: string | null;
  synced: boolean | null;
  observations: number | null;
  latest_event_type: string | null;
}

export type OfficialDisclosureNodeKind = "company" | "component";
export type OfficialDisclosureNodeCoverageState =
  | "covered_fact"
  | "official_target_with_observation"
  | "official_target_synced"
  | "official_target_runnable"
  | "official_source_planned"
  | "missing";

export interface OfficialDisclosureReadinessNode {
  node_id: string;
  node_kind: OfficialDisclosureNodeKind;
  name: string | null;
  is_target_node: boolean;
  target_priority: "P0" | "P1" | "P2" | null;
  expected_source_ids: string[];
  coverage_state: OfficialDisclosureNodeCoverageState;
  fact_edge_ids: string[];
  source_plan_refs: string[];
  source_targets: OfficialDisclosureReadinessSourceTarget[];
}

export interface OfficialDisclosureReadinessTargetNode {
  node_id: string;
  node_kind: OfficialDisclosureNodeKind;
  name?: string;
  priority?: "P0" | "P1" | "P2";
  expected_source_ids?: readonly string[];
  expected_source_targets?: readonly OfficialDisclosureReadinessTargetSourceConfig[];
}

export interface OfficialDisclosureReadinessTargetSourceConfig {
  source_id: string;
  target_kind: string;
  target_config: Record<string, string | number | boolean | string[]>;
  reason?: string;
}

export interface OfficialDisclosureReadinessProfile {
  profile_id: string;
  title: string;
  version: string;
  description: string;
  selection_reason: string;
}

export interface OfficialDisclosureProfileExpansionCandidate {
  node_id: string;
  node_kind: OfficialDisclosureNodeKind;
  name: string | null;
  suggested_priority: "P1" | "P2";
  reason: string;
  coverage_state: OfficialDisclosureNodeCoverageState;
  fact_edge_ids: string[];
  source_plan_refs: string[];
  source_adapters: string[];
}

export type OfficialDisclosureExpectedSourceCoverageState =
  | "covered_fact"
  | "official_target_with_observation"
  | "official_target_synced"
  | "official_target_runnable"
  | "official_source_planned"
  | "connector_available"
  | "source_registered_unimplemented"
  | "missing_source_mapping";

export interface OfficialDisclosureExpectedSourceCoverage {
  node_id: string;
  node_kind: OfficialDisclosureNodeKind;
  node_name: string | null;
  target_priority: "P0" | "P1" | "P2" | null;
  expected_source_id: string;
  coverage_state: OfficialDisclosureExpectedSourceCoverageState;
  action: string;
  fact_edge_ids: string[];
  source_plan_refs: string[];
  source_targets: OfficialDisclosureReadinessSourceTarget[];
}

export interface OfficialDisclosureReadinessReport {
  schema_version: "1.0.0";
  generated_at: string;
  company_id: string;
  target_profile: OfficialDisclosureReadinessProfile | null;
  targets: OfficialDisclosureReadinessTargets;
  scorecard: OfficialDisclosureGate1Scorecard;
  summary: OfficialDisclosureReadinessSummary;
  gates: OfficialDisclosureGateStatus[];
  nodes: OfficialDisclosureReadinessNode[];
  profile_expansion_candidates: OfficialDisclosureProfileExpansionCandidate[];
  expected_source_coverage: OfficialDisclosureExpectedSourceCoverage[];
  corroboration_queue: OfficialDisclosureCorroborationQueueItem[];
  edges: OfficialDisclosureReadinessEdge[];
  source_plan_items: OfficialDisclosureReadinessSourcePlanItem[];
  gaps: OfficialDisclosureReadinessGap[];
}

export interface OfficialDisclosureReadinessInput {
  generated_at: string;
  company_id: string;
  workbench: Pick<WorkbenchModel, "companies" | "edges" | "evidences" | "unknown_items" | "intelligence">;
  component_ids: readonly string[];
  target_nodes?: readonly OfficialDisclosureReadinessTargetNode[];
  target_profile?: OfficialDisclosureReadinessProfile;
  source_plan?: readonly SourcePlanItem[];
  source_target_coverage?: SourceTargetCoverageReport;
  targets?: Partial<OfficialDisclosureReadinessTargets>;
}

const DEFAULT_TARGETS: OfficialDisclosureReadinessTargets = {
  core_nodes: 25,
  level_4_5_fact_edges: 100,
  corroboration_ratio: 0.3
};

// 这里刻意只登记当前后端已经有 source-check connector 的官方披露源。
// profile 可以期待更多来源，但 Gate 1 不能把“注册过来源”误报成“可运行监控能力”。
const OFFICIAL_SOURCE_CONNECTOR_IDS = new Set([
  "apple-suppliers",
  "company-ir",
  "dart-kr",
  "edinet",
  "sec-edgar",
  "micron-ir",
  "twse-mops",
  "tsmc-ir",
  "samsung-ir",
  "skhynix-ir",
  "asml-ir"
]);

interface OfficialDisclosureNodeDraft {
  node_kind: OfficialDisclosureNodeKind;
  name: string | null;
  is_target_node: boolean;
  target_priority: "P0" | "P1" | "P2" | null;
  expected_source_ids: string[];
}

export function buildOfficialDisclosureReadinessReport(input: OfficialDisclosureReadinessInput): OfficialDisclosureReadinessReport {
  const targets = officialDisclosureTargets(input);
  const componentIds = uniqueSorted(input.component_ids);
  const evidenceByEdge = evidenceByEdgeId(input.workbench.evidences);
  const strengthEdgeIds = new Set(input.workbench.intelligence.edge_strengths.map((strength) => strength.edge_id));
  const freshnessEdgeIds = new Set(input.workbench.intelligence.edge_freshness.map((freshness) => freshness.edge_id));
  const sourcePlanItems = summarizeOfficialSourcePlan(input.source_plan ?? [], input.source_target_coverage);
  const unknownsByEdge = unknownsByReferencedEdge(
    input.workbench.unknown_items,
    input.workbench.edges.map((edge) => edge.edge_id)
  );
  const edges = input.workbench.edges
    .filter((edge) => edge.evidence_level >= 4)
    .map((edge) =>
      summarizeOfficialEdge(edge, {
        evidences: evidenceByEdge.get(edge.edge_id) ?? [],
        strengthEdgeIds,
        freshnessEdgeIds,
        unknowns: unknownsByEdge.get(edge.edge_id) ?? []
      })
    )
    .sort(compareReadinessEdges);
  const nodes = buildNodeCoverageMatrix({
    companies: input.workbench.companies,
    componentIds,
    targetNodes: input.target_nodes ?? [],
    edges,
    sourcePlanItems
  });
  const expectedSourceCoverage = buildExpectedSourceCoverage({ nodes, edges });
  const corroborationQueue = buildCorroborationQueue({ edges, nodes });
  const summary = readinessSummary({
    nodes,
    edges,
    unknownItems: input.workbench.unknown_items.length,
    sourcePlanItems,
    expectedSourceCoverage,
    corroborationQueue
  });
  const scorecard = gate1Scorecard({ targets, summary });
  const profileExpansionCandidates = buildProfileExpansionCandidates({
    nodes,
    hasTargetProfile: input.target_nodes !== undefined && input.target_nodes.length > 0
  });
  const gaps = readinessGaps({ targets, summary, nodes, edges, componentIds, sourcePlanItems, expectedSourceCoverage, corroborationQueue });

  return {
    schema_version: "1.0.0",
    generated_at: input.generated_at,
    company_id: input.company_id,
    target_profile: input.target_profile ?? null,
    targets,
    scorecard,
    summary,
    gates: gateStatuses(targets, summary),
    nodes,
    profile_expansion_candidates: profileExpansionCandidates,
    expected_source_coverage: expectedSourceCoverage,
    corroboration_queue: corroborationQueue,
    edges,
    source_plan_items: sourcePlanItems,
    gaps
  };
}

function officialDisclosureTargets(input: OfficialDisclosureReadinessInput): OfficialDisclosureReadinessTargets {
  return {
    ...DEFAULT_TARGETS,
    ...(input.target_nodes === undefined || input.targets?.core_nodes !== undefined ? {} : { core_nodes: input.target_nodes.length }),
    ...(input.targets ?? {})
  };
}

export function renderOfficialDisclosureReadinessMarkdown(report: OfficialDisclosureReadinessReport): string {
  const lines = [
    `# Official Disclosure Readiness ${report.company_id}`,
    "",
    `Generated at: ${report.generated_at}`,
    "",
    "This report measures whether the current research pack has enough auditable Level 4/5 official disclosure coverage. It does not create fact edges.",
    "",
    "## Summary",
    "",
    `- Target profile: ${report.target_profile === null ? "not selected" : `${report.target_profile.profile_id} (${report.target_profile.title})`}`,
    `- Gate 1 scorecard: ${report.scorecard.status.toUpperCase()} overall ${formatPercent(report.scorecard.overall_progress)}; data ${formatPercent(report.scorecard.data_progress)}; source paths ${formatPercent(report.scorecard.source_path_progress)}`,
    `- Visible research nodes: ${report.summary.visible_research_nodes}/${report.targets.core_nodes}`,
    `- Explicit target nodes: ${report.summary.target_research_nodes === 0 ? "not supplied" : `${report.summary.target_research_nodes} supplied; ${report.summary.target_nodes_missing_official_coverage} missing`}`,
    `- Profile expansion candidates: ${report.profile_expansion_candidates.length}`,
    `- Node coverage: ${report.summary.nodes_with_fact_edges} fact-covered; ${report.summary.nodes_with_runnable_official_targets} runnable official targets; ${report.summary.nodes_missing_official_coverage} missing`,
    `- Level 4/5 fact edges: ${report.summary.level_4_5_fact_edges}/${report.targets.level_4_5_fact_edges}`,
    `- Traceable edges: ${report.summary.traceable_edges}/${report.summary.level_4_5_fact_edges}`,
    `- Cross-source edges: ${report.summary.cross_source_edges}/${report.summary.level_4_5_fact_edges} (${formatPercent(report.summary.corroboration_ratio)})`,
    `- Single-source disposition: ${report.summary.corroboration_queue_with_recorded_disposition} recorded; ${report.summary.corroboration_queue_proposed_unknowns} proposed unknowns`,
    `- Intelligence context: ${report.summary.edges_with_strength} strength, ${report.summary.edges_with_freshness} freshness`,
    `- Explicit unknowns in pack: ${report.summary.explicit_unknowns}`,
    `- Official source-plan items: ${report.summary.official_source_plan_items}`,
    `- Expected official source links: ${report.summary.expected_official_source_links_with_coverage}/${report.summary.expected_official_source_links} covered; ${report.summary.expected_official_source_links_runnable} runnable paths; ${report.summary.expected_official_source_links_connector_available} connector-only; ${report.summary.expected_official_source_links_unimplemented} unimplemented; ${report.summary.expected_official_source_links_missing} missing`,
    `- Runnable official targets: ${report.summary.runnable_official_targets}; synced ${report.summary.synced_official_targets}; due ${report.summary.due_official_targets}; degraded ${report.summary.degraded_official_targets}; with observations ${report.summary.official_targets_with_observations}`
  ];

  lines.push("", "## Gate 1 scorecard", "");
  for (const criterion of report.scorecard.criteria) {
    lines.push(
      `- ${criterion.status.toUpperCase()} ${criterion.criterion_id}: ${formatMeasured(criterion.measured)} / ${formatMeasured(criterion.target)} (${formatPercent(criterion.progress)})`
    );
    lines.push(`  ${criterion.rationale}`);
  }
  if (report.scorecard.next_actions.length > 0) {
    lines.push("", "### Next actions", "");
    for (const action of report.scorecard.next_actions) lines.push(`- ${action}`);
  }

  lines.push("", "## Gate status", "");
  for (const gate of report.gates) {
    lines.push(`- ${gate.status.toUpperCase()} ${gate.gate_id}: ${formatMeasured(gate.measured)} / ${formatMeasured(gate.target)}`);
    lines.push(`  ${gate.rationale}`);
  }

  lines.push("", "## Coverage gaps", "");
  if (report.gaps.length === 0) {
    lines.push("No official disclosure readiness gaps detected in this pack.");
  } else {
    for (const gap of report.gaps) {
      lines.push(`- ${gap.priority} ${gap.kind}: ${gap.title}`);
      lines.push(`  Why: ${gap.rationale}`);
      lines.push(`  Action: ${gap.action}`);
      if (gap.edge_ids.length > 0) lines.push(`  Edges: ${gap.edge_ids.slice(0, 10).join(", ")}`);
      if (gap.component_ids.length > 0) lines.push(`  Components: ${gap.component_ids.slice(0, 10).join(", ")}`);
      if (gap.source_plan_refs.length > 0) lines.push(`  Source plan: ${gap.source_plan_refs.slice(0, 10).join(", ")}`);
      if (gap.source_targets.length > 0) {
        lines.push(
          `  Runnable targets: ${gap.source_targets
            .slice(0, 10)
            .map((target) => `${target.source_adapter_id}/${target.target_kind}=${target.state ?? "planned"}`)
            .join(", ")}`
        );
      }
    }
  }

  lines.push("", "## Corroboration queue", "");
  if (report.corroboration_queue.length === 0) {
    lines.push("No single-source official edges require corroboration or disposition in this pack.");
  } else {
    for (const item of report.corroboration_queue.slice(0, 40)) {
      lines.push(`- ${item.priority} ${item.disposition} ${item.edge_id}: ${item.from_name} -> ${item.to_name}`);
      lines.push(`  Why: ${item.reason}`);
      lines.push(`  Action: ${item.action}`);
      lines.push(`  Existing sources: ${item.existing_source_adapters.length === 0 ? "none" : item.existing_source_adapters.join(", ")}`);
      if (item.candidate_source_ids.length > 0) lines.push(`  Candidate sources: ${item.candidate_source_ids.join(", ")}`);
      if (item.source_plan_refs.length > 0) lines.push(`  Source plan: ${item.source_plan_refs.slice(0, 10).join(", ")}`);
      if (item.source_targets.length > 0) {
        lines.push(
          `  Targets: ${item.source_targets
            .slice(0, 10)
            .map((target) => `${target.source_adapter_id}/${target.target_kind}=${target.state ?? "planned"}`)
            .join(", ")}`
        );
      }
      if (item.unknown_ids.length > 0) lines.push(`  Unknowns: ${item.unknown_ids.join(", ")}`);
      if (item.proposed_unknown !== null) {
        lines.push(`  Proposed unknown: ${item.proposed_unknown.unknown_id}`);
        lines.push(`  Unknown question: ${item.proposed_unknown.question}`);
      }
    }
  }

  lines.push("", "## Expected official source coverage", "");
  if (report.expected_source_coverage.length === 0) {
    lines.push("No explicit expected official source links were supplied by a target profile.");
  } else {
    for (const item of report.expected_source_coverage.slice(0, 60)) {
      lines.push(
        `- ${item.coverage_state} ${item.node_id}${item.node_name === null ? "" : ` (${item.node_name})`} via ${item.expected_source_id}: ${item.action}`
      );
      if (item.fact_edge_ids.length > 0) lines.push(`  Fact edges: ${item.fact_edge_ids.slice(0, 10).join(", ")}`);
      if (item.source_plan_refs.length > 0) lines.push(`  Source plan: ${item.source_plan_refs.slice(0, 10).join(", ")}`);
      if (item.source_targets.length > 0) {
        lines.push(
          `  Targets: ${item.source_targets
            .slice(0, 10)
            .map((target) => `${target.source_adapter_id}/${target.target_kind}=${target.state ?? "planned"}`)
            .join(", ")}`
        );
      }
    }
  }

  lines.push("", "## Node coverage", "");
  if (report.nodes.length === 0) {
    lines.push("No research nodes are visible in this pack.");
  } else {
    for (const node of report.nodes.slice(0, 40)) {
      lines.push(`- ${node.coverage_state} ${node.is_target_node ? "[target] " : ""}${node.node_id}${node.name === null ? "" : ` (${node.name})`}`);
      if (node.expected_source_ids.length > 0) lines.push(`  Expected sources: ${node.expected_source_ids.join(", ")}`);
      if (node.fact_edge_ids.length > 0) lines.push(`  Fact edges: ${node.fact_edge_ids.slice(0, 10).join(", ")}`);
      if (node.source_plan_refs.length > 0) lines.push(`  Source plan: ${node.source_plan_refs.slice(0, 10).join(", ")}`);
      if (node.source_targets.length > 0) {
        lines.push(
          `  Targets: ${node.source_targets
            .slice(0, 10)
            .map((target) => `${target.source_adapter_id}/${target.target_kind}=${target.state ?? "planned"}`)
            .join(", ")}`
        );
      }
    }
  }

  lines.push("", "## Profile expansion candidates", "");
  if (report.profile_expansion_candidates.length === 0) {
    lines.push("No discovered nodes need profile expansion review in this pack.");
  } else {
    for (const candidate of report.profile_expansion_candidates.slice(0, 25)) {
      lines.push(`- ${candidate.suggested_priority} ${candidate.node_id}${candidate.name === null ? "" : ` (${candidate.name})`}: ${candidate.reason}`);
      if (candidate.fact_edge_ids.length > 0) lines.push(`  Fact edges: ${candidate.fact_edge_ids.slice(0, 10).join(", ")}`);
      if (candidate.source_plan_refs.length > 0) lines.push(`  Source plan: ${candidate.source_plan_refs.slice(0, 10).join(", ")}`);
      if (candidate.source_adapters.length > 0) lines.push(`  Sources: ${candidate.source_adapters.slice(0, 10).join(", ")}`);
    }
  }

  lines.push("", "## Official source plan", "");
  if (report.source_plan_items.length === 0) {
    lines.push("No official disclosure source-plan items are visible in this pack.");
  } else {
    for (const item of report.source_plan_items) {
      lines.push(`- ${item.source_id}: ${item.source_name}`);
      lines.push(`  Policy: ${item.expected_output_layer}/${item.relation_policy}; priority ${item.priority}`);
      lines.push(`  Components: ${item.component_ids.length === 0 ? "none" : item.component_ids.join(", ")}`);
      if (item.source_targets.length === 0) {
        lines.push("  Runnable targets: none");
      } else {
        lines.push(
          `  Runnable targets: ${item.source_targets
            .map((target) => `${target.source_adapter_id}/${target.target_kind}=${target.state ?? "planned"}`)
            .join(", ")}`
        );
      }
    }
  }

  lines.push("", "## Edge sample", "");
  for (const edge of report.edges.slice(0, 20)) {
    lines.push(`- ${edge.edge_id}: ${edge.from_name} -> ${edge.to_name} ${edge.relation} [L${edge.evidence_level}]`);
    lines.push(`  Traceability: ${edge.traceability_state}; corroboration: ${edge.corroboration_state}`);
    lines.push(`  Sources: ${edge.source_adapters.length === 0 ? "none" : edge.source_adapters.join(", ")}`);
    lines.push(`  Intelligence: strength=${edge.has_strength ? "yes" : "no"}, freshness=${edge.has_freshness ? "yes" : "no"}`);
    if (edge.unknown_ids.length > 0) lines.push(`  Unknowns: ${edge.unknown_ids.join(", ")}`);
  }
  return lines.join("\n");
}

function summarizeOfficialEdge(
  edge: WorkbenchEdge,
  input: {
    evidences: readonly WorkbenchEvidence[];
    strengthEdgeIds: ReadonlySet<string>;
    freshnessEdgeIds: ReadonlySet<string>;
    unknowns: readonly WorkbenchUnknownItem[];
  }
): OfficialDisclosureReadinessEdge {
  const evidences = activeEvidenceForEdge(edge, input.evidences);
  const sourceAdapters = uniqueSorted(evidences.map((evidence) => evidence.source_adapter_id).filter(nonEmptyString));
  const sourceUrls = uniqueSorted(evidences.map((evidence) => evidence.source_url).filter(nonEmptyString));
  const sourceDocuments = uniqueSorted(evidences.map(sourceDocumentIdentity).filter(nonEmptyString));
  return {
    edge_id: edge.edge_id,
    from_id: edge.from_id,
    from_name: edge.from_name,
    to_id: edge.to_id,
    to_name: edge.to_name,
    relation: edge.relation,
    component_id: edge.component_id,
    evidence_level: edge.evidence_level,
    confidence: edge.confidence,
    evidence_ids: uniqueSorted([...edge.evidence_ids, ...evidences.map((evidence) => evidence.evidence_id)]),
    source_adapters: sourceAdapters,
    source_urls: sourceUrls,
    source_documents: sourceDocuments,
    traceability_state: traceabilityState(evidences),
    corroboration_state: corroborationState(evidences),
    has_strength: input.strengthEdgeIds.has(edge.edge_id),
    has_freshness: input.freshnessEdgeIds.has(edge.edge_id),
    unknown_ids: input.unknowns.map((unknown) => unknown.unknown_id).sort(),
    single_source_disposition_unknown_ids: input.unknowns
      .filter((unknown) => isSingleSourceDispositionUnknown(unknown, edge.edge_id))
      .map((unknown) => unknown.unknown_id)
      .sort()
  };
}

function activeEvidenceForEdge(edge: WorkbenchEdge, evidences: readonly WorkbenchEvidence[]): WorkbenchEvidence[] {
  const edgeEvidenceIds = new Set(edge.evidence_ids);
  return evidences
    .filter((evidence) => evidence.superseded_by === null)
    .filter((evidence) => evidence.edge_id === edge.edge_id || edgeEvidenceIds.has(evidence.evidence_id))
    .filter((evidence) => evidence.evidence_level >= 4 && !evidence.is_inferred);
}

function traceabilityState(evidences: readonly WorkbenchEvidence[]): OfficialDisclosureTraceabilityState {
  if (evidences.some(hasCompleteTrace)) return "complete";
  if (evidences.some(hasPartialTrace)) return "partial";
  return "missing";
}

function hasCompleteTrace(evidence: WorkbenchEvidence): boolean {
  return (
    evidence.cite_text.trim().length > 0 &&
    evidence.source_url.trim().length > 0 &&
    evidence.source_adapter_id.trim().length > 0 &&
    (evidence.cite_text_sha256 !== null || evidence.normalized_cite_text_sha256 !== null || evidence.source_snapshot_sha256 !== null)
  );
}

function hasPartialTrace(evidence: WorkbenchEvidence): boolean {
  return evidence.cite_text.trim().length > 0 && (evidence.source_url.trim().length > 0 || evidence.source_adapter_id.trim().length > 0);
}

function corroborationState(evidences: readonly WorkbenchEvidence[]): OfficialDisclosureCorroborationState {
  if (evidences.length === 0) return "missing_evidence";
  if (uniqueSorted(evidences.map((evidence) => evidence.source_adapter_id).filter(nonEmptyString)).length >= 2) return "cross_source";
  return "single_source";
}

function readinessSummary(input: {
  nodes: readonly OfficialDisclosureReadinessNode[];
  edges: readonly OfficialDisclosureReadinessEdge[];
  unknownItems: number;
  sourcePlanItems: readonly OfficialDisclosureReadinessSourcePlanItem[];
  expectedSourceCoverage: readonly OfficialDisclosureExpectedSourceCoverage[];
  corroborationQueue: readonly OfficialDisclosureCorroborationQueueItem[];
}): OfficialDisclosureReadinessSummary {
  const edgeCount = input.edges.length;
  const crossSourceEdges = input.edges.filter((edge) => edge.corroboration_state === "cross_source").length;
  const traceableEdges = input.edges.filter((edge) => edge.traceability_state === "complete").length;
  const sourceTargets = input.sourcePlanItems.flatMap((item) => item.source_targets);
  const targetNodes = input.nodes.filter((node) => node.is_target_node);
  const expectedCoverage = input.expectedSourceCoverage;
  return {
    visible_research_nodes: input.nodes.length,
    target_research_nodes: targetNodes.length,
    company_nodes: input.nodes.filter((node) => node.node_kind === "company").length,
    component_nodes: input.nodes.filter((node) => node.node_kind === "component").length,
    nodes_with_fact_edges: input.nodes.filter((node) => node.coverage_state === "covered_fact").length,
    target_nodes_with_fact_edges: targetNodes.filter((node) => node.coverage_state === "covered_fact").length,
    nodes_with_official_source_plan: input.nodes.filter((node) => node.source_plan_refs.length > 0).length,
    target_nodes_with_official_source_plan: targetNodes.filter((node) => node.source_plan_refs.length > 0).length,
    nodes_with_runnable_official_targets: input.nodes.filter((node) => node.source_targets.some((target) => target.runnable)).length,
    target_nodes_with_runnable_official_targets: targetNodes.filter((node) => node.source_targets.some((target) => target.runnable)).length,
    nodes_with_official_observations: input.nodes.filter((node) => node.source_targets.some((target) => (target.observations ?? 0) > 0)).length,
    target_nodes_with_official_observations: targetNodes.filter((node) => node.source_targets.some((target) => (target.observations ?? 0) > 0)).length,
    nodes_missing_official_coverage: input.nodes.filter((node) => node.coverage_state === "missing").length,
    target_nodes_missing_official_coverage: targetNodes.filter((node) => node.coverage_state === "missing").length,
    level_4_5_fact_edges: edgeCount,
    traceable_edges: traceableEdges,
    partial_traceability_edges: input.edges.filter((edge) => edge.traceability_state === "partial").length,
    missing_traceability_edges: input.edges.filter((edge) => edge.traceability_state === "missing").length,
    cross_source_edges: crossSourceEdges,
    single_source_edges: input.edges.filter((edge) => edge.corroboration_state === "single_source").length,
    missing_evidence_edges: input.edges.filter((edge) => edge.corroboration_state === "missing_evidence").length,
    corroboration_ratio: edgeCount === 0 ? 0 : roundSix(crossSourceEdges / edgeCount),
    corroboration_queue_items: input.corroborationQueue.length,
    corroboration_queue_with_runnable_targets: input.corroborationQueue.filter((item) => item.source_targets.some((target) => target.runnable)).length,
    corroboration_queue_needing_disposition: input.corroborationQueue.filter((item) => item.disposition === "needs_explicit_single_source_disposition").length,
    corroboration_queue_with_recorded_disposition: input.corroborationQueue.filter((item) => item.disposition === "single_source_disposition_recorded").length,
    corroboration_queue_proposed_unknowns: input.corroborationQueue.filter((item) => item.proposed_unknown !== null).length,
    edges_with_strength: input.edges.filter((edge) => edge.has_strength).length,
    edges_with_freshness: input.edges.filter((edge) => edge.has_freshness).length,
    edges_missing_strength: input.edges.filter((edge) => !edge.has_strength).length,
    edges_missing_freshness: input.edges.filter((edge) => !edge.has_freshness).length,
    explicit_unknowns: input.unknownItems,
    official_source_plan_items: input.sourcePlanItems.length,
    expected_official_source_links: expectedCoverage.length,
    expected_official_source_links_with_coverage: expectedCoverage.filter((item) => expectedSourceHasCoverage(item.coverage_state)).length,
    expected_official_source_links_runnable: expectedCoverage.filter((item) => expectedSourceHasRunnablePath(item.coverage_state)).length,
    expected_official_source_links_connector_available: expectedCoverage.filter((item) => item.coverage_state === "connector_available").length,
    expected_official_source_links_unimplemented: expectedCoverage.filter((item) => item.coverage_state === "source_registered_unimplemented").length,
    expected_official_source_links_missing: expectedCoverage.filter((item) => item.coverage_state === "missing_source_mapping").length,
    runnable_official_targets: sourceTargets.filter((target) => target.runnable).length,
    synced_official_targets: sourceTargets.filter((target) => target.synced === true).length,
    due_official_targets: sourceTargets.filter((target) => target.state === "due").length,
    degraded_official_targets: sourceTargets.filter((target) => target.state === "degraded").length,
    official_targets_with_observations: sourceTargets.filter((target) => (target.observations ?? 0) > 0).length
  };
}

function gateStatuses(targets: OfficialDisclosureReadinessTargets, summary: OfficialDisclosureReadinessSummary): OfficialDisclosureGateStatus[] {
  const coreNodeMeasurement = coreNodeCoverageMeasurement(summary);
  return [
    {
      gate_id: "official_disclosure.core_nodes",
      status: thresholdStatus(coreNodeMeasurement, targets.core_nodes),
      measured: coreNodeMeasurement,
      target: targets.core_nodes,
      rationale:
        summary.target_research_nodes > 0
          ? "Backend Gate 1 is measured against the explicit target node set, counting nodes with fact coverage, source-plan coverage, runnable/synced targets, or official observations."
          : "Backend Gate 1 is falling back to visible research nodes because no explicit target node set was supplied."
    },
    {
      gate_id: "official_disclosure.level_4_5_edges",
      status: thresholdStatus(summary.level_4_5_fact_edges, targets.level_4_5_fact_edges),
      measured: summary.level_4_5_fact_edges,
      target: targets.level_4_5_fact_edges,
      rationale: "Backend Gate 1 expects enough Level 4/5 fact edges before downstream risk and monitoring claims are mature."
    },
    {
      gate_id: "official_disclosure.cross_source_ratio",
      status: thresholdStatus(summary.corroboration_ratio, targets.corroboration_ratio),
      measured: summary.corroboration_ratio,
      target: targets.corroboration_ratio,
      rationale:
        "The conservative baseline counts only distinct source-adapter corroboration; explicit single-source disposition is reported as a gap instead of being inferred from silence."
    },
    {
      gate_id: "official_disclosure.traceability",
      status:
        summary.level_4_5_fact_edges === 0
          ? "blocked"
          : summary.traceable_edges === summary.level_4_5_fact_edges
            ? "pass"
            : summary.traceable_edges > 0
              ? "partial"
              : "blocked",
      measured: summary.traceable_edges,
      target: summary.level_4_5_fact_edges,
      rationale: "Every official fact edge should retain cite text, source URL, source adapter, and a fingerprint or source snapshot hash."
    }
  ];
}

function gate1Scorecard(input: { targets: OfficialDisclosureReadinessTargets; summary: OfficialDisclosureReadinessSummary }): OfficialDisclosureGate1Scorecard {
  const coreNodeMeasurement = coreNodeCoverageMeasurement(input.summary);
  const completionCriteria: OfficialDisclosureGate1ScorecardCriterion[] = [
    scorecardCriterion({
      criterion_id: "core_node_official_coverage",
      label: "Core node official source coverage",
      kind: "completion",
      measured: coreNodeMeasurement,
      target: input.targets.core_nodes,
      rationale:
        input.summary.target_research_nodes > 0
          ? "Counts explicit target nodes with fact coverage, source-plan coverage, runnable/synced targets, or official observations."
          : "Falls back to visible research nodes because no explicit target node set was supplied."
    }),
    scorecardCriterion({
      criterion_id: "level_4_5_fact_edge_coverage",
      label: "Level 4/5 fact edge coverage",
      kind: "completion",
      measured: input.summary.level_4_5_fact_edges,
      target: input.targets.level_4_5_fact_edges,
      rationale: "Counts only auditable Level 4/5 fact edges visible in the current workbench pack."
    }),
    scorecardCriterion({
      criterion_id: "cross_source_corroboration",
      label: "Cross-source corroboration",
      kind: "completion",
      measured: input.summary.corroboration_ratio,
      target: input.targets.corroboration_ratio,
      rationale: "Uses a conservative distinct source-adapter ratio; single-source silence is not treated as corroboration."
    }),
    scorecardCriterion({
      criterion_id: "fact_edge_traceability",
      label: "Fact edge traceability",
      kind: "completion",
      measured: input.summary.traceable_edges,
      target: input.summary.level_4_5_fact_edges,
      rationale: "Every Level 4/5 edge should carry cite text, source URL, source adapter, and fingerprint or snapshot context."
    })
  ];
  const sourcePathCriterion = scorecardCriterion({
    criterion_id: "expected_source_path_coverage",
    label: "Expected official source path coverage",
    kind: "operability",
    measured: input.summary.expected_official_source_links_with_coverage,
    target: input.summary.expected_official_source_links,
    rationale: "Measures whether target-profile expected sources are represented by fact evidence, source-plan paths, runnable/synced targets, or observations."
  });
  const criteria = [...completionCriteria, sourcePathCriterion];
  const dataProgress = averageProgress(completionCriteria);
  const sourcePathProgress = sourcePathCriterion.progress;
  const overallProgress = roundSix(dataProgress * 0.75 + sourcePathProgress * 0.25);
  return {
    scorecard_id: "gate_1_official_disclosure",
    status: scorecardStatus(criteria),
    overall_progress: overallProgress,
    data_progress: dataProgress,
    source_path_progress: sourcePathProgress,
    criteria,
    next_actions: scorecardNextActions(criteria)
  };
}

function scorecardCriterion(input: {
  criterion_id: OfficialDisclosureGate1ScorecardCriterion["criterion_id"];
  label: string;
  kind: OfficialDisclosureGate1ScorecardCriterion["kind"];
  measured: number;
  target: number;
  rationale: string;
}): OfficialDisclosureGate1ScorecardCriterion {
  return {
    criterion_id: input.criterion_id,
    label: input.label,
    kind: input.kind,
    status: input.target <= 0 ? "blocked" : thresholdStatus(input.measured, input.target),
    measured: input.measured,
    target: input.target,
    progress: scorecardProgress(input.measured, input.target),
    rationale: input.rationale
  };
}

function scorecardProgress(measured: number, target: number): number {
  if (target <= 0) return 0;
  return roundSix(Math.min(measured / target, 1));
}

function averageProgress(criteria: readonly OfficialDisclosureGate1ScorecardCriterion[]): number {
  if (criteria.length === 0) return 0;
  return roundSix(criteria.reduce((sum, criterion) => sum + criterion.progress, 0) / criteria.length);
}

function scorecardStatus(criteria: readonly OfficialDisclosureGate1ScorecardCriterion[]): OfficialDisclosureGate1Scorecard["status"] {
  if (criteria.every((criterion) => criterion.status === "pass")) return "pass";
  if (criteria.some((criterion) => criterion.progress > 0)) return "partial";
  return "blocked";
}

function scorecardNextActions(criteria: readonly OfficialDisclosureGate1ScorecardCriterion[]): string[] {
  return criteria.filter((criterion) => criterion.status !== "pass").map(scorecardNextAction);
}

function scorecardNextAction(criterion: OfficialDisclosureGate1ScorecardCriterion): string {
  if (criterion.criterion_id === "core_node_official_coverage")
    return "Close target-node official coverage gaps before expanding into lower-confidence signal sources.";
  if (criterion.criterion_id === "level_4_5_fact_edge_coverage")
    return "Convert useful official disclosures into reviewable evidence candidates, keeping observations and leads out of the fact layer.";
  if (criterion.criterion_id === "cross_source_corroboration")
    return "Check counterparty official disclosures for single-source edges or record explicit single-source unknown/disposition.";
  if (criterion.criterion_id === "fact_edge_traceability")
    return "Backfill cite text, source URL, source adapter, and fingerprint/snapshot context for every Level 4/5 edge.";
  return "Wire expected source links into concrete source-plan targets, then preview, smoke, sync, and enable them through source-management.";
}

function readinessGaps(input: {
  targets: OfficialDisclosureReadinessTargets;
  summary: OfficialDisclosureReadinessSummary;
  nodes: readonly OfficialDisclosureReadinessNode[];
  edges: readonly OfficialDisclosureReadinessEdge[];
  componentIds: readonly string[];
  sourcePlanItems: readonly OfficialDisclosureReadinessSourcePlanItem[];
  expectedSourceCoverage: readonly OfficialDisclosureExpectedSourceCoverage[];
  corroborationQueue: readonly OfficialDisclosureCorroborationQueueItem[];
}): OfficialDisclosureReadinessGap[] {
  const gaps: OfficialDisclosureReadinessGap[] = [];
  const sourceTargets = input.sourcePlanItems.flatMap((item) => item.source_targets);
  const sourcePlanRefs = input.sourcePlanItems.map((item) => `source_plan:${item.source_id}`);
  const missingNodes = input.nodes.filter((node) => node.coverage_state === "missing");
  const coreNodeMeasurement = coreNodeCoverageMeasurement(input.summary);
  if (coreNodeMeasurement < input.targets.core_nodes) {
    gaps.push({
      gap_id: "official-disclosure:core-node-coverage",
      priority: "P0",
      kind: "core_node_coverage",
      title: "Expand official disclosure coverage across the core research nodes",
      rationale:
        input.summary.target_research_nodes > 0
          ? `Only ${coreNodeMeasurement} of ${input.summary.target_research_nodes} explicit target nodes have official disclosure coverage; target is ${input.targets.core_nodes}.`
          : `Only ${input.summary.visible_research_nodes} visible research nodes are represented in this pack; target is ${input.targets.core_nodes}.`,
      action:
        sourceTargets.length > 0
          ? actionForOfficialTargets(sourceTargets)
          : "Prioritize existing official disclosure source-plan targets for uncovered core companies/components before adding lower-confidence signal sources.",
      edge_ids: [],
      component_ids: uniqueSorted(missingNodes.flatMap((node) => (node.node_kind === "component" ? [node.node_id] : []))),
      source_adapters: uniqueSorted(sourceTargets.map((target) => target.source_adapter_id)),
      source_plan_refs: sourcePlanRefs,
      source_targets: sourceTargets
    });
  }
  if (input.summary.level_4_5_fact_edges < input.targets.level_4_5_fact_edges) {
    gaps.push({
      gap_id: "official-disclosure:l4-l5-edge-coverage",
      priority: "P0",
      kind: "level_4_5_edge_coverage",
      title: "Increase audited Level 4/5 fact edge coverage",
      rationale: `This pack has ${input.summary.level_4_5_fact_edges} Level 4/5 fact edges; target is ${input.targets.level_4_5_fact_edges}.`,
      action:
        sourceTargets.length > 0
          ? `${actionForOfficialTargets(sourceTargets)} Convert useful official disclosures into reviewable evidence candidates only after trace validation; do not promote observations or leads into fact edges.`
          : "Use official filings, official supplier lists, and audited company disclosures to add reviewable evidence candidates; do not promote observations or leads into fact edges.",
      edge_ids: [],
      component_ids: uniqueSorted(
        input.nodes.flatMap((node) => (node.node_kind === "component" && node.coverage_state !== "covered_fact" ? [node.node_id] : []))
      ),
      source_adapters: uniqueSorted(sourceTargets.map((target) => target.source_adapter_id)),
      source_plan_refs: sourcePlanRefs,
      source_targets: sourceTargets
    });
  }
  const expectedSourceGaps = input.expectedSourceCoverage.filter((item) => !expectedSourceHasCoverage(item.coverage_state));
  if (expectedSourceGaps.length > 0) {
    gaps.push({
      gap_id: "official-disclosure:expected-source-coverage",
      priority: expectedSourceGaps.some((item) => item.target_priority === "P0") ? "P0" : "P1",
      kind: "expected_official_source_coverage",
      title: "Wire expected official sources for target profile nodes",
      rationale: `${expectedSourceGaps.length} expected official source links are not yet represented by fact evidence, source-plan coverage, or runnable/synced targets.`,
      action: expectedSourceCoverageAction(expectedSourceGaps),
      edge_ids: uniqueSorted(expectedSourceGaps.flatMap((item) => item.fact_edge_ids)),
      component_ids: uniqueSorted(expectedSourceGaps.flatMap((item) => (item.node_kind === "component" ? [item.node_id] : []))),
      source_adapters: uniqueSorted(expectedSourceGaps.map((item) => item.expected_source_id)),
      source_plan_refs: uniqueSorted(expectedSourceGaps.flatMap((item) => item.source_plan_refs)),
      source_targets: uniqueSourceTargets(expectedSourceGaps.flatMap((item) => item.source_targets))
    });
  }
  const traceabilityEdges = input.edges.filter((edge) => edge.traceability_state !== "complete");
  if (traceabilityEdges.length > 0) {
    gaps.push({
      gap_id: "official-disclosure:traceability",
      priority: "P0",
      kind: "traceability",
      title: "Backfill citation traceability for official fact edges",
      rationale: `${traceabilityEdges.length} Level 4/5 edges are missing complete cite text, source URL, source adapter, or fingerprint context.`,
      action: "Backfill evidence trace fields from existing documents or mark the edge for manual review before relying on it in derived analysis.",
      edge_ids: traceabilityEdges.map((edge) => edge.edge_id),
      component_ids: uniqueSorted(traceabilityEdges.flatMap((edge) => (edge.component_id === null ? [] : [edge.component_id]))),
      source_adapters: uniqueSorted(traceabilityEdges.flatMap((edge) => edge.source_adapters)),
      source_plan_refs: [],
      source_targets: []
    });
  }
  if (input.summary.corroboration_ratio < input.targets.corroboration_ratio && input.corroborationQueue.length > 0) {
    gaps.push({
      gap_id: "official-disclosure:cross-source-corroboration",
      priority: "P1",
      kind: "cross_source_corroboration",
      title: "Add second-source corroboration or explicit single-source disposition",
      rationale: `Cross-source ratio is ${formatPercent(input.summary.corroboration_ratio)}; target is ${formatPercent(input.targets.corroboration_ratio)}.`,
      action:
        "For single-source edges, check counterparty official disclosures first; if no second source is expected, record an explicit unknown/disposition instead of treating silence as corroboration.",
      edge_ids: input.corroborationQueue.map((item) => item.edge_id),
      component_ids: uniqueSorted(input.corroborationQueue.flatMap((item) => (item.component_id === null ? [] : [item.component_id]))),
      source_adapters: uniqueSorted(input.corroborationQueue.flatMap((item) => [...item.existing_source_adapters, ...item.candidate_source_ids])),
      source_plan_refs: uniqueSorted(input.corroborationQueue.flatMap((item) => item.source_plan_refs)),
      source_targets: uniqueSourceTargets(input.corroborationQueue.flatMap((item) => item.source_targets))
    });
  }
  const missingStrengthEdges = input.edges.filter((edge) => !edge.has_strength);
  if (missingStrengthEdges.length > 0) {
    gaps.push({
      gap_id: "official-disclosure:edge-strength",
      priority: "P2",
      kind: "edge_strength",
      title: "Resolve missing relationship strength context",
      rationale: `${missingStrengthEdges.length} Level 4/5 edges have no strength estimate in the current intelligence context.`,
      action: "Only write strength when explicit qualitative/dependency/capacity evidence exists; otherwise keep or create explicit unknowns.",
      edge_ids: missingStrengthEdges.map((edge) => edge.edge_id),
      component_ids: uniqueSorted(missingStrengthEdges.flatMap((edge) => (edge.component_id === null ? [] : [edge.component_id]))),
      source_adapters: uniqueSorted(missingStrengthEdges.flatMap((edge) => edge.source_adapters)),
      source_plan_refs: [],
      source_targets: []
    });
  }
  const missingFreshnessEdges = input.edges.filter((edge) => !edge.has_freshness);
  if (missingFreshnessEdges.length > 0) {
    gaps.push({
      gap_id: "official-disclosure:edge-freshness",
      priority: "P1",
      kind: "edge_freshness",
      title: "Refresh freshness for official fact edges",
      rationale: `${missingFreshnessEdges.length} Level 4/5 edges have no freshness record in the current intelligence context.`,
      action: "Run the existing edge intelligence refresh path so stale official disclosures are visible to research-pack and risk views.",
      edge_ids: missingFreshnessEdges.map((edge) => edge.edge_id),
      component_ids: uniqueSorted(missingFreshnessEdges.flatMap((edge) => (edge.component_id === null ? [] : [edge.component_id]))),
      source_adapters: uniqueSorted(missingFreshnessEdges.flatMap((edge) => edge.source_adapters)),
      source_plan_refs: [],
      source_targets: []
    });
  }
  return gaps.sort(compareGaps);
}

function summarizeOfficialSourcePlan(
  sourcePlan: readonly SourcePlanItem[],
  coverage: SourceTargetCoverageReport | undefined
): OfficialDisclosureReadinessSourcePlanItem[] {
  return sourcePlan
    .filter(isOfficialDisclosurePlanItem)
    .map((item) => ({
      source_id: item.source_id,
      source_name: item.source_name,
      priority: item.priority,
      expected_output_layer: item.expected_output_layer,
      relation_policy: item.relation_policy,
      component_ids: uniqueSorted(item.parent_component_ids),
      target_ids: uniqueSorted(item.target_ids),
      reasons: item.reasons.slice(0, 5),
      source_targets: item.suggested_check_targets.map((target) => summarizeSourceTarget(target, coverage)).sort(compareSourceTargets)
    }))
    .sort((left, right) => left.source_id.localeCompare(right.source_id));
}

function buildNodeCoverageMatrix(input: {
  companies: readonly { entity_id: string; name: string }[];
  componentIds: readonly string[];
  targetNodes: readonly OfficialDisclosureReadinessTargetNode[];
  edges: readonly OfficialDisclosureReadinessEdge[];
  sourcePlanItems: readonly OfficialDisclosureReadinessSourcePlanItem[];
}): OfficialDisclosureReadinessNode[] {
  const nodes = new Map<string, OfficialDisclosureNodeDraft>();
  for (const targetNode of input.targetNodes) {
    mergeNode(nodes, targetNode.node_id, {
      node_kind: targetNode.node_kind,
      name: targetNode.name ?? null,
      is_target_node: true,
      target_priority: targetNode.priority ?? null,
      expected_source_ids: targetNode.expected_source_ids ?? []
    });
  }
  for (const company of input.companies) {
    mergeNode(nodes, company.entity_id, { node_kind: "company", name: company.name });
  }
  for (const componentId of input.componentIds) {
    mergeNode(nodes, componentId, { node_kind: "component", name: null });
  }
  for (const edge of input.edges) {
    mergeNode(nodes, edge.from_id, { node_kind: "company", name: edge.from_name });
    mergeNode(nodes, edge.to_id, { node_kind: "company", name: edge.to_name });
    if (edge.component_id !== null) mergeNode(nodes, edge.component_id, { node_kind: "component", name: null });
  }
  for (const item of input.sourcePlanItems) {
    for (const componentId of item.component_ids) mergeNode(nodes, componentId, { node_kind: "component", name: null });
    for (const targetId of item.target_ids) {
      mergeNode(nodes, targetId, { node_kind: nodeKindFromId(targetId), name: null });
    }
    for (const sourceTarget of item.source_targets) {
      if (sourceTarget.target_entity_id !== null) mergeNode(nodes, sourceTarget.target_entity_id, { node_kind: "company", name: null });
      if (sourceTarget.target_component_id !== null) mergeNode(nodes, sourceTarget.target_component_id, { node_kind: "component", name: null });
    }
  }
  return [...nodes.entries()]
    .map(([nodeId, node]) => {
      const factEdgeIds = factEdgeIdsForNode(nodeId, node.node_kind, input.edges);
      const sourcePlanItems = sourcePlanItemsForNode(nodeId, input.sourcePlanItems);
      const sourceTargets = sourcePlanItems.flatMap((item) => sourceTargetsForNode(nodeId, node.node_kind, item));
      return {
        node_id: nodeId,
        node_kind: node.node_kind,
        name: node.name,
        is_target_node: node.is_target_node,
        target_priority: node.target_priority,
        expected_source_ids: node.expected_source_ids,
        coverage_state: nodeCoverageState({ factEdgeIds, sourcePlanItems, sourceTargets }),
        fact_edge_ids: factEdgeIds,
        source_plan_refs: sourcePlanItems.map((item) => `source_plan:${item.source_id}`),
        source_targets: sourceTargets
      };
    })
    .sort(compareNodes);
}

function buildProfileExpansionCandidates(input: {
  nodes: readonly OfficialDisclosureReadinessNode[];
  hasTargetProfile: boolean;
}): OfficialDisclosureProfileExpansionCandidate[] {
  if (!input.hasTargetProfile) return [];
  return input.nodes
    .filter((node) => !node.is_target_node)
    .filter((node) => node.coverage_state !== "missing")
    .map<OfficialDisclosureProfileExpansionCandidate>((node) => ({
      node_id: node.node_id,
      node_kind: node.node_kind,
      name: node.name,
      suggested_priority: node.fact_edge_ids.length > 0 ? "P1" : "P2",
      reason: profileExpansionReason(node),
      coverage_state: node.coverage_state,
      fact_edge_ids: node.fact_edge_ids,
      source_plan_refs: node.source_plan_refs,
      source_adapters: uniqueSorted(node.source_targets.map((target) => target.source_adapter_id))
    }))
    .sort(compareProfileExpansionCandidates);
}

function buildExpectedSourceCoverage(input: {
  nodes: readonly OfficialDisclosureReadinessNode[];
  edges: readonly OfficialDisclosureReadinessEdge[];
}): OfficialDisclosureExpectedSourceCoverage[] {
  const sourceCatalog = buildSourceManagementCatalog();
  const registeredSourceIds = new Set(sourceCatalog.sources.map((item) => item.source.id));
  return input.nodes
    .filter((node) => node.expected_source_ids.length > 0)
    .flatMap((node) =>
      node.expected_source_ids.map((expectedSourceId) =>
        expectedSourceCoverageForNode({
          node,
          expectedSourceId,
          edges: input.edges,
          registeredSourceIds
        })
      )
    )
    .sort(compareExpectedSourceCoverage);
}

function buildCorroborationQueue(input: {
  edges: readonly OfficialDisclosureReadinessEdge[];
  nodes: readonly OfficialDisclosureReadinessNode[];
}): OfficialDisclosureCorroborationQueueItem[] {
  const nodesById = new Map(input.nodes.map((node) => [node.node_id, node]));
  return input.edges
    .filter((edge) => edge.corroboration_state !== "cross_source")
    .map((edge) => corroborationQueueItemForEdge(edge, nodesById))
    .sort(compareCorroborationQueueItems);
}

function corroborationQueueItemForEdge(
  edge: OfficialDisclosureReadinessEdge,
  nodesById: ReadonlyMap<string, OfficialDisclosureReadinessNode>
): OfficialDisclosureCorroborationQueueItem {
  const candidateNodes = corroborationCandidateNodes(edge, nodesById);
  const existingSources = new Set(edge.source_adapters);
  const candidateSourceIds = uniqueSorted(candidateNodes.flatMap((node) => node.expected_source_ids).filter((sourceId) => !existingSources.has(sourceId)));
  const sourceTargets = uniqueSourceTargets(
    candidateNodes.flatMap((node) => node.source_targets).filter((target) => !existingSources.has(target.source_adapter_id))
  );
  const sourcePlanRefs = uniqueSorted(candidateNodes.flatMap((node) => node.source_plan_refs));
  const disposition = corroborationDisposition({ edge, candidateSourceIds, sourceTargets });
  const proposedUnknown = disposition === "needs_explicit_single_source_disposition" ? proposedSingleSourceDispositionUnknown(edge) : null;
  return {
    edge_id: edge.edge_id,
    priority: corroborationPriority({ edge, candidateNodes, sourceTargets }),
    disposition,
    reason: corroborationReason(edge, candidateSourceIds, sourceTargets),
    from_id: edge.from_id,
    from_name: edge.from_name,
    to_id: edge.to_id,
    to_name: edge.to_name,
    component_id: edge.component_id,
    existing_source_adapters: edge.source_adapters,
    candidate_node_ids: candidateNodes.map((node) => node.node_id),
    candidate_source_ids: candidateSourceIds,
    source_plan_refs: sourcePlanRefs,
    source_targets: sourceTargets,
    unknown_ids: edge.unknown_ids,
    proposed_unknown: proposedUnknown,
    action: corroborationAction(disposition, sourceTargets, proposedUnknown)
  };
}

function corroborationPriority(input: {
  edge: OfficialDisclosureReadinessEdge;
  candidateNodes: readonly OfficialDisclosureReadinessNode[];
  sourceTargets: readonly OfficialDisclosureReadinessSourceTarget[];
}): OfficialDisclosureCorroborationQueueItem["priority"] {
  if (input.sourceTargets.length > 0) return "P1";
  const nonRootCandidateIsP0 = input.candidateNodes.some((node) => node.node_id !== input.edge.from_id && node.target_priority === "P0");
  return nonRootCandidateIsP0 ? "P1" : "P2";
}

function corroborationCandidateNodes(
  edge: OfficialDisclosureReadinessEdge,
  nodesById: ReadonlyMap<string, OfficialDisclosureReadinessNode>
): OfficialDisclosureReadinessNode[] {
  const companyCandidates = [nodesById.get(edge.to_id), nodesById.get(edge.from_id)].filter(
    (node): node is OfficialDisclosureReadinessNode => node !== undefined && nodeHasCorroborationPath(node)
  );
  if (companyCandidates.length > 0) return uniqueNodes(companyCandidates).sort(compareNodes);

  // 只有边两端公司都没有可见官方路径时，才退到组件级来源。
  // 否则组件 profile 的通用来源会污染具体 counterparty 的二源检查清单。
  const componentNode = edge.component_id === null ? undefined : nodesById.get(edge.component_id);
  if (componentNode === undefined || !nodeHasCorroborationPath(componentNode)) return [];
  return [componentNode];
}

function nodeHasCorroborationPath(node: OfficialDisclosureReadinessNode): boolean {
  return node.expected_source_ids.length > 0 || node.source_plan_refs.length > 0 || node.source_targets.length > 0;
}

function uniqueNodes(nodes: readonly OfficialDisclosureReadinessNode[]): OfficialDisclosureReadinessNode[] {
  return [...new Map(nodes.map((node) => [node.node_id, node])).values()];
}

function corroborationDisposition(input: {
  edge: OfficialDisclosureReadinessEdge;
  candidateSourceIds: readonly string[];
  sourceTargets: readonly OfficialDisclosureReadinessSourceTarget[];
}): OfficialDisclosureCorroborationDisposition {
  if (input.edge.corroboration_state === "missing_evidence") return "needs_traceability_backfill";
  if (input.sourceTargets.length > 0) return "needs_counterparty_check";
  if (input.candidateSourceIds.length > 0) return "needs_counterparty_source_target";
  if (input.edge.single_source_disposition_unknown_ids.length > 0) return "single_source_disposition_recorded";
  return "needs_explicit_single_source_disposition";
}

function corroborationReason(
  edge: OfficialDisclosureReadinessEdge,
  candidateSourceIds: readonly string[],
  sourceTargets: readonly OfficialDisclosureReadinessSourceTarget[]
): string {
  if (edge.corroboration_state === "missing_evidence") return "This Level 4/5 edge has no active official evidence visible in the pack.";
  if (sourceTargets.length > 0)
    return "A non-edge official source path exists for one of the counterparties/components and should be checked before disposition.";
  if (candidateSourceIds.length > 0)
    return "The target profile names candidate official sources, but this edge does not yet have a concrete counterparty source target.";
  if (edge.single_source_disposition_unknown_ids.length > 0)
    return "A linked explicit unknown records that no profile-backed second-source path is currently visible; keep it reviewable instead of treating silence as corroboration.";
  return "No profile-backed second-source path is visible; silence must be captured as an explicit single-source disposition or unknown.";
}

function corroborationAction(
  disposition: OfficialDisclosureCorroborationDisposition,
  sourceTargets: readonly OfficialDisclosureReadinessSourceTarget[],
  proposedUnknown: OfficialDisclosureProposedUnknown | null
): string {
  if (disposition === "needs_traceability_backfill") return "Backfill active official evidence and trace context before attempting corroboration.";
  if (disposition === "needs_counterparty_check")
    return `${actionForOfficialTargets(sourceTargets)} If the counterparty source confirms the relation, add it through evidence review; if not, keep an explicit single-source disposition.`;
  if (disposition === "needs_counterparty_source_target")
    return "Create node-specific source-plan targets for the candidate official sources, then run them before changing corroboration state.";
  if (disposition === "single_source_disposition_recorded")
    return "Review the linked single-source disposition unknown during research updates; do not count it as cross-source corroboration.";
  const suffix = proposedUnknown === null ? "" : ` Proposed unknown: ${proposedUnknown.unknown_id}.`;
  return `Record an explicit single-source unknown/disposition so the edge is not silently treated as corroborated.${suffix}`;
}

function proposedSingleSourceDispositionUnknown(edge: OfficialDisclosureReadinessEdge): OfficialDisclosureProposedUnknown {
  const componentText = edge.component_id ?? "the disclosed relationship scope";
  return {
    unknown_id: deterministicSingleSourceDispositionUnknownId(edge.edge_id),
    scope_kind: "edge",
    scope_id: edge.edge_id,
    question: `Can ${edge.edge_id} (${edge.from_name} -> ${edge.to_name}, ${componentText}) be corroborated by a second official source, or should it remain single-source?`,
    why_unknown:
      "The Level 4/5 fact edge is traceable, but the current research pack has no profile-backed counterparty source target or second official source evidence for this relationship.",
    blocking_data_sources: ["counterparty official disclosure", "official supplier/customer list", "reviewed second-source filing"],
    proxies: ["source-plan target coverage", "official disclosure observations", "manual review disposition"],
    created_by: "official-disclosure-readiness.single-source-disposition.v1"
  };
}

function expectedSourceCoverageForNode(input: {
  node: OfficialDisclosureReadinessNode;
  expectedSourceId: string;
  edges: readonly OfficialDisclosureReadinessEdge[];
  registeredSourceIds: ReadonlySet<string>;
}): OfficialDisclosureExpectedSourceCoverage {
  const sourceTargets = input.node.source_targets.filter((target) => target.source_adapter_id === input.expectedSourceId);
  const hasFactFromExpectedSource = input.edges
    .filter((edge) => input.node.fact_edge_ids.includes(edge.edge_id))
    .some((edge) => edge.source_adapters.includes(input.expectedSourceId));
  const coverageState = expectedSourceCoverageState({
    hasFactFromExpectedSource,
    sourcePlanRefs: input.node.source_plan_refs,
    sourceTargets,
    expectedSourceId: input.expectedSourceId,
    registeredSourceIds: input.registeredSourceIds
  });
  return {
    node_id: input.node.node_id,
    node_kind: input.node.node_kind,
    node_name: input.node.name,
    target_priority: input.node.target_priority,
    expected_source_id: input.expectedSourceId,
    coverage_state: coverageState,
    action: actionForExpectedSourceCoverage(coverageState, input.expectedSourceId),
    fact_edge_ids: input.node.fact_edge_ids,
    source_plan_refs: input.node.source_plan_refs.filter((ref) => ref === `source_plan:${input.expectedSourceId}`),
    source_targets: sourceTargets
  };
}

function expectedSourceCoverageState(input: {
  hasFactFromExpectedSource: boolean;
  sourcePlanRefs: readonly string[];
  sourceTargets: readonly OfficialDisclosureReadinessSourceTarget[];
  expectedSourceId: string;
  registeredSourceIds: ReadonlySet<string>;
}): OfficialDisclosureExpectedSourceCoverageState {
  if (input.hasFactFromExpectedSource) return "covered_fact";
  if (input.sourceTargets.some((target) => (target.observations ?? 0) > 0)) return "official_target_with_observation";
  if (input.sourceTargets.some((target) => target.synced === true)) return "official_target_synced";
  if (input.sourceTargets.some((target) => target.runnable)) return "official_target_runnable";
  if (input.sourceTargets.length > 0 && input.sourcePlanRefs.includes(`source_plan:${input.expectedSourceId}`)) return "official_source_planned";
  if (OFFICIAL_SOURCE_CONNECTOR_IDS.has(input.expectedSourceId)) return "connector_available";
  if (input.registeredSourceIds.has(input.expectedSourceId)) return "source_registered_unimplemented";
  return "missing_source_mapping";
}

function actionForExpectedSourceCoverage(state: OfficialDisclosureExpectedSourceCoverageState, sourceId: string): string {
  if (state === "covered_fact") return "Official fact evidence from this expected source is already visible in the pack.";
  if (state === "official_target_with_observation")
    return "Review produced official observations and promote only traceable evidence candidates through the evidence review path.";
  if (state === "official_target_synced") return "Enable or run the synced official source target according to the configured monitoring policy.";
  if (state === "official_target_runnable") return "Sync the runnable source-plan target into source_check_targets before expecting observations.";
  if (state === "official_source_planned") return "Add a concrete runnable target config for this planned official source.";
  if (state === "connector_available")
    return `Create a node-specific source-plan target for ${sourceId}; the connector exists but this profile node is not yet wired.`;
  if (state === "source_registered_unimplemented")
    return `Keep ${sourceId} as an explicit backend coverage gap until a connector or manual review workflow exists.`;
  return `Map this expected source id to the registered source catalog before treating it as actionable coverage.`;
}

function expectedSourceHasCoverage(state: OfficialDisclosureExpectedSourceCoverageState): boolean {
  return (
    state === "covered_fact" ||
    state === "official_target_with_observation" ||
    state === "official_target_synced" ||
    state === "official_target_runnable" ||
    state === "official_source_planned"
  );
}

function expectedSourceHasRunnablePath(state: OfficialDisclosureExpectedSourceCoverageState): boolean {
  return state === "official_target_with_observation" || state === "official_target_synced" || state === "official_target_runnable";
}

function profileExpansionReason(node: OfficialDisclosureReadinessNode): string {
  if (node.fact_edge_ids.length > 0) return "Visible Level 4/5 fact coverage exists outside the current target profile.";
  if (node.source_targets.some((target) => target.synced === true)) return "A synced official source target exists outside the current target profile.";
  if (node.source_targets.some((target) => target.runnable)) return "A runnable official source target exists outside the current target profile.";
  return "An official source-plan path exists outside the current target profile.";
}

function factEdgeIdsForNode(nodeId: string, nodeKind: OfficialDisclosureNodeKind, edges: readonly OfficialDisclosureReadinessEdge[]): string[] {
  return edges
    .filter((edge) => {
      if (nodeKind === "company") return edge.from_id === nodeId || edge.to_id === nodeId;
      return edge.component_id === nodeId;
    })
    .map((edge) => edge.edge_id)
    .sort();
}

function sourcePlanItemsForNode(
  nodeId: string,
  sourcePlanItems: readonly OfficialDisclosureReadinessSourcePlanItem[]
): OfficialDisclosureReadinessSourcePlanItem[] {
  return sourcePlanItems.filter(
    (item) =>
      item.component_ids.includes(nodeId) ||
      item.target_ids.includes(nodeId) ||
      item.source_targets.some((target) => target.target_entity_id === nodeId || target.target_component_id === nodeId)
  );
}

function sourceTargetsForNode(
  nodeId: string,
  nodeKind: OfficialDisclosureNodeKind,
  item: OfficialDisclosureReadinessSourcePlanItem
): OfficialDisclosureReadinessSourceTarget[] {
  return item.source_targets.filter((target) => {
    if (target.target_component_id !== null) return target.target_component_id === nodeId;
    if (target.target_entity_id !== null) {
      if (nodeKind === "company") return target.target_entity_id === nodeId;
      return item.target_ids.includes(nodeId);
    }
    return item.target_ids.includes(nodeId);
  });
}

function mergeNode(
  nodes: Map<string, OfficialDisclosureNodeDraft>,
  nodeId: string,
  next: {
    node_kind: OfficialDisclosureNodeKind;
    name: string | null;
    is_target_node?: boolean;
    target_priority?: "P0" | "P1" | "P2" | null;
    expected_source_ids?: readonly string[];
  }
): void {
  const current = nodes.get(nodeId);
  nodes.set(nodeId, {
    node_kind: current?.node_kind ?? next.node_kind,
    name: current?.name ?? next.name,
    is_target_node: current?.is_target_node === true || next.is_target_node === true,
    target_priority: current?.target_priority ?? next.target_priority ?? null,
    expected_source_ids: uniqueSorted([...(current?.expected_source_ids ?? []), ...(next.expected_source_ids ?? [])])
  });
}

function nodeKindFromId(nodeId: string): OfficialDisclosureNodeKind {
  return nodeId.startsWith("COMP-") ? "component" : "company";
}

function nodeCoverageState(input: {
  factEdgeIds: readonly string[];
  sourcePlanItems: readonly OfficialDisclosureReadinessSourcePlanItem[];
  sourceTargets: readonly OfficialDisclosureReadinessSourceTarget[];
}): OfficialDisclosureNodeCoverageState {
  if (input.factEdgeIds.length > 0) return "covered_fact";
  if (input.sourceTargets.some((target) => (target.observations ?? 0) > 0)) return "official_target_with_observation";
  if (input.sourceTargets.some((target) => target.synced === true)) return "official_target_synced";
  if (input.sourceTargets.some((target) => target.runnable)) return "official_target_runnable";
  if (input.sourceTargets.length > 0) return "official_source_planned";
  return "missing";
}

function isOfficialDisclosurePlanItem(item: SourcePlanItem): boolean {
  return item.purpose === "official_disclosure" || (item.expected_output_layer === "edge" && item.relation_policy === "can_create_fact_edge");
}

function summarizeSourceTarget(
  target: SourcePlanItem["suggested_check_targets"][number],
  coverage: SourceTargetCoverageReport | undefined
): OfficialDisclosureReadinessSourceTarget {
  const matched = coverage?.items.find((item) => sourceTargetKey(item.expected_target) === sourceTargetKey(target));
  return {
    source_adapter_id: target.source_adapter_id,
    target_kind: target.target_kind,
    runnable: target.runnable,
    target_key: sourceTargetKey(target),
    target_entity_id: stringConfigValue(target.target_config, "entity_id"),
    target_component_id: stringConfigValue(target.target_config, "component_id"),
    check_target_id: matched?.matched_check_target_id ?? matched?.expected_target.check_target_id ?? null,
    state: matched?.state ?? null,
    synced: matched?.synced ?? null,
    observations: matched?.observations ?? null,
    latest_event_type: matched?.latest_event?.event_type ?? null
  };
}

function actionForOfficialTargets(targets: readonly OfficialDisclosureReadinessSourceTarget[]): string {
  if (targets.some((target) => target.state === "not_synced")) return "Sync runnable official disclosure targets into source_check_targets first.";
  if (targets.some((target) => target.state === "disabled")) return "Enable synced official disclosure targets after cadence/retry policy review.";
  if (targets.some((target) => target.state === "due")) return "Run due official disclosure targets through the shared source-check worker path.";
  if (targets.some((target) => target.state === "active_job")) return "Wait for active official disclosure source-check jobs before changing conclusions.";
  if (targets.some((target) => target.state === "retry_wait" || target.state === "dead" || target.state === "degraded"))
    return "Inspect failed or degraded official disclosure checks before relying on the latest source state.";
  if (targets.some((target) => (target.observations ?? 0) > 0))
    return "Review produced official disclosure observations and keep any fact-edge promotion behind evidence review.";
  return "Review configured official disclosure targets and collect traceable evidence candidates before expanding to weaker signal sources.";
}

function expectedSourceCoverageAction(items: readonly OfficialDisclosureExpectedSourceCoverage[]): string {
  if (items.some((item) => item.coverage_state === "connector_available"))
    return "Add node-specific source-plan targets for expected official sources that already have connectors, then sync them into source_check_targets.";
  if (items.some((item) => item.coverage_state === "source_registered_unimplemented"))
    return "Keep registered-but-unimplemented official sources as explicit Gate 1 gaps until connector or manual-review workflow support exists.";
  return "Register missing expected source mappings before using the profile as an operational coverage plan.";
}

function uniqueSourceTargets(targets: readonly OfficialDisclosureReadinessSourceTarget[]): OfficialDisclosureReadinessSourceTarget[] {
  const byKey = new Map<string, OfficialDisclosureReadinessSourceTarget>();
  for (const target of targets) byKey.set(target.target_key, target);
  return [...byKey.values()].sort(compareSourceTargets);
}

function evidenceByEdgeId(evidences: readonly WorkbenchEvidence[]): Map<string, WorkbenchEvidence[]> {
  const byEdge = new Map<string, WorkbenchEvidence[]>();
  for (const evidence of evidences) {
    if (evidence.edge_id === null) continue;
    const group = byEdge.get(evidence.edge_id) ?? [];
    group.push(evidence);
    byEdge.set(evidence.edge_id, group);
  }
  return byEdge;
}

function unknownsByReferencedEdge(unknowns: readonly WorkbenchUnknownItem[], edgeIds: readonly string[]): Map<string, WorkbenchUnknownItem[]> {
  const byEdge = new Map<string, WorkbenchUnknownItem[]>();
  for (const edgeId of edgeIds) {
    const matching = unknowns.filter((unknown) => unknownReferencesEdge(unknown, edgeId));
    if (matching.length > 0) byEdge.set(edgeId, matching);
  }
  return byEdge;
}

function unknownReferencesEdge(unknown: WorkbenchUnknownItem, edgeId: string): boolean {
  if (unknown.scope_kind === "edge" && unknown.scope_id === edgeId) return true;
  return (
    unknown.question.includes(edgeId) ||
    unknown.why_unknown.includes(edgeId) ||
    unknown.blocking_data_sources.some((source) => source.includes(edgeId)) ||
    unknown.proxies.some((proxy) => proxy.includes(edgeId))
  );
}

function isSingleSourceDispositionUnknown(unknown: WorkbenchUnknownItem, edgeId: string): boolean {
  if (!unknownReferencesEdge(unknown, edgeId)) return false;
  const haystack = [unknown.unknown_id, unknown.question, unknown.why_unknown, ...unknown.blocking_data_sources, ...unknown.proxies].join(" ");
  const mentionsSingleSource = /\b(?:single[-\s]?source|sole[-\s]?source)\b/i.test(haystack);
  const mentionsDisposition = /\b(?:disposition|corroborat|second[-\s]?source|counterparty|official disclosure)\b/i.test(haystack);
  return mentionsSingleSource && mentionsDisposition;
}

function deterministicSingleSourceDispositionUnknownId(edgeId: string): string {
  const digest = createHash("sha256").update(`single-source-disposition:${edgeId}`).digest("hex").slice(0, 20).toUpperCase();
  return `UNK-EDGE-CORROB-${digest}`;
}

function sourceDocumentIdentity(evidence: WorkbenchEvidence): string {
  if (evidence.source_url.trim().length > 0) return `${evidence.source_adapter_id}:${evidence.source_url}`;
  if (evidence.cite_locator !== null && evidence.cite_locator.trim().length > 0) return `${evidence.source_adapter_id}:${evidence.cite_locator}`;
  return evidence.source_adapter_id;
}

function sourceTargetKey(target: { source_adapter_id: string; target_kind: string; target_config: Record<string, unknown> }): string {
  return `${target.source_adapter_id}:${target.target_kind}:${stableConfigKey(target.target_config)}`;
}

function stableConfigKey(config: Record<string, unknown>): string {
  return Object.entries(config)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${stableConfigValue(value)}`)
    .join(";");
}

function stableConfigValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableConfigValue).join(",")}]`;
  if (isRecord(value)) return `{${stableConfigKey(value)}}`;
  return String(value);
}

function stringConfigValue(config: Record<string, unknown>, key: string): string | null {
  const value = config[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coreNodeCoverageMeasurement(summary: OfficialDisclosureReadinessSummary): number {
  if (summary.target_research_nodes === 0) return summary.visible_research_nodes;
  return summary.target_research_nodes - summary.target_nodes_missing_official_coverage;
}

function thresholdStatus(measured: number, target: number): OfficialDisclosureGateStatus["status"] {
  if (measured >= target) return "pass";
  if (measured > 0) return "partial";
  return "blocked";
}

function compareReadinessEdges(left: OfficialDisclosureReadinessEdge, right: OfficialDisclosureReadinessEdge): number {
  return (
    traceabilityOrder(left.traceability_state) - traceabilityOrder(right.traceability_state) ||
    corroborationOrder(left.corroboration_state) - corroborationOrder(right.corroboration_state) ||
    right.evidence_level - left.evidence_level ||
    left.edge_id.localeCompare(right.edge_id)
  );
}

function compareNodes(left: OfficialDisclosureReadinessNode, right: OfficialDisclosureReadinessNode): number {
  return (
    nodeCoverageOrder(left.coverage_state) - nodeCoverageOrder(right.coverage_state) ||
    left.node_kind.localeCompare(right.node_kind) ||
    left.node_id.localeCompare(right.node_id)
  );
}

function nodeCoverageOrder(state: OfficialDisclosureNodeCoverageState): number {
  if (state === "missing") return 0;
  if (state === "official_source_planned") return 1;
  if (state === "official_target_runnable") return 2;
  if (state === "official_target_synced") return 3;
  if (state === "official_target_with_observation") return 4;
  return 5;
}

function traceabilityOrder(state: OfficialDisclosureTraceabilityState): number {
  if (state === "missing") return 0;
  if (state === "partial") return 1;
  return 2;
}

function corroborationOrder(state: OfficialDisclosureCorroborationState): number {
  if (state === "missing_evidence") return 0;
  if (state === "single_source") return 1;
  return 2;
}

function compareGaps(left: OfficialDisclosureReadinessGap, right: OfficialDisclosureReadinessGap): number {
  return priorityOrder(left.priority) - priorityOrder(right.priority) || left.kind.localeCompare(right.kind);
}

function compareSourceTargets(left: OfficialDisclosureReadinessSourceTarget, right: OfficialDisclosureReadinessSourceTarget): number {
  return left.source_adapter_id.localeCompare(right.source_adapter_id) || left.target_kind.localeCompare(right.target_kind);
}

function compareProfileExpansionCandidates(left: OfficialDisclosureProfileExpansionCandidate, right: OfficialDisclosureProfileExpansionCandidate): number {
  return (
    priorityOrder(left.suggested_priority) - priorityOrder(right.suggested_priority) ||
    nodeCoverageOrder(left.coverage_state) - nodeCoverageOrder(right.coverage_state) ||
    left.node_kind.localeCompare(right.node_kind) ||
    left.node_id.localeCompare(right.node_id)
  );
}

function compareExpectedSourceCoverage(left: OfficialDisclosureExpectedSourceCoverage, right: OfficialDisclosureExpectedSourceCoverage): number {
  return (
    priorityOrder(left.target_priority ?? "P2") - priorityOrder(right.target_priority ?? "P2") ||
    expectedSourceCoverageOrder(left.coverage_state) - expectedSourceCoverageOrder(right.coverage_state) ||
    left.node_kind.localeCompare(right.node_kind) ||
    left.node_id.localeCompare(right.node_id) ||
    left.expected_source_id.localeCompare(right.expected_source_id)
  );
}

function compareCorroborationQueueItems(left: OfficialDisclosureCorroborationQueueItem, right: OfficialDisclosureCorroborationQueueItem): number {
  return (
    priorityOrder(left.priority) - priorityOrder(right.priority) ||
    corroborationDispositionOrder(left.disposition) - corroborationDispositionOrder(right.disposition) ||
    left.edge_id.localeCompare(right.edge_id)
  );
}

function expectedSourceCoverageOrder(state: OfficialDisclosureExpectedSourceCoverageState): number {
  if (state === "missing_source_mapping") return 0;
  if (state === "source_registered_unimplemented") return 1;
  if (state === "connector_available") return 2;
  if (state === "official_source_planned") return 3;
  if (state === "official_target_runnable") return 4;
  if (state === "official_target_synced") return 5;
  if (state === "official_target_with_observation") return 6;
  return 7;
}

function corroborationDispositionOrder(disposition: OfficialDisclosureCorroborationDisposition): number {
  if (disposition === "needs_traceability_backfill") return 0;
  if (disposition === "needs_counterparty_check") return 1;
  if (disposition === "needs_counterparty_source_target") return 2;
  if (disposition === "needs_explicit_single_source_disposition") return 3;
  return 4;
}

function priorityOrder(priority: OfficialDisclosureReadinessGap["priority"]): number {
  if (priority === "P0") return 0;
  if (priority === "P1") return 1;
  return 2;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function nonEmptyString(value: string): boolean {
  return value.trim().length > 0;
}

function roundSix(value: number): number {
  return Number(value.toFixed(6));
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatMeasured(value: number): string {
  return value <= 1 && value >= 0 ? formatPercent(value) : String(value);
}
