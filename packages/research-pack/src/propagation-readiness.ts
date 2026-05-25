import type { SourcePlanItem } from "@supplystrata/source-plan";
import type { WorkbenchModel } from "@supplystrata/workbench-export";
import type { ObservationCoverageReport, ObservationSeriesReadiness } from "./observation-coverage.js";
import type {
  PropagationContextRule,
  PropagationReadinessItem,
  PropagationReadinessPolicy,
  PropagationReadinessReport
} from "./propagation-readiness-definitions.js";
import type { SupplyChainComponentDependencyLead, SupplyChainExpansionFrontierItem, SupplyChainExpansionPlan } from "./supply-chain-expansion-plan.js";

export {
  type PropagationContextKind,
  type PropagationContextRule,
  type PropagationReadinessItem,
  type PropagationReadinessPolicy,
  type PropagationReadinessReport,
  type PropagationReadinessStatus,
  type PropagationReadinessSummary
} from "./propagation-readiness-definitions.js";
export { renderPropagationReadinessMarkdown } from "./propagation-readiness-render.js";

export interface PropagationReadinessInput {
  generated_at: string;
  company_id: string;
  workbench: Pick<WorkbenchModel, "edges" | "chain_segments">;
  observation_coverage: ObservationCoverageReport;
  source_plan: readonly SourcePlanItem[];
  supply_chain_expansion_plan: SupplyChainExpansionPlan;
}

const NO_FACT_MUTATION_POLICY: PropagationReadinessPolicy = "reasoning_input_only_no_fact_mutation";

const PROPAGATION_RULES: readonly PropagationContextRule[] = [
  {
    context_kind: "demand_signal",
    title: "Demand signal readiness",
    question: "Can the pack describe whether downstream demand is changing?",
    ready_observation_types: ["BACKLOG_OBSERVATION", "CUSTOMER_CONCENTRATION_OBSERVATION"],
    supporting_observation_types: ["FINANCIAL_METRIC_OBSERVATION", "PROCUREMENT_OBSERVATION"],
    source_purposes: ["official_disclosure", "procurement"],
    frontier_required: true,
    action_ready: "Use these observations as demand context for AI/frontend research; do not convert demand into a supplier fact edge.",
    action_partial:
      "Collect explicit backlog, customer concentration, procurement, or comparable financial observations before treating demand context as ready.",
    action_blocked: "Add official disclosure or procurement targets that can produce demand observations."
  },
  {
    context_kind: "capacity_expansion_signal",
    title: "Capacity expansion readiness",
    question: "Can the pack describe whether relevant companies or facilities are expanding capacity?",
    ready_observation_types: ["CAPEX_OBSERVATION"],
    supporting_observation_types: ["FINANCIAL_METRIC_OBSERVATION", "FACILITY_PROFILE_OBSERVATION"],
    source_purposes: ["official_disclosure", "facility"],
    action_ready: "Use capex observations as capacity context and keep any supplier relationship changes in review-only paths.",
    action_partial: "Run official disclosure and facility checks until capex or facility-specific expansion observations are visible.",
    action_blocked: "Add official disclosure or facility source targets for the frontier nodes."
  },
  {
    context_kind: "facility_construction_signal",
    title: "Facility construction readiness",
    question: "Can the pack locate facility, cleanroom, or data-center construction context?",
    ready_observation_types: ["FACILITY_PROFILE_OBSERVATION"],
    supporting_observation_types: ["CAPEX_OBSERVATION", "PROCUREMENT_OBSERVATION"],
    source_purposes: ["facility", "procurement"],
    dependency_categories: ["facility"],
    action_ready: "Use facility observations as construction context only; they are not buyer-supplier fact evidence.",
    action_partial: "Promote facility and procurement source-plan targets into monitored observations before downstream analysis.",
    action_blocked: "Add facility or procurement targets for construction-sensitive nodes."
  },
  {
    context_kind: "equipment_installation_signal",
    title: "Equipment installation readiness",
    question: "Can the pack identify equipment, installation, or tool-capacity context?",
    ready_observation_types: ["PROCUREMENT_OBSERVATION", "CAPEX_OBSERVATION"],
    supporting_observation_types: ["POLICY_OBSERVATION"],
    source_purposes: ["procurement", "policy"],
    dependency_categories: ["equipment"],
    component_id_prefixes: ["COMP-EUV", "COMP-SEMICONDUCTOR-EQUIPMENT"],
    action_ready: "Use equipment context as a reasoning input and require official relation evidence before creating company edges.",
    action_partial: "Review equipment dependency leads and official disclosure targets for capacity or installation observations.",
    action_blocked: "Add equipment-oriented component taxonomy leads or official equipment supplier targets."
  },
  {
    context_kind: "process_material_consumption_signal",
    title: "Process material readiness",
    question: "Can the pack name upstream process materials without pretending they are confirmed suppliers?",
    ready_observation_types: ["MINERAL_SUPPLY_OBSERVATION", "COMMODITY_PRICE_OBSERVATION"],
    supporting_observation_types: ["TRADE_FLOW_OBSERVATION", "POLICY_OBSERVATION"],
    source_purposes: ["commodity", "trade", "policy"],
    dependency_categories: ["material", "energy"],
    component_id_prefixes: ["MAT-", "COMP-PHOTORESIST", "COMP-SPECIALTY-GASES"],
    action_ready:
      "Expose material observations to downstream AI/frontend reasoning and keep company-level sourcing as unknown unless reviewed evidence exists.",
    action_partial: "Use material taxonomy and source-plan targets to collect price, trade, mineral, or policy observations.",
    action_blocked: "Add material taxonomy/source-plan coverage for the current component frontier."
  },
  {
    context_kind: "material_price_or_trade_signal",
    title: "Material price and trade readiness",
    question: "Can the pack describe material price, trade, or supply movement?",
    ready_observation_types: ["COMMODITY_PRICE_OBSERVATION", "TRADE_FLOW_OBSERVATION", "MINERAL_SUPPLY_OBSERVATION"],
    source_purposes: ["commodity", "trade", "macro"],
    action_ready: "Use these series as external context; they cannot prove a company purchase relationship.",
    action_partial: "Run planned commodity/trade/mineral targets until comparable observation series are visible.",
    action_blocked: "Add commodity, trade, or mineral source targets for exposed upstream materials."
  },
  {
    context_kind: "policy_or_export_control_signal",
    title: "Policy and export-control readiness",
    question: "Can the pack describe policy, sanction, or export-control pressure along the chain?",
    ready_observation_types: ["POLICY_OBSERVATION"],
    supporting_observation_types: ["PROCUREMENT_OBSERVATION"],
    source_purposes: ["policy"],
    action_ready: "Use policy observations as external risk context and keep relation changes in review paths.",
    action_partial: "Collect policy observations from registered official or policy sources before deriving alerts.",
    action_blocked: "Add policy source targets for jurisdictions, materials, equipment, or counterparties in scope."
  }
];

export function buildPropagationReadinessReport(input: PropagationReadinessInput): PropagationReadinessReport {
  const items = PROPAGATION_RULES.map((rule) => buildItem(rule, input)).sort((left, right) => left.context_id.localeCompare(right.context_id));
  return {
    schema_version: "1.0.0",
    generated_at: input.generated_at,
    company_id: input.company_id,
    summary: {
      contexts_total: items.length,
      ready: items.filter((item) => item.status === "ready").length,
      partial: items.filter((item) => item.status === "partial").length,
      blocked: items.filter((item) => item.status === "blocked").length,
      contexts_with_observations: items.filter((item) => item.observation_types.length > 0).length,
      contexts_with_source_plan: items.filter((item) => item.source_plan_refs.length > 0).length,
      contexts_with_component_leads: items.filter((item) => item.component_dependency_refs.length > 0).length,
      reasoning_inputs: items.reduce((count, item) => count + item.ready_signals.length, 0),
      no_fact_mutation_policy: NO_FACT_MUTATION_POLICY
    },
    items
  };
}

function buildItem(rule: PropagationContextRule, input: PropagationReadinessInput): PropagationReadinessItem {
  const observations = observationsForRule(rule, input.observation_coverage);
  const readySeries = input.observation_coverage.series.filter(
    (series) => rule.ready_observation_types.includes(series.observation_type) && series.status !== "sparse"
  );
  const sourcePlanItems = sourcePlanItemsForRule(rule, input.source_plan);
  const leads = dependencyLeadsForRule(rule, input.supply_chain_expansion_plan.component_dependency_leads);
  const frontier = frontierForRule(rule, input.supply_chain_expansion_plan.frontier);
  const materialOrProcessRefs = materialOrProcessRefsFor(rule, sourcePlanItems, leads);
  const readySignals = readySignalsFor({ observations, readySeries, sourcePlanItems, leads, frontier });
  const missingRequirements = missingRequirementsFor(rule, { observations, readySeries, sourcePlanItems, leads, frontier });
  const status = statusFor({ observations, readySeries, sourcePlanItems, leads, frontier });

  return {
    context_id: `propagation:${rule.context_kind}`,
    context_kind: rule.context_kind,
    status,
    title: rule.title,
    question: rule.question,
    confidence: confidenceFor(status, readySignals.length),
    ready_signals: readySignals,
    missing_requirements: missingRequirements,
    observation_types: uniqueSorted(observations.map((item) => item.observation_type)),
    observation_series_refs: readySeries.slice(0, 12).map((series) => `observation_series:${series.series_key}`),
    source_plan_refs: sourcePlanItems.slice(0, 12).map((item) => `source_plan:${item.source_id}`),
    component_dependency_refs: leads.slice(0, 20).map((lead) => `component_dependency:${lead.dependency_id}`),
    frontier_refs: frontier.slice(0, 20).map((item) => `supply_chain_frontier:${item.frontier_id}`),
    component_ids: uniqueSorted([
      ...sourcePlanItems.flatMap((item) => [...item.parent_component_ids, ...item.target_ids.filter((targetId) => targetId.startsWith("COMP-"))]),
      ...leads.flatMap((lead) => [lead.parent_component_id, lead.target_id].filter((id) => id.startsWith("COMP-"))),
      ...frontier.flatMap((item) => (item.component_id === null ? [] : [item.component_id]))
    ]),
    material_or_process_refs: materialOrProcessRefs,
    policy: NO_FACT_MUTATION_POLICY,
    rationale: rationaleFor(status),
    action: actionForStatus(rule, status)
  };
}

function materialOrProcessRefsFor(
  rule: PropagationContextRule,
  sourcePlanItems: readonly SourcePlanItem[],
  leads: readonly SupplyChainComponentDependencyLead[]
): string[] {
  if (
    !["equipment_installation_signal", "facility_construction_signal", "process_material_consumption_signal", "material_price_or_trade_signal"].includes(
      rule.context_kind
    )
  ) {
    return [];
  }
  const sourcePlanTargets = sourcePlanItems.flatMap((item) => {
    if (!["commodity", "trade", "logistics", "policy"].includes(item.purpose) && rule.context_kind !== "facility_construction_signal") return [];
    return item.target_ids.filter((targetId) => targetId.startsWith("MAT-") || targetId.startsWith("COMP-"));
  });
  const leadTargets = leads.map((lead) => lead.target_id).filter((targetId) => targetId.startsWith("MAT-") || targetId.startsWith("COMP-"));
  return uniqueSorted([...sourcePlanTargets, ...leadTargets]);
}

function observationsForRule(rule: PropagationContextRule, report: ObservationCoverageReport): ObservationCoverageReport["types"] {
  const acceptedTypes = new Set([...(rule.ready_observation_types ?? []), ...(rule.supporting_observation_types ?? [])]);
  return report.types.filter((item) => acceptedTypes.has(item.observation_type));
}

function sourcePlanItemsForRule(rule: PropagationContextRule, sourcePlan: readonly SourcePlanItem[]): SourcePlanItem[] {
  return sourcePlan.filter((item) => {
    const sourceMatches = rule.source_ids?.includes(item.source_id) ?? false;
    const purposeMatches = rule.source_purposes?.includes(item.purpose) ?? false;
    const componentMatches = (rule.component_id_prefixes ?? []).some((prefix) => item.target_ids.some((targetId) => targetId.startsWith(prefix)));
    return sourceMatches || purposeMatches || componentMatches;
  });
}

function dependencyLeadsForRule(rule: PropagationContextRule, leads: readonly SupplyChainComponentDependencyLead[]): SupplyChainComponentDependencyLead[] {
  return leads.filter((lead) => {
    const categoryMatches = rule.dependency_categories?.includes(lead.category) ?? false;
    const componentMatches = (rule.component_id_prefixes ?? []).some((prefix) => lead.target_id.startsWith(prefix));
    return categoryMatches || componentMatches;
  });
}

function frontierForRule(rule: PropagationContextRule, frontier: readonly SupplyChainExpansionFrontierItem[]): SupplyChainExpansionFrontierItem[] {
  if (rule.frontier_required !== true) return [];
  return frontier.filter((item) => item.expansion_state === "expand_candidate");
}

function readySignalsFor(input: {
  observations: ObservationCoverageReport["types"];
  readySeries: readonly ObservationSeriesReadiness[];
  sourcePlanItems: readonly SourcePlanItem[];
  leads: readonly SupplyChainComponentDependencyLead[];
  frontier: readonly SupplyChainExpansionFrontierItem[];
}): string[] {
  return [
    signalIf(input.observations.length > 0, `${input.observations.length} relevant observation type(s) visible`),
    signalIf(input.readySeries.length > 0, `${input.readySeries.length} non-sparse observation series ready`),
    signalIf(input.sourcePlanItems.length > 0, `${input.sourcePlanItems.length} source-plan item(s) can collect more context`),
    signalIf(input.leads.length > 0, `${input.leads.length} component/material/equipment dependency lead(s) available`),
    signalIf(input.frontier.length > 0, `${input.frontier.length} L4/L5 frontier edge(s) provide chain context`)
  ].filter(isPresent);
}

function missingRequirementsFor(
  rule: PropagationContextRule,
  input: {
    observations: ObservationCoverageReport["types"];
    readySeries: readonly ObservationSeriesReadiness[];
    sourcePlanItems: readonly SourcePlanItem[];
    leads: readonly SupplyChainComponentDependencyLead[];
    frontier: readonly SupplyChainExpansionFrontierItem[];
  }
): string[] {
  return [
    signalIf(input.observations.length === 0, `No ${rule.ready_observation_types.join(" / ")} context is visible yet`),
    signalIf(input.readySeries.length === 0, "No non-sparse observation series is ready for this propagation context"),
    signalIf(input.sourcePlanItems.length === 0, "No matching source-plan path is available to collect more context"),
    signalIf(
      (rule.dependency_categories?.length ?? 0) > 0 && input.leads.length === 0,
      "No matching component/material/equipment dependency lead is available"
    ),
    signalIf(rule.frontier_required === true && input.frontier.length === 0, "No current L4/L5 expansion frontier supports this context")
  ].filter(isPresent);
}

function statusFor(input: {
  observations: ObservationCoverageReport["types"];
  readySeries: readonly ObservationSeriesReadiness[];
  sourcePlanItems: readonly SourcePlanItem[];
  leads: readonly SupplyChainComponentDependencyLead[];
  frontier: readonly SupplyChainExpansionFrontierItem[];
}): PropagationReadinessItem["status"] {
  if (input.observations.length > 0 && (input.readySeries.length > 0 || input.sourcePlanItems.length > 0 || input.leads.length > 0)) return "ready";
  if (input.observations.length > 0 || input.sourcePlanItems.length > 0 || input.leads.length > 0 || input.frontier.length > 0) return "partial";
  return "blocked";
}

function confidenceFor(status: PropagationReadinessItem["status"], signalCount: number): number {
  if (status === "ready") return Math.min(0.92, 0.7 + signalCount * 0.04);
  if (status === "partial") return Math.min(0.68, 0.32 + signalCount * 0.08);
  return 0.1;
}

function actionForStatus(rule: PropagationContextRule, status: PropagationReadinessItem["status"]): string {
  if (status === "ready") return rule.action_ready;
  if (status === "partial") return rule.action_partial;
  return rule.action_blocked;
}

function rationaleFor(status: PropagationReadinessItem["status"]): string {
  if (status === "ready") return "Structured observations are present and there is enough source/series/dependency context for downstream reasoning.";
  if (status === "partial") return "Some structured context exists, but the pack still needs stronger observations, source targets, or dependency coverage.";
  return "No structured propagation input is visible yet for this context.";
}

function signalIf(condition: boolean, value: string): string | null {
  return condition ? value : null;
}

function isPresent(value: string | null): value is string {
  return value !== null && value.length > 0;
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
