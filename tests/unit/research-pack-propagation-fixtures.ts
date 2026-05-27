import {
  buildObservationCoverageReport,
  type AiComputePropagationEvidenceLayerKind,
  type ObservationCoverageReport,
  type PropagationReadinessReport
} from "@supplystrata/research-pack";

import { emptyWorkbench } from "./research-pack-fixtures.js";

type PropagationLayer = PropagationReadinessReport["ai_compute_matrix"]["layers"][number];

export function emptyObservationCoverageReport(): ObservationCoverageReport {
  return buildObservationCoverageReport({
    generated_at: "2026-01-01T00:00:00.000Z",
    company_id: "ENT-NVIDIA",
    workbench: { chain_segments: [] },
    company: null,
    components: []
  });
}

export function propagationReadinessWithAiComputeGaps(): PropagationReadinessReport {
  return {
    ...emptyPropagationReadinessReport(),
    ai_compute_matrix: {
      schema_version: "1.0.0",
      matrix_id: "ai_compute_propagation.v0",
      policy: "reasoning_input_only_no_fact_mutation",
      summary: {
        layers_total: 3,
        covered_fact: 1,
        observation_ready: 0,
        official_target_runnable: 1,
        lead_only: 0,
        unknown_open: 0,
        blocked_source: 1,
        layers_with_fact_refs: 1,
        layers_with_observation_refs: 0,
        layers_with_source_targets: 2,
        layers_with_frontier_refs: 0
      },
      layers: [
        {
          layer_id: "demand_to_compute",
          title: "Demand to compute",
          question: "Do we have demand evidence?",
          status: "covered_fact",
          status_reason: "A fact edge anchors this layer.",
          readiness_answers: readinessAnswers({
            factEdgeRefs: ["edge:EDGE-DEMAND"],
            gapCounts: { component_without_l4_l5_fact: 1 },
            unknowns: unknownBacklogSummary(0, 0, {}),
            sourceTargets: sourceTargetStatusSummary({ targets: 0, runnable: 0, blocked: 0, degraded: 0, missingCredentials: 0, sourceFailed: 0 }),
            allowed: ["chain_anchor", "corroboration_review", "strength_freshness_review"],
            prohibited: ["raise_evidence_level_without_review", "close_unknown_without_review"]
          }),
          execution_queue: executionQueue([
            executionQueueItem({
              layerId: "demand_to_compute",
              action: "review_intelligence_context",
              priority: "P2",
              officialEvidenceGapRefs: ["official_evidence_gap:component_without_l4_l5_fact:component:COMP-HBM"]
            })
          ]),
          evidence_layer_summary: [evidenceLayerSummary("fact_edge", 1), evidenceLayerSummary("official_evidence_gap", 1)],
          component_ids: ["COMP-GPU"],
          material_or_process_refs: [],
          fact_edge_refs: ["edge:EDGE-DEMAND"],
          observation_refs: [],
          observation_series_refs: [],
          source_plan_refs: [],
          source_target_refs: [],
          source_target_groups: [],
          source_target_statuses: [],
          source_target_status_summary: sourceTargetStatusSummary({ targets: 0, runnable: 0, blocked: 0, degraded: 0, missingCredentials: 0, sourceFailed: 0 }),
          next_research_targets: [],
          component_dependency_refs: [],
          frontier_refs: [],
          unknown_refs: [],
          unknown_backlog_seeds: [],
          unknown_backlog_summary: unknownBacklogSummary(0, 0, {}),
          official_evidence_gaps: [
            {
              gap_kind: "component_without_l4_l5_fact",
              target_kind: "component",
              target_id: "COMP-HBM",
              label: "HBM",
              reason: "HBM has no visible direct fact edge.",
              refs: ["component:COMP-HBM"],
              recommended_action: "Keep HBM as an open official evidence gap.",
              truth_store_write_policy: "review_only_no_automatic_write"
            }
          ],
          missing_official_evidence: [],
          allowed_research_outputs: ["chain_anchor", "corroboration_review", "strength_freshness_review"],
          prohibited_truth_store_writes: ["raise_evidence_level_without_review", "close_unknown_without_review"],
          next_actions: ["Continue corroboration."],
          policy: "reasoning_input_only_no_fact_mutation"
        },
        {
          layer_id: "construction_to_equipment",
          title: "Construction to semiconductor equipment",
          question: "Can the pack identify equipment delivery or qualification frontier?",
          status: "official_target_runnable",
          status_reason: "A source-plan or source-target path exists.",
          readiness_answers: readinessAnswers({
            gapCounts: { official_source_not_reviewed: 1 },
            unknowns: unknownBacklogSummary(1, 1, { run_source_target: 1 }),
            sourceTargets: sourceTargetStatusSummary({
              targets: 2,
              runnable: 2,
              blocked: 0,
              degraded: 0,
              missingCredentials: 0,
              sourceFailed: 0,
              byState: { not_synced: 1, scheduled: 1 }
            }),
            nextTargetCounts: { source_group: 1 },
            targetRefs: ["source_target:CHK-ASML:scheduled", "source_target:plan:nvidia-memory-2025:census-trade:trade-flow-observation:fixture:not_synced"],
            sourceTargetRefs: {
              runnable: ["source_target:CHK-ASML:scheduled", "source_target:plan:nvidia-memory-2025:census-trade:trade-flow-observation:fixture:not_synced"]
            },
            allowed: ["source_target_action", "review_queue_seed"],
            prohibited: ["create_fact_edge", "raise_evidence_level", "close_unknown", "convert_observation_to_evidence_without_review"]
          }),
          execution_queue: executionQueue([
            executionQueueItem({
              layerId: "construction_to_equipment",
              action: "run_source_target",
              priority: "P1",
              sourceTargetRefs: [
                "source_target:CHK-ASML:scheduled",
                "source_target:plan:nvidia-memory-2025:census-trade:trade-flow-observation:fixture:not_synced"
              ]
            }),
            executionQueueItem({
              layerId: "construction_to_equipment",
              action: "review_intelligence_context",
              priority: "P2",
              officialEvidenceGapRefs: ["official_evidence_gap:official_source_not_reviewed:source_group:official_evidence"],
              nextResearchRefs: ["next_research_target:source_group:official_evidence"]
            }),
            executionQueueItem({
              layerId: "construction_to_equipment",
              action: "keep_unknown_open",
              priority: "P2",
              sourceTargetRefs: ["source_target:CHK-ASML:scheduled"],
              unknownRefs: ["unknown:UNK-EQUIPMENT", "unknown_seed:AI-COMPUTE-UNKNOWN-SEED-CONSTRUCTION-TO-EQUIPMENT"]
            })
          ]),
          evidence_layer_summary: [
            evidenceLayerSummary("unknown", 2),
            evidenceLayerSummary("source_target", 2),
            evidenceLayerSummary("official_evidence_gap", 3)
          ],
          component_ids: ["COMP-SEMICONDUCTOR-EQUIPMENT"],
          material_or_process_refs: [],
          fact_edge_refs: [],
          observation_refs: [],
          observation_series_refs: [],
          source_plan_refs: ["source_plan:asml-ir"],
          source_target_refs: ["source_target:CHK-ASML:scheduled"],
          source_target_groups: [
            {
              group_kind: "official_evidence",
              source_plan_refs: ["source_plan:asml-ir"],
              source_target_refs: ["source_target:CHK-ASML:scheduled"],
              source_adapters: ["asml-ir"],
              target_kinds: ["official-html-disclosure"],
              states: ["scheduled"],
              failure_kinds: []
            },
            {
              group_kind: "observation_proxy",
              source_plan_refs: ["source_plan:census-trade"],
              source_target_refs: ["source_target:plan:nvidia-memory-2025:census-trade:trade-flow-observation:fixture:not_synced"],
              source_adapters: ["census-trade"],
              target_kinds: ["trade-flow-observation"],
              states: ["not_synced"],
              failure_kinds: []
            }
          ],
          source_target_statuses: [
            {
              ref: "source_target:CHK-ASML:scheduled",
              source_adapter_id: "asml-ir",
              target_kind: "official-html-disclosure",
              state: "scheduled",
              failure_kind: null,
              latest_event_type: null
            },
            {
              ref: "source_target:plan:nvidia-memory-2025:census-trade:trade-flow-observation:fixture:not_synced",
              source_adapter_id: "census-trade",
              target_kind: "trade-flow-observation",
              state: "not_synced",
              failure_kind: null,
              latest_event_type: null
            }
          ],
          source_target_status_summary: sourceTargetStatusSummary({
            targets: 2,
            runnable: 2,
            blocked: 0,
            degraded: 0,
            missingCredentials: 0,
            sourceFailed: 0,
            byState: { not_synced: 1, scheduled: 1 }
          }),
          next_research_targets: [
            {
              target_kind: "source_group",
              target_id: "official_evidence",
              label: "Official evidence source group",
              reason: "official evidence source path is scheduled.",
              refs: ["source_plan:asml-ir", "source_target:CHK-ASML:scheduled", "source_target_group:official_evidence"],
              action: "Run this source target through review paths."
            }
          ],
          component_dependency_refs: [],
          frontier_refs: [],
          unknown_refs: ["unknown:UNK-EQUIPMENT"],
          unknown_backlog_seeds: [
            {
              seed_id: "AI-COMPUTE-UNKNOWN-SEED-CONSTRUCTION-TO-EQUIPMENT",
              question:
                "Which reviewed citation from the planned official source can answer: Can the pack identify equipment delivery or qualification frontier?",
              why_unknown: "A source path exists, but no reviewed citation has been accepted into the evidence layer yet.",
              target_scope_refs: ["component:COMP-SEMICONDUCTOR-EQUIPMENT"],
              existing_unknown_refs: ["unknown:UNK-EQUIPMENT"],
              source_plan_refs: ["source_plan:asml-ir"],
              source_target_refs: ["source_target:CHK-ASML:scheduled"],
              recommended_review_action: "run_source_target",
              truth_store_write_policy: "review_only_no_automatic_write"
            }
          ],
          unknown_backlog_summary: unknownBacklogSummary(1, 1, { run_source_target: 1 }),
          official_evidence_gaps: [
            {
              gap_kind: "official_source_not_reviewed",
              target_kind: "source_group",
              target_id: "official_evidence",
              label: "Official evidence source group",
              reason: "official evidence source path is scheduled.",
              refs: ["source_plan:asml-ir", "source_target:CHK-ASML:scheduled", "source_target_group:official_evidence"],
              recommended_action: "Run this source target through review paths.",
              truth_store_write_policy: "review_only_no_automatic_write"
            }
          ],
          missing_official_evidence: [
            "Run or sync the listed official source targets, then review extracted citations through the existing review/apply path."
          ],
          allowed_research_outputs: ["source_target_action", "review_queue_seed"],
          prohibited_truth_store_writes: ["create_fact_edge", "raise_evidence_level", "close_unknown", "convert_observation_to_evidence_without_review"],
          next_actions: ["Sync/enable/run the listed source targets, then review outputs through controlled paths."],
          policy: "reasoning_input_only_no_fact_mutation"
        },
        {
          layer_id: "equipment_to_process_inputs",
          title: "Equipment to process inputs",
          question: "Can the pack name process consumables?",
          status: "blocked_source",
          status_reason: "A matching source target exists but is blocked by missing_credentials.",
          readiness_answers: readinessAnswers({
            gapCounts: { official_source_blocked: 1 },
            unknowns: unknownBacklogSummary(0, 1, { repair_source_target: 1 }),
            sourceTargets: sourceTargetStatusSummary({
              targets: 1,
              runnable: 0,
              blocked: 1,
              degraded: 0,
              missingCredentials: 1,
              sourceFailed: 0,
              byState: { retry_wait: 1 },
              byFailureKind: { missing_credentials: 1 }
            }),
            nextTargetCounts: { source_group: 1 },
            targetRefs: ["source_target:CHK-MATERIALS:retry_wait"],
            sourceTargetRefs: {
              blocked: ["source_target:CHK-MATERIALS:retry_wait"],
              missingCredentials: ["source_target:CHK-MATERIALS:retry_wait"]
            },
            allowed: ["source_repair_action", "operational_backlog"],
            prohibited: ["create_fact_edge", "raise_evidence_level", "close_unknown", "convert_observation_to_evidence_without_review"]
          }),
          execution_queue: executionQueue([
            executionQueueItem({
              layerId: "equipment_to_process_inputs",
              action: "repair_source_target",
              priority: "P1",
              sourceTargetRefs: ["source_target:CHK-MATERIALS:retry_wait"],
              repairReason: "failure_kind=missing_credentials; state=retry_wait"
            }),
            executionQueueItem({
              layerId: "equipment_to_process_inputs",
              action: "review_intelligence_context",
              priority: "P1",
              officialEvidenceGapRefs: ["official_evidence_gap:official_source_blocked:source_group:official_evidence"],
              nextResearchRefs: ["next_research_target:source_group:official_evidence"]
            }),
            executionQueueItem({
              layerId: "equipment_to_process_inputs",
              action: "keep_unknown_open",
              priority: "P2",
              sourceTargetRefs: ["source_target:CHK-MATERIALS:retry_wait"],
              unknownRefs: ["unknown_seed:AI-COMPUTE-UNKNOWN-SEED-EQUIPMENT-TO-PROCESS-INPUTS"]
            })
          ]),
          evidence_layer_summary: [
            evidenceLayerSummary("unknown", 1),
            evidenceLayerSummary("source_target", 1),
            evidenceLayerSummary("official_evidence_gap", 2)
          ],
          component_ids: ["COMP-PHOTORESIST"],
          material_or_process_refs: [],
          fact_edge_refs: [],
          observation_refs: [],
          observation_series_refs: [],
          source_plan_refs: [],
          source_target_refs: ["source_target:CHK-MATERIALS:retry_wait"],
          source_target_groups: [
            {
              group_kind: "official_evidence",
              source_plan_refs: [],
              source_target_refs: ["source_target:CHK-MATERIALS:retry_wait"],
              source_adapters: ["materials-ir"],
              target_kinds: ["official-html-disclosure"],
              states: ["retry_wait"],
              failure_kinds: ["missing_credentials"]
            }
          ],
          source_target_statuses: [
            {
              ref: "source_target:CHK-MATERIALS:retry_wait",
              source_adapter_id: "materials-ir",
              target_kind: "official-html-disclosure",
              state: "retry_wait",
              failure_kind: "missing_credentials",
              latest_event_type: null
            }
          ],
          source_target_status_summary: sourceTargetStatusSummary({
            targets: 1,
            runnable: 0,
            blocked: 1,
            degraded: 0,
            missingCredentials: 1,
            sourceFailed: 0,
            byState: { retry_wait: 1 },
            byFailureKind: { missing_credentials: 1 }
          }),
          next_research_targets: [
            {
              target_kind: "source_group",
              target_id: "official_evidence",
              label: "Official evidence source group",
              reason: "official evidence source path is blocked by missing credentials.",
              refs: ["source_target:CHK-MATERIALS:retry_wait", "source_target_group:official_evidence"],
              action: "Repair failed or degraded source targets before using this group."
            }
          ],
          component_dependency_refs: [],
          frontier_refs: [],
          unknown_refs: [],
          unknown_backlog_seeds: [
            {
              seed_id: "AI-COMPUTE-UNKNOWN-SEED-EQUIPMENT-TO-PROCESS-INPUTS",
              question: "Which official source target must be repaired before the Equipment to process inputs layer can be researched?",
              why_unknown: "A relevant source target exists, but its current operational state prevents evidence collection.",
              target_scope_refs: ["component:COMP-PHOTORESIST"],
              existing_unknown_refs: [],
              source_plan_refs: [],
              source_target_refs: ["source_target:CHK-MATERIALS:retry_wait"],
              recommended_review_action: "repair_source_target",
              truth_store_write_policy: "review_only_no_automatic_write"
            }
          ],
          unknown_backlog_summary: unknownBacklogSummary(0, 1, { repair_source_target: 1 }),
          official_evidence_gaps: [
            {
              gap_kind: "official_source_blocked",
              target_kind: "source_group",
              target_id: "official_evidence",
              label: "Official evidence source group",
              reason: "official evidence source path is blocked by missing credentials.",
              refs: ["source_target:CHK-MATERIALS:retry_wait", "source_target_group:official_evidence"],
              recommended_action: "Repair failed or degraded source targets before using this group.",
              truth_store_write_policy: "review_only_no_automatic_write"
            }
          ],
          missing_official_evidence: ["Repair the blocked/degraded official source target and rerun it before relying on this layer."],
          allowed_research_outputs: ["source_repair_action", "operational_backlog"],
          prohibited_truth_store_writes: ["create_fact_edge", "raise_evidence_level", "close_unknown", "convert_observation_to_evidence_without_review"],
          next_actions: ["Inspect source target failure/degradation before relying on this layer."],
          policy: "reasoning_input_only_no_fact_mutation"
        }
      ]
    }
  };
}

function emptyPropagationReadinessReport(): PropagationReadinessReport {
  return {
    schema_version: "1.0.0",
    generated_at: "2026-01-01T00:00:00.000Z",
    company_id: "ENT-NVIDIA",
    summary: {
      contexts_total: 0,
      ready: 0,
      partial: 0,
      blocked: 0,
      contexts_with_observations: 0,
      contexts_with_source_plan: 0,
      contexts_with_component_leads: 0,
      reasoning_inputs: 0,
      no_fact_mutation_policy: "reasoning_input_only_no_fact_mutation"
    },
    ai_compute_matrix: {
      schema_version: "1.0.0",
      matrix_id: "ai_compute_propagation.v0",
      policy: "reasoning_input_only_no_fact_mutation",
      summary: {
        layers_total: 0,
        covered_fact: 0,
        observation_ready: 0,
        official_target_runnable: 0,
        lead_only: 0,
        unknown_open: 0,
        blocked_source: 0,
        layers_with_fact_refs: 0,
        layers_with_observation_refs: 0,
        layers_with_source_targets: 0,
        layers_with_frontier_refs: 0
      },
      layers: []
    },
    items: []
  };
}

function evidenceLayerSummary(layerKind: AiComputePropagationEvidenceLayerKind, count: number): PropagationLayer["evidence_layer_summary"][number] {
  return {
    layer_kind: layerKind,
    count,
    refs: [],
    interpretation: `${layerKind} fixture summary`,
    allowed_research_outputs: ["reasoning_input"],
    prohibited_truth_store_writes: ["create_fact_edge"]
  };
}

function sourceTargetStatusSummary(input: {
  targets: number;
  runnable: number;
  blocked: number;
  degraded: number;
  missingCredentials: number;
  sourceFailed: number;
  byState?: Record<string, number>;
  byFailureKind?: Record<string, number>;
}): PropagationLayer["source_target_status_summary"] {
  return {
    targets: input.targets,
    runnable_targets: input.runnable,
    blocked_targets: input.blocked,
    degraded_targets: input.degraded,
    missing_credentials: input.missingCredentials,
    source_failed_targets: input.sourceFailed,
    by_state: input.byState ?? {},
    by_failure_kind: input.byFailureKind ?? {}
  };
}

function unknownBacklogSummary(existingUnknowns: number, seeds: number, byAction: Record<string, number>): PropagationLayer["unknown_backlog_summary"] {
  return {
    existing_unknowns: existingUnknowns,
    seeds,
    by_recommended_review_action: byAction,
    target_scope_refs: [],
    source_target_refs: [],
    truth_store_write_policy: "review_only_no_automatic_write"
  };
}

function executionQueue(items: PropagationLayer["execution_queue"]["items"]): PropagationLayer["execution_queue"] {
  return {
    schema_version: "1.0.0",
    summary: {
      items: items.length,
      run_source_target: items.filter((item) => item.action === "run_source_target").length,
      repair_source_target: items.filter((item) => item.action === "repair_source_target").length,
      review_intelligence_context: items.filter((item) => item.action === "review_intelligence_context").length,
      keep_unknown_open: items.filter((item) => item.action === "keep_unknown_open").length,
      p0: items.filter((item) => item.priority === "P0").length,
      p1: items.filter((item) => item.priority === "P1").length,
      p2: items.filter((item) => item.priority === "P2").length,
      runnable_source_targets: uniqueSorted(items.filter((item) => item.action === "run_source_target").flatMap((item) => item.source_target_refs)).length,
      blocked_source_targets: uniqueSorted(items.filter((item) => item.action === "repair_source_target").flatMap((item) => item.source_target_refs)).length,
      unknown_refs: uniqueSorted(items.flatMap((item) => item.unknown_refs)).length
    },
    items
  };
}

function executionQueueItem(input: {
  layerId: string;
  action: PropagationLayer["execution_queue"]["items"][number]["action"];
  priority: PropagationLayer["execution_queue"]["items"][number]["priority"];
  sourceTargetRefs?: string[];
  officialEvidenceGapRefs?: string[];
  unknownRefs?: string[];
  nextResearchRefs?: string[];
  repairReason?: string | null;
}): PropagationLayer["execution_queue"]["items"][number] {
  return {
    queue_item_id: `ai-compute:${input.layerId}:${input.action}`,
    action: input.action,
    priority: input.priority,
    title: `${input.action} ${input.layerId}`,
    reason: `${input.action} fixture reason`,
    source_target_refs: input.sourceTargetRefs ?? [],
    official_evidence_gap_refs: input.officialEvidenceGapRefs ?? [],
    unknown_refs: input.unknownRefs ?? [],
    next_research_refs: input.nextResearchRefs ?? [],
    source_target_actions: (input.sourceTargetRefs ?? []).map((ref) => sourceTargetAction(input.action, ref)),
    repair_reason: input.repairReason ?? null,
    truth_store_write_policy: "review_only_no_automatic_write",
    automatic_fact_mutation_allowed: false
  };
}

function sourceTargetAction(
  action: PropagationLayer["execution_queue"]["items"][number]["action"],
  ref: string
): PropagationLayer["execution_queue"]["items"][number]["source_target_actions"][number] {
  const checkTargetId = checkTargetIdFromSourceTargetRef(ref);
  return {
    source_target_ref: ref,
    check_target_id: checkTargetId,
    source_adapter_id: "fixture-source",
    target_kind: "fixture-target",
    state: sourceTargetStateFromRef(ref),
    failure_kind: action === "repair_source_target" ? "missing_credentials" : null,
    latest_event_type: null,
    recommended_cli_command:
      checkTargetId === null
        ? null
        : action === "run_source_target"
          ? `pnpm --silent cli sources run-due --check-target-id ${checkTargetId} --format markdown`
          : action === "repair_source_target"
            ? `pnpm --silent cli sources due --check-target-id ${checkTargetId} --format markdown`
            : null,
    writes_truth_store: action === "run_source_target",
    requires_database: true
  };
}

function sourceTargetStateFromRef(ref: string): string | null {
  if (ref.endsWith(":not_synced")) return "not_synced";
  if (ref.endsWith(":due")) return "due";
  if (ref.endsWith(":scheduled")) return "scheduled";
  if (ref.endsWith(":succeeded")) return "succeeded";
  if (ref.endsWith(":retry_wait")) return "retry_wait";
  if (ref.endsWith(":degraded")) return "degraded";
  if (ref.endsWith(":dead")) return "dead";
  if (ref.endsWith(":source_failed")) return "source_failed";
  return null;
}

function checkTargetIdFromSourceTargetRef(ref: string): string | null {
  if (!ref.startsWith("source_target:")) return null;
  const body = ref.slice("source_target:".length);
  const lastSeparator = body.lastIndexOf(":");
  if (lastSeparator <= 0) return body.length === 0 ? null : body;
  return body.slice(0, lastSeparator);
}

function readinessAnswers(input: {
  factEdgeRefs?: string[];
  gapCounts: Record<string, number>;
  unknowns: PropagationLayer["unknown_backlog_summary"];
  sourceTargets: PropagationLayer["source_target_status_summary"];
  nextTargetCounts?: Record<string, number>;
  targetRefs?: string[];
  sourceTargetRefs?: {
    runnable?: string[];
    blocked?: string[];
    degraded?: string[];
    missingCredentials?: string[];
    sourceFailed?: string[];
  };
  allowed: string[];
  prohibited: string[];
}): PropagationLayer["readiness_answers"] {
  return {
    fact_edges: { count: input.factEdgeRefs?.length ?? 0, refs: input.factEdgeRefs ?? [] },
    non_fact_inputs: { observation_refs: [], lead_refs: [] },
    official_evidence: {
      gaps: Object.values(input.gapCounts).reduce((sum, count) => sum + count, 0),
      by_gap_kind: input.gapCounts
    },
    unknowns: input.unknowns,
    next_research: { by_target_kind: input.nextTargetCounts ?? {}, target_refs: input.targetRefs ?? [] },
    source_targets: {
      ...input.sourceTargets,
      runnable_refs: input.sourceTargetRefs?.runnable ?? [],
      blocked_refs: input.sourceTargetRefs?.blocked ?? [],
      degraded_refs: input.sourceTargetRefs?.degraded ?? [],
      missing_credentials_refs: input.sourceTargetRefs?.missingCredentials ?? [],
      source_failed_refs: input.sourceTargetRefs?.sourceFailed ?? []
    },
    output_policy: {
      allowed_research_outputs: input.allowed,
      prohibited_truth_store_writes: input.prohibited,
      truth_store_write_policy: "reasoning_input_only_no_fact_mutation"
    }
  };
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
