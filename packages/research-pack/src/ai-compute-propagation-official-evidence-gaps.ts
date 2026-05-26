import type {
  AiComputePropagationLayerStatus,
  AiComputePropagationOfficialEvidenceGap,
  AiComputePropagationSourceTargetGroup
} from "./ai-compute-propagation-readiness-definitions.js";

export interface BuildAiComputePropagationOfficialEvidenceGapsInput {
  layer_id: string;
  status: AiComputePropagationLayerStatus;
  component_ids: readonly string[];
  material_or_process_refs: readonly string[];
  fact_component_ids: readonly string[];
  observation_refs: readonly string[];
  observation_series_refs: readonly string[];
  source_target_groups: readonly AiComputePropagationSourceTargetGroup[];
}

export function buildAiComputePropagationOfficialEvidenceGaps(
  input: BuildAiComputePropagationOfficialEvidenceGapsInput
): AiComputePropagationOfficialEvidenceGap[] {
  const factComponents = new Set(input.fact_component_ids);
  return uniqueOfficialEvidenceGaps([
    ...input.component_ids.filter((componentId) => !factComponents.has(componentId)).map((componentId) => componentGap(componentId)),
    ...input.material_or_process_refs.map(materialOrProcessGap),
    ...officialSourceGroupGaps(input.source_target_groups, input.status),
    ...observationOnlyGaps(input)
  ]);
}

function componentGap(componentId: string): AiComputePropagationOfficialEvidenceGap {
  return {
    gap_kind: "component_without_l4_l5_fact",
    target_kind: "component",
    target_id: componentId,
    label: componentId,
    reason: "This propagation component has no visible Level 4/5 fact edge in the current research pack.",
    refs: [`component:${componentId}`],
    recommended_action: "Find or create an official source target, then review accepted citations before creating any fact edge.",
    truth_store_write_policy: "review_only_no_automatic_write"
  };
}

function materialOrProcessGap(ref: string): AiComputePropagationOfficialEvidenceGap {
  return {
    gap_kind: "material_or_process_without_l4_l5_fact",
    target_kind: "material_or_process",
    target_id: ref,
    label: ref,
    reason: "This material or process target has no reviewed official evidence tying it into the fact graph.",
    refs: [`material_or_process:${ref}`],
    recommended_action: "Use material/process observations as context and keep official company or facility evidence separate until reviewed.",
    truth_store_write_policy: "review_only_no_automatic_write"
  };
}

function officialSourceGroupGaps(
  groups: readonly AiComputePropagationSourceTargetGroup[],
  status: AiComputePropagationLayerStatus
): AiComputePropagationOfficialEvidenceGap[] {
  const officialGroup = groups.find((group) => group.group_kind === "official_evidence");
  if (officialGroup === undefined) return [];
  if (status === "covered_fact") return [];
  if (officialGroup.failure_kinds.length > 0) {
    return [
      {
        gap_kind: "official_source_blocked",
        target_kind: "source_group",
        target_id: "official_evidence",
        label: "Official evidence source group",
        reason: `Official evidence source targets are blocked by ${officialGroup.failure_kinds.join(", ")}.`,
        refs: officialSourceGroupRefs(officialGroup),
        recommended_action: "Repair the blocked official source target before relying on this propagation layer.",
        truth_store_write_policy: "review_only_no_automatic_write"
      }
    ];
  }
  return [
    {
      gap_kind: "official_source_not_reviewed",
      target_kind: "source_group",
      target_id: "official_evidence",
      label: "Official evidence source group",
      reason: "An official source path exists, but no reviewed citation has been accepted for this layer yet.",
      refs: officialSourceGroupRefs(officialGroup),
      recommended_action: "Run or sync the official source targets and route extracted citations through review/apply.",
      truth_store_write_policy: "review_only_no_automatic_write"
    }
  ];
}

function observationOnlyGaps(input: BuildAiComputePropagationOfficialEvidenceGapsInput): AiComputePropagationOfficialEvidenceGap[] {
  if (input.status !== "observation_ready") return [];
  const refs = uniqueSorted([...input.observation_refs, ...input.observation_series_refs]);
  if (refs.length === 0) return [];
  return [
    {
      gap_kind: "observation_only",
      target_kind: "layer",
      target_id: input.layer_id,
      label: input.layer_id,
      reason: "Observation context exists, but it is not official evidence and must not become a fact edge by itself.",
      refs,
      recommended_action: "Keep observations as reasoning input and seek official evidence through review-controlled paths.",
      truth_store_write_policy: "review_only_no_automatic_write"
    }
  ];
}

function officialSourceGroupRefs(group: AiComputePropagationSourceTargetGroup): string[] {
  return uniqueSorted([...group.source_plan_refs, ...group.source_target_refs, "source_target_group:official_evidence"]);
}

function uniqueOfficialEvidenceGaps(values: readonly AiComputePropagationOfficialEvidenceGap[]): AiComputePropagationOfficialEvidenceGap[] {
  const byKey = new Map<string, AiComputePropagationOfficialEvidenceGap>();
  for (const value of values) {
    const key = `${value.gap_kind}:${value.target_kind}:${value.target_id}`;
    const existing = byKey.get(key);
    byKey.set(key, existing === undefined ? value : { ...existing, refs: uniqueSorted([...existing.refs, ...value.refs]) });
  }
  return [...byKey.values()].sort((left, right) => gapSortKey(left).localeCompare(gapSortKey(right)));
}

function gapSortKey(value: AiComputePropagationOfficialEvidenceGap): string {
  const targetOrder =
    value.target_kind === "component" ? "0" : value.target_kind === "material_or_process" ? "1" : value.target_kind === "source_group" ? "2" : "3";
  return `${targetOrder}:${value.target_id}:${value.gap_kind}`;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort((left, right) => left.localeCompare(right));
}
