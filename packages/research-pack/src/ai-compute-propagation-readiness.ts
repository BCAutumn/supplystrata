import type { ObservationType } from "@supplystrata/core";
import type { ResearchSourcePurpose, SourcePlanItem } from "@supplystrata/source-plan";
import type { WorkbenchModel } from "@supplystrata/workbench-export";
import type { ObservationCoverageReport } from "./observation-coverage.js";
import type { OfficialDisclosureReadinessReport } from "./official-disclosure-readiness.js";
import type { SourceTargetCoverageReport } from "./source-target-coverage.js";
import type { SupplyChainComponentDependencyLead, SupplyChainExpansionFrontierItem, SupplyChainExpansionPlan } from "./supply-chain-expansion-plan.js";
import type {
  AiComputePropagationLayer,
  AiComputePropagationLayerId,
  AiComputePropagationLayerStatus,
  AiComputePropagationPolicy,
  AiComputePropagationReadinessMatrix
} from "./ai-compute-propagation-readiness-definitions.js";

export type {
  AiComputePropagationLayer,
  AiComputePropagationLayerId,
  AiComputePropagationLayerStatus,
  AiComputePropagationPolicy,
  AiComputePropagationReadinessMatrix,
  AiComputePropagationReadinessSummary
} from "./ai-compute-propagation-readiness-definitions.js";

export interface AiComputePropagationReadinessInput {
  workbench: Pick<WorkbenchModel, "edges" | "unknown_items">;
  observation_coverage: ObservationCoverageReport;
  official_disclosure_readiness: OfficialDisclosureReadinessReport;
  source_plan: readonly SourcePlanItem[];
  source_target_coverage: SourceTargetCoverageReport;
  supply_chain_expansion_plan: SupplyChainExpansionPlan;
}

interface AiComputePropagationLayerRule {
  layer_id: AiComputePropagationLayerId;
  title: string;
  question: string;
  component_ids: readonly string[];
  material_or_process_prefixes: readonly string[];
  observation_types: readonly ObservationType[];
  source_purposes: readonly ResearchSourcePurpose[];
  dependency_categories: readonly SupplyChainComponentDependencyLead["category"][];
}

interface LayerRefs {
  fact_edge_refs: string[];
  observation_refs: string[];
  observation_series_refs: string[];
  source_plan_refs: string[];
  source_target_refs: string[];
  component_dependency_refs: string[];
  frontier_refs: string[];
  unknown_refs: string[];
  material_or_process_refs: string[];
}

const POLICY: AiComputePropagationPolicy = "reasoning_input_only_no_fact_mutation";

const LAYER_RULES: readonly AiComputePropagationLayerRule[] = [
  {
    layer_id: "demand_to_compute",
    title: "Demand to compute",
    question: "Do we have demand, capex, or customer signals that explain why compute capacity may expand?",
    component_ids: ["COMP-GPU", "COMP-HBM", "COMP-SERVER"],
    material_or_process_prefixes: [],
    observation_types: ["BACKLOG_OBSERVATION", "CUSTOMER_CONCENTRATION_OBSERVATION", "FINANCIAL_METRIC_OBSERVATION", "CAPEX_OBSERVATION"],
    source_purposes: ["official_disclosure", "procurement"],
    dependency_categories: ["component", "service"]
  },
  {
    layer_id: "compute_to_server",
    title: "Compute to AI server infrastructure",
    question: "Can the pack trace compute demand into AI server, ODM, optical, power, and cooling frontier?",
    component_ids: ["COMP-SERVER", "COMP-MANUFACTURING-SERVICES", "COMP-OPTICAL-MODULE", "COMP-POWER-SUPPLY", "COMP-COOLING"],
    material_or_process_prefixes: [],
    observation_types: ["PROCUREMENT_OBSERVATION", "CAPEX_OBSERVATION", "FACILITY_PROFILE_OBSERVATION"],
    source_purposes: ["official_disclosure", "procurement", "facility"],
    dependency_categories: ["component", "equipment", "service", "facility"]
  },
  {
    layer_id: "server_to_board_materials",
    title: "AI server to board materials",
    question: "Can the pack move from AI server/PCB context into CCL, copper foil, electronic glass cloth, and resin?",
    component_ids: ["COMP-PCB", "COMP-CCL", "COMP-COPPER-FOIL", "COMP-ELECTRONIC-GLASS-CLOTH", "COMP-LAMINATE-RESIN", "COMP-ABF-SUBSTRATE"],
    material_or_process_prefixes: ["MAT-COPPER"],
    observation_types: ["TRADE_FLOW_OBSERVATION", "COMMODITY_PRICE_OBSERVATION", "MINERAL_SUPPLY_OBSERVATION"],
    source_purposes: ["official_disclosure", "trade", "commodity"],
    dependency_categories: ["component", "material"]
  },
  {
    layer_id: "compute_to_fab_capacity",
    title: "Compute to fab capacity",
    question: "Can the pack connect compute demand to foundry, wafer, packaging, or memory capacity signals?",
    component_ids: ["COMP-WAFER", "COMP-SILICON-WAFER", "COMP-ADVANCED-PACKAGING", "COMP-HBM", "COMP-DRAM"],
    material_or_process_prefixes: [],
    observation_types: ["CAPEX_OBSERVATION", "FACILITY_PROFILE_OBSERVATION", "PROCUREMENT_OBSERVATION"],
    source_purposes: ["official_disclosure", "facility", "procurement"],
    dependency_categories: ["component", "facility", "equipment"]
  },
  {
    layer_id: "fab_to_construction",
    title: "Fab capacity to cleanroom construction",
    question: "Do we have cleanroom, construction, or hook-up context before equipment installation?",
    component_ids: ["COMP-CLEANROOM"],
    material_or_process_prefixes: [],
    observation_types: ["FACILITY_PROFILE_OBSERVATION", "CAPEX_OBSERVATION", "PROCUREMENT_OBSERVATION"],
    source_purposes: ["facility", "procurement", "official_disclosure"],
    dependency_categories: ["facility", "service"]
  },
  {
    layer_id: "construction_to_equipment",
    title: "Construction to semiconductor equipment",
    question: "Can the pack identify equipment delivery, installation, qualification, or tool-capacity frontier?",
    component_ids: ["COMP-EUV-LITHOGRAPHY", "COMP-SEMICONDUCTOR-EQUIPMENT"],
    material_or_process_prefixes: [],
    observation_types: ["PROCUREMENT_OBSERVATION", "CAPEX_OBSERVATION", "POLICY_OBSERVATION"],
    source_purposes: ["official_disclosure", "procurement", "policy"],
    dependency_categories: ["equipment"]
  },
  {
    layer_id: "equipment_to_process_inputs",
    title: "Equipment to process inputs",
    question: "Can the pack name process consumables such as photoresist, targets, CMP, gases, and chemicals without asserting suppliers?",
    component_ids: ["COMP-PHOTORESIST", "COMP-TARGET", "COMP-CMP", "COMP-SPECIALTY-GASES"],
    material_or_process_prefixes: ["MAT-"],
    observation_types: ["COMMODITY_PRICE_OBSERVATION", "TRADE_FLOW_OBSERVATION", "MINERAL_SUPPLY_OBSERVATION", "POLICY_OBSERVATION"],
    source_purposes: ["commodity", "trade", "policy", "official_disclosure"],
    dependency_categories: ["material", "energy"]
  },
  {
    layer_id: "process_to_raw_materials",
    title: "Process inputs to raw materials",
    question: "Can the pack expose raw material constraints behind copper, glass fiber, resin, rare gases, metals, or chemicals?",
    component_ids: [],
    material_or_process_prefixes: ["MAT-"],
    observation_types: ["MINERAL_SUPPLY_OBSERVATION", "COMMODITY_PRICE_OBSERVATION", "TRADE_FLOW_OBSERVATION", "POLICY_OBSERVATION"],
    source_purposes: ["commodity", "trade", "macro", "policy"],
    dependency_categories: ["material", "energy"]
  }
];

export function buildAiComputePropagationReadinessMatrix(input: AiComputePropagationReadinessInput): AiComputePropagationReadinessMatrix {
  const layers = LAYER_RULES.map((rule) => layerFromRule(rule, input));
  return {
    schema_version: "1.0.0",
    matrix_id: "ai_compute_propagation.v0",
    policy: POLICY,
    summary: {
      layers_total: layers.length,
      covered_fact: countStatus(layers, "covered_fact"),
      observation_ready: countStatus(layers, "observation_ready"),
      official_target_runnable: countStatus(layers, "official_target_runnable"),
      lead_only: countStatus(layers, "lead_only"),
      unknown_open: countStatus(layers, "unknown_open"),
      blocked_source: countStatus(layers, "blocked_source"),
      layers_with_fact_refs: layers.filter((layer) => layer.fact_edge_refs.length > 0).length,
      layers_with_observation_refs: layers.filter((layer) => layer.observation_refs.length > 0 || layer.observation_series_refs.length > 0).length,
      layers_with_source_targets: layers.filter((layer) => layer.source_target_refs.length > 0).length,
      layers_with_frontier_refs: layers.filter((layer) => layer.frontier_refs.length > 0).length
    },
    layers
  };
}

function layerFromRule(rule: AiComputePropagationLayerRule, input: AiComputePropagationReadinessInput): AiComputePropagationLayer {
  const refs = refsForRule(rule, input);
  const status = statusFor(refs);
  return {
    layer_id: rule.layer_id,
    title: rule.title,
    question: rule.question,
    status,
    status_reason: statusReason(status, refs),
    component_ids: [...rule.component_ids],
    material_or_process_refs: refs.material_or_process_refs,
    fact_edge_refs: refs.fact_edge_refs,
    observation_refs: refs.observation_refs,
    observation_series_refs: refs.observation_series_refs,
    source_plan_refs: refs.source_plan_refs,
    source_target_refs: refs.source_target_refs,
    component_dependency_refs: refs.component_dependency_refs,
    frontier_refs: refs.frontier_refs,
    unknown_refs: refs.unknown_refs,
    next_actions: nextActionsFor(status),
    policy: POLICY
  };
}

function refsForRule(rule: AiComputePropagationLayerRule, input: AiComputePropagationReadinessInput): LayerRefs {
  const sourcePlanItems = sourcePlanItemsForRule(rule, input.source_plan);
  const leads = leadsForRule(rule, input.supply_chain_expansion_plan.component_dependency_leads);
  const frontier = frontierForRule(rule, input.supply_chain_expansion_plan.frontier);
  const factEdges = input.workbench.edges.filter(
    (edge) => edge.evidence_level >= 4 && edge.component_id !== null && componentMatchesRule(edge.component_id, rule)
  );
  const observations = input.observation_coverage.types.filter(
    (item) => rule.observation_types.includes(item.observation_type) && observationMatchesRule(item, rule)
  );
  const series = input.observation_coverage.series.filter((item) => rule.observation_types.includes(item.observation_type) && seriesMatchesRule(item, rule));
  const coverageItems = sourceCoverageItemsFor(sourcePlanItems, input.source_target_coverage);
  const officialNodes = input.official_disclosure_readiness.nodes.filter((node) => node.node_kind === "component" && componentMatchesRule(node.node_id, rule));
  const unknownIds = unknownRefsFor(rule, input, frontier, leads);
  const sourceTargetRefs = uniqueSorted([
    ...coverageItems.map((item) => `source_target:${item.matched_check_target_id ?? item.expected_target.check_target_id}:${item.state}`),
    ...officialNodes.flatMap((node) =>
      node.source_targets.map((target) => `source_target:${target.check_target_id ?? target.target_key}:${target.state ?? "planned"}`)
    )
  ]);

  return {
    fact_edge_refs: uniqueSorted([
      ...factEdges.map((edge) => `edge:${edge.edge_id}`),
      ...leads.flatMap((lead) => lead.supporting_edge_ids.map((edgeId) => `edge:${edgeId}`))
    ]),
    observation_refs: uniqueSorted(observations.flatMap((item) => item.sample_observation_ids.map((observationId) => `observation:${observationId}`))),
    observation_series_refs: uniqueSorted(series.filter((item) => item.status !== "sparse").map((item) => `observation_series:${item.series_key}`)),
    source_plan_refs: uniqueSorted([
      ...sourcePlanItems.map((item) => `source_plan:${item.source_id}`),
      ...officialNodes.flatMap((node) => node.source_plan_refs)
    ]),
    source_target_refs: sourceTargetRefs,
    component_dependency_refs: uniqueSorted(leads.map((lead) => `component_dependency:${lead.dependency_id}`)),
    frontier_refs: uniqueSorted(frontier.map((item) => `supply_chain_frontier:${item.frontier_id}`)),
    unknown_refs: uniqueSorted(unknownIds.map((unknownId) => `unknown:${unknownId}`)),
    material_or_process_refs: uniqueSorted([
      ...sourcePlanItems.flatMap((item) => item.target_ids.filter((targetId) => materialOrProcessMatchesRule(targetId, rule))),
      ...leads.map((lead) => lead.target_id).filter((targetId) => materialOrProcessMatchesRule(targetId, rule))
    ])
  };
}

function statusFor(refs: LayerRefs): AiComputePropagationLayerStatus {
  if (refs.fact_edge_refs.length > 0) return "covered_fact";
  if (refs.observation_refs.length > 0 || refs.observation_series_refs.length > 0) return "observation_ready";
  if (refs.source_target_refs.some((ref) => ref.endsWith(":retry_wait") || ref.endsWith(":degraded") || ref.endsWith(":dead"))) return "blocked_source";
  if (refs.source_target_refs.length > 0 || refs.source_plan_refs.length > 0) return "official_target_runnable";
  if (refs.component_dependency_refs.length > 0 || refs.frontier_refs.length > 0) return "lead_only";
  return "unknown_open";
}

function statusReason(status: AiComputePropagationLayerStatus, refs: LayerRefs): string {
  if (status === "covered_fact") return `${refs.fact_edge_refs.length} Level 4/5 fact edge ref(s) can anchor this layer.`;
  if (status === "observation_ready") return "Observation context exists, but it must remain outside the fact layer.";
  if (status === "blocked_source") return "A matching source target exists but is currently retrying, degraded, or dead.";
  if (status === "official_target_runnable") return "A source-plan or source-target path exists; run or sync it before drawing conclusions.";
  if (status === "lead_only") return "Only taxonomy/frontier leads exist; they are research directions, not facts.";
  return "No adequate fact, observation, or runnable source path is visible yet.";
}

function nextActionsFor(status: AiComputePropagationLayerStatus): string[] {
  if (status === "covered_fact") return ["Use fact refs as chain anchors; continue corroboration and strength/freshness review."];
  if (status === "observation_ready") return ["Use observations as reasoning inputs; do not create company fact edges from them."];
  if (status === "blocked_source") return ["Inspect source target failure/degradation before relying on this layer."];
  if (status === "official_target_runnable") return ["Sync/enable/run the listed source targets, then review outputs through controlled paths."];
  if (status === "lead_only") return ["Promote relevant leads into source targets or explicit unknowns before treating the layer as covered."];
  return ["Create source targets or explicit unknowns for this propagation layer."];
}

function sourcePlanItemsForRule(rule: AiComputePropagationLayerRule, sourcePlan: readonly SourcePlanItem[]): SourcePlanItem[] {
  return sourcePlan.filter(
    (item) =>
      rule.source_purposes.includes(item.purpose) ||
      item.parent_component_ids.some((componentId) => componentMatchesRule(componentId, rule)) ||
      item.target_ids.some((targetId) => componentMatchesRule(targetId, rule) || materialOrProcessMatchesRule(targetId, rule))
  );
}

function leadsForRule(rule: AiComputePropagationLayerRule, leads: readonly SupplyChainComponentDependencyLead[]): SupplyChainComponentDependencyLead[] {
  return leads.filter(
    (lead) =>
      rule.dependency_categories.includes(lead.category) ||
      componentMatchesRule(lead.parent_component_id, rule) ||
      componentMatchesRule(lead.target_id, rule) ||
      materialOrProcessMatchesRule(lead.target_id, rule)
  );
}

function frontierForRule(rule: AiComputePropagationLayerRule, frontier: readonly SupplyChainExpansionFrontierItem[]): SupplyChainExpansionFrontierItem[] {
  return frontier.filter((item) => item.component_id !== null && componentMatchesRule(item.component_id, rule));
}

function sourceCoverageItemsFor(sourcePlanItems: readonly SourcePlanItem[], coverage: SourceTargetCoverageReport): SourceTargetCoverageReport["items"] {
  const sourceIds = new Set(sourcePlanItems.map((item) => item.source_id));
  const targetIds = new Set(sourcePlanItems.flatMap((item) => item.target_ids));
  return coverage.items.filter((item) => {
    if (sourceIds.has(item.expected_target.source_adapter_id)) return true;
    const targetConfigText = JSON.stringify(item.expected_target.target_config);
    return [...targetIds].some((targetId) => targetConfigText.includes(targetId));
  });
}

function unknownRefsFor(
  rule: AiComputePropagationLayerRule,
  input: AiComputePropagationReadinessInput,
  frontier: readonly SupplyChainExpansionFrontierItem[],
  leads: readonly SupplyChainComponentDependencyLead[]
): string[] {
  const scopedUnknowns = input.workbench.unknown_items
    .filter((item) => componentMatchesRule(item.scope_id, rule) || materialOrProcessMatchesRule(item.scope_id, rule))
    .map((item) => item.unknown_id);
  const frontierUnknowns = frontier.flatMap((item) => item.unknown_ids);
  const leadUnknowns = leads.flatMap((lead) => lead.unknowns.map((unknown, index) => `${lead.lead_id}:unknown:${index}:${stableTextKey(unknown)}`));
  return [...scopedUnknowns, ...frontierUnknowns, ...leadUnknowns];
}

function observationMatchesRule(item: ObservationCoverageReport["types"][number], rule: AiComputePropagationLayerRule): boolean {
  if (item.components.some((componentId) => componentMatchesRule(componentId, rule))) return true;
  if (item.scopes.some((scope) => materialOrProcessMatchesRule(scope, rule))) return true;
  return rule.layer_id === "demand_to_compute" || rule.layer_id === "compute_to_fab_capacity";
}

function seriesMatchesRule(item: ObservationCoverageReport["series"][number], rule: AiComputePropagationLayerRule): boolean {
  if (item.component_id !== null && componentMatchesRule(item.component_id, rule)) return true;
  if (materialOrProcessMatchesRule(item.scope, rule)) return true;
  return rule.layer_id === "demand_to_compute" || rule.layer_id === "compute_to_fab_capacity";
}

function componentMatchesRule(componentId: string, rule: AiComputePropagationLayerRule): boolean {
  return rule.component_ids.includes(componentId);
}

function materialOrProcessMatchesRule(value: string, rule: AiComputePropagationLayerRule): boolean {
  return rule.material_or_process_prefixes.some((prefix) => value.startsWith(prefix) || value.includes(`:${prefix}`));
}

function countStatus(layers: readonly AiComputePropagationLayer[], status: AiComputePropagationLayerStatus): number {
  return layers.filter((layer) => layer.status === status).length;
}

function stableTextKey(value: string): string {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort((left, right) => left.localeCompare(right));
}
