import { CORROBORATION_SOURCE_PLAN_ACTION_BATCHES, GATE1_DATA_DEPTH_ACTION_BATCHES } from "@supplystrata/research-pack";
import type { ChainViewSegmentModel } from "@supplystrata/chain-view";
import type { WorkbenchModel } from "@supplystrata/workbench-export";
import type { ObservationCoverageObservation, QuestionReadinessMatrix, SourceTargetCoverageReport } from "@supplystrata/research-pack";
import type { SourcePlanItem } from "@supplystrata/source-plan";

export function edgeSegmentFixture(
  edgeId: string,
  depth: number,
  fromId: string,
  fromName: string,
  toId: string,
  toName: string,
  componentId: string | null
): ChainViewSegmentModel {
  return {
    sequence_index: depth,
    depth,
    semantic_layer: "edge",
    from: { kind: "company", id: fromId, name: fromName },
    to: { kind: "company", id: toId, name: toName },
    relation: "BUYS_FROM",
    component: componentId,
    component_id: componentId,
    edge_id: edgeId,
    evidence_ids: [`EV-${edgeId}`],
    evidence_level: 5,
    confidence: 0.95,
    label: `${fromName} buys from ${toName}`
  };
}

export function edgeFixture(
  edgeId: string,
  fromId: string,
  fromName: string,
  toId: string,
  toName: string,
  componentId: string | null
): WorkbenchModel["edges"][number] {
  return {
    edge_id: edgeId,
    from_id: fromId,
    from_name: fromName,
    to_id: toId,
    to_name: toName,
    relation: "BUYS_FROM",
    component: componentId,
    component_id: componentId,
    evidence_level: 5,
    confidence: 0.95,
    evidence_ids: [`EV-${edgeId}`]
  };
}

export function actionBatchDefinition(kind: "smoke" | "sync" | "enable" | "run_due") {
  const definition = CORROBORATION_SOURCE_PLAN_ACTION_BATCHES.find((item) => item.kind === kind);
  if (definition === undefined) throw new Error(`Missing action batch definition: ${kind}`);
  return definition;
}

export function gate1DataDepthActionBatchDefinition(kind: (typeof GATE1_DATA_DEPTH_ACTION_BATCHES)[number]["kind"]) {
  const definition = GATE1_DATA_DEPTH_ACTION_BATCHES.find((item) => item.kind === kind);
  if (definition === undefined) throw new Error(`Missing Gate 1 data-depth action batch definition: ${kind}`);
  return definition;
}

export function officialSourcePlanItem(): SourcePlanItem {
  return {
    source_id: "samsung-ir",
    source_name: "Samsung Electronics Investor Relations",
    purpose: "official_disclosure",
    priority: "P0",
    status: "preview",
    automation: "allowed",
    requires_key: false,
    expected_output_layer: "edge",
    relation_policy: "can_create_fact_edge",
    parent_component_ids: ["COMP-MEMORY"],
    target_ids: ["COMP-DRAM"],
    trigger_dependency_ids: ["CDEP-MEMORY-DRAM"],
    reasons: ["Samsung IR can disclose memory supplier context."],
    suggested_check_targets: [
      {
        source_adapter_id: "samsung-ir",
        target_kind: "official-html-disclosure",
        runnable: true,
        target_config: { entity_id: "ENT-SAMSUNG-ELECTRONICS", year: 2025 },
        reason: "Samsung IR has a registered official disclosure connector for 2025."
      }
    ]
  };
}

export function commoditySourcePlanItem(): SourcePlanItem {
  return {
    source_id: "worldbank-pink",
    source_name: "World Bank Pink Sheet",
    purpose: "commodity",
    priority: "P1",
    status: "preview",
    automation: "allowed",
    requires_key: false,
    expected_output_layer: "observation",
    relation_policy: "observation_only",
    parent_component_ids: ["COMP-WAFER"],
    target_ids: ["MAT-COPPER"],
    trigger_dependency_ids: ["material-taxonomy:COMP-WAFER:MAT-COPPER"],
    reasons: ["Copper price is material context only; it cannot prove company-level sourcing."],
    suggested_check_targets: [
      {
        source_adapter_id: "worldbank-pink",
        target_kind: "commodity-price-observation",
        runnable: true,
        target_config: { commodity: "copper", material_id: "MAT-COPPER", month: "2025-12" },
        reason: "World Bank Pink Sheet can provide copper price context."
      }
    ]
  };
}

export function officialSourceTargetCoverage(state: SourceTargetCoverageReport["items"][number]["state"]): SourceTargetCoverageReport {
  return {
    schema_version: "1.0.0",
    generated_at: "2026-01-01T00:00:00.000Z",
    company_id: "ENT-NVIDIA",
    namespace: "nvidia-memory-2025",
    summary: {
      expected_targets: 1,
      synced_targets: 1,
      not_synced: 0,
      enabled_targets: state === "disabled" ? 0 : 1,
      due_targets: state === "due" ? 1 : 0,
      active_jobs: 0,
      retry_wait: 0,
      degraded_targets: state === "degraded" ? 1 : 0,
      dead_targets: 0,
      source_failed_targets: 0,
      source_failure_kinds: {
        missing_credentials: 0,
        target_config_invalid: 0,
        source_unreachable: 0,
        source_response_error: 0,
        rate_limited: 0,
        adapter_error: 0,
        unknown_failure: 0
      },
      targets_with_observations: 0,
      total_observations: 0,
      observed_subject_entities: 0,
      observations_by_source: {},
      observations_by_target_kind: {},
      observations_by_metric: {}
    },
    observation_review: emptySourceTargetObservationReview(),
    items: [
      {
        expected_target: {
          check_target_id: "plan:nvidia-memory-2025:samsung-ir:official-html-disclosure:0a2adc4a3479a3f6",
          source_adapter_id: "samsung-ir",
          target_kind: "official-html-disclosure",
          enabled: true,
          target_config: { entity_id: "ENT-SAMSUNG-ELECTRONICS", year: 2025 }
        },
        synced: true,
        match_kind: "check_target_id",
        matched_check_target_id: "plan:nvidia-memory-2025:samsung-ir:official-html-disclosure:0a2adc4a3479a3f6",
        state,
        target_enabled: state !== "disabled",
        policy_enabled: true,
        next_check_at: state === "due" ? "2025-12-31T00:00:00.000Z" : null,
        effective_check_cadence_minutes: 10080,
        effective_jitter_minutes: 120,
        latest_job: null,
        latest_event: null,
        observations: 0,
        observations_by_metric: {},
        observation_samples: [],
        latest_observation_at: null
      }
    ]
  };
}

function emptySourceTargetObservationReview(): SourceTargetCoverageReport["observation_review"] {
  return {
    summary: {
      review_items: 0,
      calibration_candidates: 0,
      labeled_calibration_candidates: 0,
      unlabeled_calibration_candidates: 0,
      next_labeling_batch_candidates: 0,
      p0: 0,
      p1: 0,
      p2: 0,
      by_category: {
        supply_chain_signal: 0,
        financial_context: 0,
        metric_mapping_gap: 0
      },
      by_recommended_label: {
        useful_signal: 0,
        background_context: 0,
        needs_context: 0,
        not_useful: 0
      },
      by_persisted_label: {
        useful_signal: 0,
        background_context: 0,
        needs_context: 0,
        not_useful: 0
      },
      next_labeling_batch_by_priority: { P0: 0, P1: 0, P2: 0 },
      next_labeling_batch_by_metric: {}
    },
    items: [],
    calibration_candidates: [],
    labeling_plan: {
      strategy: "stratified_unlabeled_by_priority_metric",
      review_policy: "review_only_no_fact_mutation",
      batch_size: 12,
      candidates: []
    }
  };
}

export function emptyWorkbench(): WorkbenchModel {
  return {
    schema_version: "1.0.0",
    generated_at: "2026-01-01T00:00:00.000Z",
    selected_company_id: "ENT-NVIDIA",
    companies: [],
    chain: {
      schema_version: "1.0.0",
      view_type: "company_chain",
      root: { kind: "company", id: "ENT-NVIDIA", name: "NVIDIA" },
      max_depth: 1,
      generated_by: "test",
      segments: [],
      stats: { fact_edges: 0, claims: 0, observations: 0, leads: 0, unknowns: 0 }
    },
    chain_segments: [],
    edges: [],
    upstream_edges: [],
    downstream_edges: [],
    claims: [],
    draft_claims: [],
    evidences: [],
    unknown_items: [],
    sources: [],
    source_plan: [],
    changes: [],
    attention_queue: [],
    review_queue: [],
    intelligence: { edge_strengths: [], edge_freshness: [] }
  };
}

export function readyQuestionReadiness(): QuestionReadinessMatrix {
  return {
    schema_version: "1.0.0",
    generated_at: "2026-01-01T00:00:00.000Z",
    company_id: "ENT-NVIDIA",
    summary: { ready: 1, partial: 0, blocked: 0 },
    items: [
      {
        question_id: "company.upstream_dependencies",
        question: "一级供应商是否可审计？",
        status: "ready",
        confidence: 0.7,
        ready_signals: ["fixture"],
        missing_requirements: [],
        supporting_refs: [],
        unknown_ids: []
      }
    ]
  };
}

export function observationFixture(
  observationId: string,
  observationType: ObservationCoverageObservation["observation_type"],
  overrides: Partial<ObservationCoverageObservation> = {}
): ObservationCoverageObservation {
  return {
    observation_id: observationId,
    observation_type: observationType,
    source_adapter_id: "fixture",
    source_item_id: null,
    doc_id: null,
    scope_kind: "company",
    scope_id: "ENT-NVIDIA",
    geography_kind: null,
    geography_id: null,
    component_id: null,
    metric_name: "fixture_metric",
    metric_value: null,
    metric_unit: null,
    time_window_start: null,
    time_window_end: null,
    baseline_value: null,
    change_percent: null,
    confidence: 0.8,
    anomaly: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

export function evidenceFixture(evidenceId: string, overrides: Partial<WorkbenchModel["evidences"][number]> = {}): WorkbenchModel["evidences"][number] {
  return {
    evidence_id: evidenceId,
    edge_id: null,
    superseded_by: null,
    cite_text: "NVIDIA depends on third-party suppliers for memory.",
    cite_locator: "10-K",
    cite_start_char: 10,
    cite_end_char: 68,
    cite_text_sha256: null,
    normalized_cite_text_sha256: null,
    source_snapshot_sha256: null,
    parser_version: "fixture",
    extractor_version: "fixture",
    relation_candidate_hash: "fixture",
    evidence_level: 5,
    confidence: 0.95,
    is_inferred: false,
    extraction_method: "rule",
    source_url: "https://example.com/source",
    source_date: "2025-01-01T00:00:00.000Z",
    fetched_at: "2026-01-01T00:00:00.000Z",
    source_adapter_id: "fixture",
    document_type: "10-K",
    subject_name: "NVIDIA",
    object_name: "Micron",
    relation: "BUYS_FROM",
    ...overrides
  };
}
