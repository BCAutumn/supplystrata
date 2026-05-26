import type {
  AiComputePropagationNextResearchTarget,
  AiComputePropagationSourceTargetGroup,
  AiComputePropagationSourceTargetGroupKind
} from "./ai-compute-propagation-readiness-definitions.js";
import type { SupplyChainComponentDependencyLead, SupplyChainExpansionFrontierItem } from "./supply-chain-expansion-plan.js";

export interface BuildAiComputePropagationNextTargetsInput {
  component_ids: readonly string[];
  material_or_process_refs: readonly string[];
  source_target_groups: readonly AiComputePropagationSourceTargetGroup[];
  leads: readonly SupplyChainComponentDependencyLead[];
  frontier: readonly SupplyChainExpansionFrontierItem[];
}

export function buildAiComputePropagationNextResearchTargets(input: BuildAiComputePropagationNextTargetsInput): AiComputePropagationNextResearchTarget[] {
  const layerComponentTargets = input.component_ids.map((componentId) => ({
    target_kind: "component" as const,
    target_id: componentId,
    label: componentId,
    reason: "Component is part of this AI compute propagation layer scope.",
    refs: [`component:${componentId}`],
    action: "Use matching fact, observation, source target, or unknown refs to research this component."
  }));
  const layerMaterialTargets = input.material_or_process_refs.map((ref) => ({
    target_kind: "material_or_process" as const,
    target_id: ref,
    label: ref,
    reason: "Material or process target is part of this AI compute propagation layer scope.",
    refs: [`material_or_process:${ref}`],
    action: "Use matching observation or source target refs to research this material/process target."
  }));
  const companyTargets = input.frontier
    .filter((item) => item.expansion_state === "expand_candidate" && item.next_company_id !== null && item.next_company_name !== null)
    .map((item) => ({
      target_kind: "company" as const,
      target_id: item.next_company_id ?? "",
      label: item.next_company_name ?? "",
      reason: item.rationale,
      refs: uniqueSorted([`supply_chain_frontier:${item.frontier_id}`, `edge:${item.edge_id}`, ...item.unknown_ids.map((unknownId) => `unknown:${unknownId}`)]),
      action: item.action
    }));

  const leadTargets = input.leads
    .filter((lead) => lead.state !== "fact_covered")
    .map((lead) => ({
      target_kind: targetKindForLead(lead),
      target_id: lead.target_id,
      label: lead.target_name,
      reason: `${lead.state}; source authority ${lead.source_path_authority}. ${lead.rationale}`,
      refs: uniqueSorted([
        `component_dependency:${lead.dependency_id}`,
        ...lead.source_plan_refs,
        ...lead.supporting_edge_ids.map((edgeId) => `edge:${edgeId}`),
        ...lead.unknowns.map((unknown, index) => `lead_unknown:${lead.lead_id}:${index}:${stableTextKey(unknown)}`)
      ]),
      action: lead.action
    }));

  const sourceGroupTargets = input.source_target_groups.map((group) => ({
    target_kind: "source_group" as const,
    target_id: group.group_kind,
    label: sourceGroupLabel(group.group_kind),
    reason: sourceGroupReason(group),
    refs: uniqueSorted([...group.source_plan_refs, ...group.source_target_refs, `source_target_group:${group.group_kind}`]),
    action: sourceGroupAction(group)
  }));

  return uniqueNextResearchTargets([...companyTargets, ...leadTargets, ...layerComponentTargets, ...layerMaterialTargets, ...sourceGroupTargets]).slice(0, 24);
}

function targetKindForLead(lead: SupplyChainComponentDependencyLead): AiComputePropagationNextResearchTarget["target_kind"] {
  if (lead.target_id.startsWith("MAT-") || lead.target_kind.includes("material")) return "material_or_process";
  return "component";
}

function sourceGroupLabel(kind: AiComputePropagationSourceTargetGroupKind): string {
  if (kind === "official_evidence") return "Official evidence source group";
  if (kind === "observation_proxy") return "Observation proxy source group";
  if (kind === "entity_or_facility_context") return "Entity or facility context source group";
  return "Lead or manual review source group";
}

function sourceGroupReason(group: AiComputePropagationSourceTargetGroup): string {
  const states = group.states.length === 0 ? "planned" : group.states.join(", ");
  const failures = group.failure_kinds.length === 0 ? "no recorded source failure" : `failures: ${group.failure_kinds.join(", ")}`;
  return `${group.group_kind} has ${group.source_plan_refs.length} source-plan ref(s), ${group.source_target_refs.length} target ref(s), states ${states}, ${failures}.`;
}

function sourceGroupAction(group: AiComputePropagationSourceTargetGroup): string {
  if (group.failure_kinds.length > 0) return "Repair failed or degraded source targets before using this group.";
  if (group.source_target_refs.length > 0) return "Run, sync, or review this source-target group through source-management and review paths.";
  return "Create or sync source targets for this source group before treating it as covered.";
}

function uniqueNextResearchTargets(values: readonly AiComputePropagationNextResearchTarget[]): AiComputePropagationNextResearchTarget[] {
  const byKey = new Map<string, AiComputePropagationNextResearchTarget>();
  for (const value of values) {
    if (value.target_id.trim().length === 0) continue;
    const key = `${value.target_kind}:${value.target_id}`;
    const existing = byKey.get(key);
    byKey.set(key, existing === undefined ? value : mergeNextResearchTarget(existing, value));
  }
  return [...byKey.values()].sort((left, right) => nextResearchTargetSortKey(left).localeCompare(nextResearchTargetSortKey(right)));
}

function mergeNextResearchTarget(
  left: AiComputePropagationNextResearchTarget,
  right: AiComputePropagationNextResearchTarget
): AiComputePropagationNextResearchTarget {
  return {
    ...left,
    refs: uniqueSorted([...left.refs, ...right.refs]),
    reason: left.reason.length >= right.reason.length ? left.reason : right.reason,
    action: left.action.length >= right.action.length ? left.action : right.action
  };
}

function nextResearchTargetSortKey(value: AiComputePropagationNextResearchTarget): string {
  const order = value.target_kind === "company" ? "0" : value.target_kind === "component" ? "1" : value.target_kind === "material_or_process" ? "2" : "3";
  return `${order}:${value.target_id}`;
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
