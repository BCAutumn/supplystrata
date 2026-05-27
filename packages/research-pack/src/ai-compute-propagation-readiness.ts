import type { ObservationType } from "@supplystrata/core";
import type { SourcePlanItem } from "@supplystrata/source-plan";
import type { WorkbenchModel } from "@supplystrata/workbench-export";
import type { ObservationCoverageReport } from "./observation-coverage.js";
import type { OfficialDisclosureReadinessReport } from "./official-disclosure-readiness.js";
import type { SourceTargetCoverageReport } from "./source-target-coverage.js";
import type { SupplyChainComponentDependencyLead, SupplyChainExpansionFrontierItem, SupplyChainExpansionPlan } from "./supply-chain-expansion-plan.js";
import type {
  AiComputePropagationEvidenceLayerSummary,
  AiComputePropagationLayer,
  AiComputePropagationLayerId,
  AiComputePropagationLayerReadinessAnswers,
  AiComputePropagationLayerStatus,
  AiComputePropagationNextResearchTarget,
  AiComputePropagationOfficialEvidenceGap,
  AiComputePropagationReadinessMatrix,
  AiComputePropagationSourceTargetGroup,
  AiComputePropagationSourceTargetStatus,
  AiComputePropagationSourceTargetStatusSummary,
  AiComputePropagationUnknownBacklogSeed,
  AiComputePropagationUnknownBacklogSummary
} from "./ai-compute-propagation-readiness-definitions.js";
import { buildAiComputePropagationEvidenceLayerSummary } from "./ai-compute-propagation-evidence-summary.js";
import { buildAiComputePropagationExecutionQueue } from "./ai-compute-propagation-execution-queue.js";
import { buildAiComputePropagationLayerReadinessAnswers } from "./ai-compute-propagation-layer-answers.js";
import { buildAiComputePropagationNextResearchTargets } from "./ai-compute-propagation-next-targets.js";
import { buildAiComputePropagationOfficialEvidenceGaps } from "./ai-compute-propagation-official-evidence-gaps.js";
import {
  AI_COMPUTE_PROPAGATION_POLICY,
  allowedResearchOutputsFor,
  missingOfficialEvidenceFor,
  nextActionsFor,
  prohibitedTruthStoreWritesFor
} from "./ai-compute-propagation-policy.js";
import { isBlockedSourceTarget } from "./ai-compute-propagation-source-target-summary.js";
import { buildAiComputePropagationLayerSourceTargets } from "./ai-compute-propagation-source-targets.js";
import { buildAiComputePropagationUnknownBacklogSummary } from "./ai-compute-propagation-unknown-backlog-summary.js";

export type {
  AiComputePropagationLayer,
  AiComputePropagationLayerId,
  AiComputePropagationLayerReadinessAnswers,
  AiComputePropagationLayerStatus,
  AiComputePropagationEvidenceLayerSummary,
  AiComputePropagationEvidenceLayerKind,
  AiComputePropagationExecutionAction,
  AiComputePropagationExecutionPriority,
  AiComputePropagationExecutionQueue,
  AiComputePropagationExecutionQueueItem,
  AiComputePropagationExecutionQueueSummary,
  AiComputePropagationPolicy,
  AiComputePropagationReadinessMatrix,
  AiComputePropagationReadinessSummary,
  AiComputePropagationOfficialEvidenceGap,
  AiComputePropagationSourceTargetGroup,
  AiComputePropagationSourceTargetGroupKind,
  AiComputePropagationSourceTargetStatusSummary,
  AiComputePropagationUnknownBacklogSeed,
  AiComputePropagationUnknownBacklogSummary
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
}

interface LayerRefs {
  fact_edge_refs: string[];
  observation_refs: string[];
  observation_series_refs: string[];
  source_plan_refs: string[];
  source_target_refs: string[];
  source_target_groups: AiComputePropagationSourceTargetGroup[];
  source_target_statuses: AiComputePropagationSourceTargetStatus[];
  source_target_status_summary: AiComputePropagationSourceTargetStatusSummary;
  next_research_targets: AiComputePropagationNextResearchTarget[];
  component_dependency_refs: string[];
  frontier_refs: string[];
  unknown_refs: string[];
  material_or_process_refs: string[];
  fact_component_ids: string[];
}

const LAYER_RULES: readonly AiComputePropagationLayerRule[] = [
  {
    layer_id: "demand_to_compute",
    title: "Demand to compute",
    question: "Do we have demand, capex, or customer signals that explain why compute capacity may expand?",
    component_ids: ["COMP-GPU", "COMP-HBM", "COMP-SERVER"],
    material_or_process_prefixes: [],
    observation_types: ["BACKLOG_OBSERVATION", "CUSTOMER_CONCENTRATION_OBSERVATION", "FINANCIAL_METRIC_OBSERVATION", "CAPEX_OBSERVATION"]
  },
  {
    layer_id: "compute_to_server",
    title: "Compute to AI server infrastructure",
    question: "Can the pack trace compute demand into AI server, ODM, optical, power, and cooling frontier?",
    component_ids: ["COMP-SERVER", "COMP-MANUFACTURING-SERVICES", "COMP-OPTICAL-MODULE", "COMP-POWER-SUPPLY", "COMP-COOLING"],
    material_or_process_prefixes: [],
    observation_types: ["PROCUREMENT_OBSERVATION", "CAPEX_OBSERVATION", "FACILITY_PROFILE_OBSERVATION"]
  },
  {
    layer_id: "server_to_board_materials",
    title: "AI server to board materials",
    question: "Can the pack move from AI server/PCB context into CCL, copper foil, electronic glass cloth, and resin?",
    component_ids: ["COMP-PCB", "COMP-CCL", "COMP-COPPER-FOIL", "COMP-ELECTRONIC-GLASS-CLOTH", "COMP-LAMINATE-RESIN", "COMP-ABF-SUBSTRATE"],
    material_or_process_prefixes: ["MAT-COPPER"],
    observation_types: ["TRADE_FLOW_OBSERVATION", "COMMODITY_PRICE_OBSERVATION", "MINERAL_SUPPLY_OBSERVATION"]
  },
  {
    layer_id: "compute_to_fab_capacity",
    title: "Compute to fab capacity",
    question: "Can the pack connect compute demand to foundry, wafer, packaging, or memory capacity signals?",
    component_ids: ["COMP-WAFER", "COMP-SILICON-WAFER", "COMP-ADVANCED-PACKAGING", "COMP-HBM", "COMP-DRAM"],
    material_or_process_prefixes: [],
    observation_types: ["CAPEX_OBSERVATION", "FACILITY_PROFILE_OBSERVATION", "PROCUREMENT_OBSERVATION"]
  },
  {
    layer_id: "fab_to_construction",
    title: "Fab capacity to cleanroom construction",
    question: "Do we have cleanroom, construction, or hook-up context before equipment installation?",
    component_ids: ["COMP-CLEANROOM"],
    material_or_process_prefixes: [],
    observation_types: ["FACILITY_PROFILE_OBSERVATION", "CAPEX_OBSERVATION", "PROCUREMENT_OBSERVATION"]
  },
  {
    layer_id: "construction_to_equipment",
    title: "Construction to semiconductor equipment",
    question: "Can the pack identify equipment delivery, installation, qualification, or tool-capacity frontier?",
    component_ids: ["COMP-EUV-LITHOGRAPHY", "COMP-SEMICONDUCTOR-EQUIPMENT"],
    material_or_process_prefixes: [],
    observation_types: ["PROCUREMENT_OBSERVATION", "CAPEX_OBSERVATION", "POLICY_OBSERVATION"]
  },
  {
    layer_id: "equipment_to_process_inputs",
    title: "Equipment to process inputs",
    question: "Can the pack name process consumables such as photoresist, targets, CMP, gases, and chemicals without asserting suppliers?",
    component_ids: ["COMP-PHOTORESIST", "COMP-TARGET", "COMP-CMP", "COMP-SPECIALTY-GASES"],
    material_or_process_prefixes: ["MAT-"],
    observation_types: ["COMMODITY_PRICE_OBSERVATION", "TRADE_FLOW_OBSERVATION", "MINERAL_SUPPLY_OBSERVATION", "POLICY_OBSERVATION"]
  },
  {
    layer_id: "process_to_raw_materials",
    title: "Process inputs to raw materials",
    question: "Can the pack expose raw material constraints behind copper, glass fiber, resin, rare gases, metals, or chemicals?",
    component_ids: [],
    material_or_process_prefixes: ["MAT-"],
    observation_types: ["MINERAL_SUPPLY_OBSERVATION", "COMMODITY_PRICE_OBSERVATION", "TRADE_FLOW_OBSERVATION", "POLICY_OBSERVATION"]
  }
];

export function buildAiComputePropagationReadinessMatrix(input: AiComputePropagationReadinessInput): AiComputePropagationReadinessMatrix {
  const layers = LAYER_RULES.map((rule) => layerFromRule(rule, input));
  return {
    schema_version: "1.0.0",
    matrix_id: "ai_compute_propagation.v0",
    policy: AI_COMPUTE_PROPAGATION_POLICY,
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
  const officialEvidenceGaps = officialEvidenceGapsFor(rule, status, refs);
  const unknownBacklogSeeds = unknownBacklogSeedsFor(rule, status, refs);
  const unknownBacklogSummary = buildAiComputePropagationUnknownBacklogSummary({ unknown_refs: refs.unknown_refs, unknown_backlog_seeds: unknownBacklogSeeds });
  const allowedResearchOutputs = allowedResearchOutputsFor(status);
  const prohibitedTruthStoreWrites = prohibitedTruthStoreWritesFor(status);
  const readinessAnswers = readinessAnswersFor(refs, officialEvidenceGaps, unknownBacklogSummary, allowedResearchOutputs, prohibitedTruthStoreWrites);
  const executionQueue = buildAiComputePropagationExecutionQueue({
    layer_id: rule.layer_id,
    layer_title: rule.title,
    status,
    source_target_statuses: refs.source_target_statuses,
    official_evidence_gaps: officialEvidenceGaps,
    unknown_refs: refs.unknown_refs,
    unknown_backlog_seeds: unknownBacklogSeeds,
    next_research_targets: refs.next_research_targets
  });
  return {
    layer_id: rule.layer_id,
    title: rule.title,
    question: rule.question,
    status,
    status_reason: statusReason(status, refs),
    readiness_answers: readinessAnswers,
    execution_queue: executionQueue,
    evidence_layer_summary: evidenceLayerSummaryFor(refs, officialEvidenceGaps, unknownBacklogSeeds),
    component_ids: [...rule.component_ids],
    material_or_process_refs: refs.material_or_process_refs,
    fact_edge_refs: refs.fact_edge_refs,
    observation_refs: refs.observation_refs,
    observation_series_refs: refs.observation_series_refs,
    source_plan_refs: refs.source_plan_refs,
    source_target_refs: refs.source_target_refs,
    source_target_groups: refs.source_target_groups,
    source_target_statuses: refs.source_target_statuses,
    source_target_status_summary: refs.source_target_status_summary,
    next_research_targets: refs.next_research_targets,
    component_dependency_refs: refs.component_dependency_refs,
    frontier_refs: refs.frontier_refs,
    unknown_refs: refs.unknown_refs,
    unknown_backlog_seeds: unknownBacklogSeeds,
    unknown_backlog_summary: unknownBacklogSummary,
    official_evidence_gaps: officialEvidenceGaps,
    missing_official_evidence: missingOfficialEvidenceFor(status),
    allowed_research_outputs: allowedResearchOutputs,
    prohibited_truth_store_writes: prohibitedTruthStoreWrites,
    next_actions: nextActionsFor(status),
    policy: AI_COMPUTE_PROPAGATION_POLICY
  };
}

function readinessAnswersFor(
  refs: LayerRefs,
  officialEvidenceGaps: readonly AiComputePropagationOfficialEvidenceGap[],
  unknownBacklogSummary: AiComputePropagationUnknownBacklogSummary,
  allowedResearchOutputs: readonly string[],
  prohibitedTruthStoreWrites: readonly string[]
): AiComputePropagationLayerReadinessAnswers {
  return buildAiComputePropagationLayerReadinessAnswers({
    fact_edge_refs: refs.fact_edge_refs,
    observation_refs: refs.observation_refs,
    observation_series_refs: refs.observation_series_refs,
    component_dependency_refs: refs.component_dependency_refs,
    frontier_refs: refs.frontier_refs,
    official_evidence_gaps: officialEvidenceGaps,
    unknown_backlog_summary: unknownBacklogSummary,
    next_research_targets: refs.next_research_targets,
    source_target_statuses: refs.source_target_statuses,
    source_target_status_summary: refs.source_target_status_summary,
    allowed_research_outputs: allowedResearchOutputs,
    prohibited_truth_store_writes: prohibitedTruthStoreWrites,
    policy: AI_COMPUTE_PROPAGATION_POLICY
  });
}

function evidenceLayerSummaryFor(
  refs: LayerRefs,
  officialEvidenceGaps: readonly AiComputePropagationOfficialEvidenceGap[],
  unknownBacklogSeeds: readonly AiComputePropagationUnknownBacklogSeed[]
): AiComputePropagationEvidenceLayerSummary[] {
  return buildAiComputePropagationEvidenceLayerSummary({
    fact_edge_refs: refs.fact_edge_refs,
    observation_refs: refs.observation_refs,
    observation_series_refs: refs.observation_series_refs,
    component_dependency_refs: refs.component_dependency_refs,
    frontier_refs: refs.frontier_refs,
    unknown_refs: refs.unknown_refs,
    unknown_backlog_seed_refs: unknownBacklogSeeds.map((seed) => `unknown_seed:${seed.seed_id}`),
    source_plan_refs: refs.source_plan_refs,
    source_target_refs: refs.source_target_refs,
    official_evidence_gaps: officialEvidenceGaps
  });
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
  const officialNodes = input.official_disclosure_readiness.nodes.filter((node) => node.node_kind === "component" && componentMatchesRule(node.node_id, rule));
  const unknownIds = unknownRefsFor(rule, input, frontier, leads);
  const sourceTargets = buildAiComputePropagationLayerSourceTargets({
    scope: {
      component_ids: rule.component_ids,
      material_or_process_prefixes: rule.material_or_process_prefixes
    },
    source_plan_items: sourcePlanItems,
    source_target_coverage: input.source_target_coverage,
    official_nodes: officialNodes
  });
  const materialOrProcessRefs = uniqueSorted([
    ...sourcePlanItems.flatMap((item) => item.target_ids.filter((targetId) => materialOrProcessMatchesRule(targetId, rule))),
    ...leads.map((lead) => lead.target_id).filter((targetId) => materialOrProcessMatchesRule(targetId, rule))
  ]);
  const nextResearchTargets = buildAiComputePropagationNextResearchTargets({
    component_ids: rule.component_ids,
    material_or_process_refs: materialOrProcessRefs,
    source_target_groups: sourceTargets.source_target_groups,
    leads,
    frontier
  });

  return {
    fact_edge_refs: uniqueSorted(factEdges.map((edge) => `edge:${edge.edge_id}`)),
    observation_refs: uniqueSorted(observations.flatMap((item) => item.sample_observation_ids.map((observationId) => `observation:${observationId}`))),
    observation_series_refs: uniqueSorted(series.filter((item) => item.status !== "sparse").map((item) => `observation_series:${item.series_key}`)),
    source_plan_refs: uniqueSorted([
      ...sourcePlanItems.map((item) => `source_plan:${item.source_id}`),
      ...officialNodes.flatMap((node) => node.source_plan_refs)
    ]),
    source_target_refs: uniqueSorted(sourceTargets.source_target_statuses.map((item) => item.ref)),
    source_target_groups: sourceTargets.source_target_groups,
    source_target_statuses: sourceTargets.source_target_statuses,
    source_target_status_summary: sourceTargets.source_target_status_summary,
    next_research_targets: nextResearchTargets,
    component_dependency_refs: uniqueSorted(leads.map((lead) => `component_dependency:${lead.dependency_id}`)),
    frontier_refs: uniqueSorted(frontier.map((item) => `supply_chain_frontier:${item.frontier_id}`)),
    unknown_refs: uniqueSorted(unknownIds.map((unknownId) => `unknown:${unknownId}`)),
    material_or_process_refs: materialOrProcessRefs,
    fact_component_ids: uniqueSorted(factEdges.flatMap((edge) => (edge.component_id === null ? [] : [edge.component_id])))
  };
}

function officialEvidenceGapsFor(
  rule: AiComputePropagationLayerRule,
  status: AiComputePropagationLayerStatus,
  refs: LayerRefs
): AiComputePropagationOfficialEvidenceGap[] {
  return buildAiComputePropagationOfficialEvidenceGaps({
    layer_id: rule.layer_id,
    status,
    component_ids: rule.component_ids,
    material_or_process_refs: refs.material_or_process_refs,
    fact_component_ids: refs.fact_component_ids,
    observation_refs: refs.observation_refs,
    observation_series_refs: refs.observation_series_refs,
    source_target_groups: refs.source_target_groups
  });
}

function statusFor(refs: LayerRefs): AiComputePropagationLayerStatus {
  if (refs.fact_edge_refs.length > 0) return "covered_fact";
  if (refs.observation_refs.length > 0 || refs.observation_series_refs.length > 0) return "observation_ready";
  if (refs.source_target_statuses.some((item) => !isBlockedSourceTarget(item))) return "official_target_runnable";
  if (refs.source_plan_refs.length > 0 && refs.source_target_statuses.length === 0) return "official_target_runnable";
  if (refs.source_target_statuses.some(isBlockedSourceTarget)) return "blocked_source";
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

function unknownBacklogSeedsFor(
  rule: AiComputePropagationLayerRule,
  status: AiComputePropagationLayerStatus,
  refs: LayerRefs
): AiComputePropagationUnknownBacklogSeed[] {
  if (status === "covered_fact" || status === "observation_ready") return [];
  return [
    {
      seed_id: `AI-COMPUTE-UNKNOWN-SEED-${rule.layer_id.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}`,
      question: unknownSeedQuestionFor(rule, status),
      why_unknown: unknownSeedReasonFor(status),
      target_scope_refs: uniqueSorted([
        ...rule.component_ids.map((componentId) => `component:${componentId}`),
        ...refs.material_or_process_refs.map((ref) => `material_or_process:${ref}`)
      ]),
      existing_unknown_refs: refs.unknown_refs,
      source_plan_refs: refs.source_plan_refs,
      source_target_refs: refs.source_target_refs,
      recommended_review_action: unknownSeedActionFor(status, refs),
      truth_store_write_policy: "review_only_no_automatic_write"
    }
  ];
}

function unknownSeedQuestionFor(rule: AiComputePropagationLayerRule, status: AiComputePropagationLayerStatus): string {
  if (status === "blocked_source") return `Which official source target must be repaired before the ${rule.title} layer can be researched?`;
  if (status === "official_target_runnable") return `Which reviewed citation from the planned official source can answer: ${rule.question}`;
  if (status === "lead_only") return `Which official evidence would turn the current ${rule.title} lead into a reviewable fact candidate?`;
  return `What official source can establish or explicitly reject the ${rule.title} propagation layer?`;
}

function unknownSeedReasonFor(status: AiComputePropagationLayerStatus): string {
  if (status === "blocked_source") return "A relevant source target exists, but its current operational state prevents evidence collection.";
  if (status === "official_target_runnable") return "A source path exists, but no reviewed citation has been accepted into the evidence layer yet.";
  if (status === "lead_only") return "Only taxonomy or frontier leads are visible, so the relation must stay outside the fact layer.";
  return "No fact, observation, lead, or runnable official source path currently covers this AI compute propagation layer.";
}

function unknownSeedActionFor(
  status: AiComputePropagationLayerStatus,
  refs: Pick<LayerRefs, "unknown_refs" | "source_target_refs">
): AiComputePropagationUnknownBacklogSeed["recommended_review_action"] {
  if (status === "blocked_source") return "repair_source_target";
  if (status === "official_target_runnable") return "run_source_target";
  if (refs.unknown_refs.length > 0) return "keep_existing_unknown_open";
  return "create_explicit_unknown";
}

function sourcePlanItemsForRule(rule: AiComputePropagationLayerRule, sourcePlan: readonly SourcePlanItem[]): SourcePlanItem[] {
  // propagation layer 的 source path 必须锚定到当前层的组件或材料；不能因为同属 official_disclosure / trade 这类大类，
  // 就把全局 source-plan 借给每一层，否则会把“有源可查”误报成“这一层已可查”。
  return sourcePlan.filter(
    (item) =>
      item.parent_component_ids.some((componentId) => componentMatchesRule(componentId, rule)) ||
      item.target_ids.some((targetId) => componentMatchesRule(targetId, rule) || materialOrProcessMatchesRule(targetId, rule))
  );
}

function leadsForRule(rule: AiComputePropagationLayerRule, leads: readonly SupplyChainComponentDependencyLead[]): SupplyChainComponentDependencyLead[] {
  // lead 只能按具体 parent/target 匹配；category 只是 lead 的解释标签，不能作为覆盖当前层的证据。
  return leads.filter(
    (lead) =>
      componentMatchesRule(lead.parent_component_id, rule) || componentMatchesRule(lead.target_id, rule) || materialOrProcessMatchesRule(lead.target_id, rule)
  );
}

function frontierForRule(rule: AiComputePropagationLayerRule, frontier: readonly SupplyChainExpansionFrontierItem[]): SupplyChainExpansionFrontierItem[] {
  return frontier.filter((item) => item.component_id !== null && componentMatchesRule(item.component_id, rule));
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
