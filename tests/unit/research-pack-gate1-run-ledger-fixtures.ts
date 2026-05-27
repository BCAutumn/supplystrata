import type {
  CorroborationSourcePlan,
  Gate1EntityAffiliationContext,
  OfficialDisclosureReadinessReport,
  SourceTargetCoverageReport,
  SourceTargetPreflightReport,
  SupplyChainExpansionPlan
} from "@supplystrata/research-pack";

export function officialDisclosureReadinessFixture(): OfficialDisclosureReadinessReport {
  return {
    schema_version: "1.0.0",
    generated_at: "2026-01-01T00:00:00.000Z",
    company_id: "ENT-NVIDIA",
    target_profile: {
      profile_id: "ai-compute-memory.v0",
      title: "AI compute / memory baseline",
      version: "0.1.0",
      description: "fixture",
      selection_reason: "fixture"
    },
    targets: { core_nodes: 25, level_4_5_fact_edges: 100, corroboration_ratio: 0.7 },
    scorecard: {
      scorecard_id: "gate_1_official_disclosure",
      status: "partial",
      overall_progress: 0.4,
      data_progress: 0.3,
      source_path_progress: 0.7,
      criteria: [
        criterion("core_node_official_coverage", "completion", 10, 25),
        criterion("level_4_5_fact_edge_coverage", "completion", 1, 100),
        criterion("corroboration_or_disposition_coverage", "completion", 0, 0.7),
        criterion("fact_edge_traceability", "completion", 1, 1),
        criterion("expected_source_path_coverage", "operability", 8, 10)
      ],
      next_actions: ["fixture"]
    },
    summary: {
      visible_research_nodes: 10,
      target_research_nodes: 25,
      company_nodes: 2,
      component_nodes: 1,
      nodes_with_fact_edges: 2,
      target_nodes_with_fact_edges: 2,
      nodes_with_official_source_plan: 8,
      target_nodes_with_official_source_plan: 8,
      nodes_with_runnable_official_targets: 8,
      target_nodes_with_runnable_official_targets: 8,
      nodes_with_official_observations: 0,
      target_nodes_with_official_observations: 0,
      nodes_missing_official_coverage: 0,
      target_nodes_missing_official_coverage: 0,
      level_4_5_fact_edges: 1,
      traceable_edges: 1,
      partial_traceability_edges: 0,
      missing_traceability_edges: 0,
      cross_source_edges: 0,
      single_source_edges: 1,
      missing_evidence_edges: 0,
      corroboration_ratio: 0,
      corroboration_or_disposition_edges: 0,
      corroboration_or_disposition_ratio: 0,
      corroboration_queue_items: 1,
      corroboration_queue_with_runnable_targets: 1,
      corroboration_queue_needing_disposition: 1,
      corroboration_queue_with_recorded_disposition: 0,
      corroboration_queue_proposed_unknowns: 1,
      edges_with_strength: 0,
      edges_with_freshness: 1,
      edges_missing_strength: 1,
      edges_missing_freshness: 0,
      explicit_unknowns: 0,
      official_source_plan_items: 2,
      expected_official_source_links: 10,
      expected_official_source_links_with_coverage: 8,
      expected_official_source_links_runnable: 8,
      expected_official_source_links_connector_available: 2,
      expected_official_source_links_unimplemented: 0,
      expected_official_source_links_missing: 0,
      runnable_official_targets: 8,
      synced_official_targets: 0,
      due_official_targets: 0,
      degraded_official_targets: 0,
      official_targets_with_observations: 0,
      official_disclosure_signal_review_candidates: 1,
      open_official_disclosure_signal_review_candidates: 1,
      official_disclosure_signal_dispositions: 0,
      official_disclosure_signal_correlation_hints: 1,
      open_official_disclosure_signal_correlation_hints: 1
    },
    gates: [],
    nodes: [],
    profile_expansion_candidates: [],
    expected_source_coverage: [],
    official_disclosure_signals: [],
    edge_corroboration_dispositions: [],
    official_disclosure_signal_correlation_hints: [
      {
        review_id: "REV-1",
        edge_id: "EDGE-1",
        status: "pending",
        source_adapter_id: "samsung-ir",
        signal_title: "Samsung memory disclosure",
        edge_summary: "NVIDIA -> Samsung Memory (COMP-MEMORY)",
        disposition: "needs_explicit_single_source_disposition",
        relevance_score: 0.8,
        match_reasons: ["signal_mentions_to_company"],
        disposition_status: "open",
        recorded_decision: null,
        review_policy: "review_only_no_fact_mutation",
        action: "Review the signal without mutating the fact edge."
      }
    ],
    corroboration_queue: [
      {
        edge_id: "EDGE-1",
        priority: "P2",
        disposition: "needs_explicit_single_source_disposition",
        reason: "Only one official source is visible.",
        from_id: "ENT-NVIDIA",
        from_name: "NVIDIA",
        to_id: "ENT-SAMSUNG-MEMORY",
        to_name: "Samsung Memory",
        component_id: "COMP-MEMORY",
        existing_source_adapters: ["sec-edgar"],
        candidate_node_ids: ["ENT-SAMSUNG-MEMORY"],
        candidate_source_ids: ["samsung-ir"],
        source_plan_refs: ["source-plan:item:samsung-ir"],
        source_targets: [sourceTargetFixture()],
        unknown_ids: [],
        latest_disposition: null,
        proposed_unknown: {
          unknown_id: "UNK-EDGE-1-SINGLE-SOURCE",
          scope_kind: "edge",
          scope_id: "EDGE-1",
          question: "Is there an independent official second source for this edge?",
          why_unknown: "Only one official source is visible.",
          blocking_data_sources: ["counterparty official disclosure"],
          proxies: [],
          created_by: "gate1.fixture"
        },
        action: "Record explicit unknown if no second source path is available."
      }
    ],
    edges: [],
    source_plan_items: [],
    gaps: []
  };
}

export function sourceTargetCoverageFixture(): SourceTargetCoverageReport {
  return {
    schema_version: "1.0.0",
    generated_at: "2026-01-01T00:00:00.000Z",
    company_id: "ENT-NVIDIA",
    namespace: "gate1-review-test",
    summary: {
      expected_targets: 8,
      synced_targets: 8,
      not_synced: 0,
      enabled_targets: 7,
      due_targets: 0,
      active_jobs: 0,
      retry_wait: 2,
      degraded_targets: 1,
      dead_targets: 0,
      source_failed_targets: 2,
      source_failure_kinds: {
        missing_credentials: 2,
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
    observation_review: {
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
    },
    items: [
      coverageItem("target-dart", "dart-kr", "retry_wait", "SOURCE_FAILED"),
      coverageItem("target-edinet", "edinet", "retry_wait", "SOURCE_FAILED"),
      coverageItem("target-samsung", "samsung-ir", "degraded", "SOURCE_DEGRADED")
    ]
  };
}

export function sourceTargetPreflightFixture(): SourceTargetPreflightReport {
  return {
    schema_version: "1.0.0",
    summary: {
      requested_targets: 1,
      selected_targets: 1,
      checked_targets: 0,
      failed_targets: 1,
      skipped_targets: 0,
      planned_tasks: 0,
      fetched_documents: 0,
      normalized_documents: 0,
      degraded_documents: 0,
      observation_drafts: 0,
      semantic_sections: 0,
      by_source: { "dart-kr": 1 },
      by_source_status: {
        "dart-kr": {
          selected_targets: 1,
          checked_targets: 0,
          failed_targets: 1,
          skipped_targets: 0,
          planned_tasks: 0,
          fetched_documents: 0,
          normalized_documents: 0,
          degraded_documents: 0,
          observation_drafts: 0,
          semantic_sections: 0,
          target_kinds: { "official-regulatory-disclosure": 1 },
          issue_kinds: { missing_credentials: 1 }
        }
      }
    },
    items: [
      {
        check_target_id: "target-dart",
        source_adapter_id: "dart-kr",
        target_kind: "official-regulatory-disclosure",
        status: "failed",
        planned_tasks: 0,
        fetched_documents: 0,
        normalized_documents: 0,
        degraded_documents: 0,
        documents: [],
        issue_kind: "missing_credentials",
        error_message: "OPENDART_API_KEY is required.",
        missing_credentials: [{ env_key: "OPENDART_API_KEY", description: "OpenDART API key", required: true }]
      }
    ]
  };
}

export function corroborationSourcePlanFixture(): CorroborationSourcePlan {
  return {
    schema_version: "1.0.0",
    generated_at: "2026-01-01T00:00:00.000Z",
    company_id: "ENT-NVIDIA",
    summary: {
      review_edges: 1,
      disposition_only_edges: 0,
      source_plan_items: 0,
      runnable_targets: 1,
      targets_need_sync: 1,
      targets_need_enable: 0,
      targets_due: 0,
      targets_failed_preflight: 0,
      targets_missing_credentials: 0,
      by_next_action: { smoke_target: 1 },
      by_source: { "samsung-ir": 1 }
    },
    target_refs: [],
    source_plan: []
  };
}

export function supplyChainExpansionPlanFixture(): SupplyChainExpansionPlan {
  return {
    schema_version: "1.0.0",
    generated_at: "2026-01-01T00:00:00.000Z",
    company_id: "ENT-NVIDIA",
    max_depth: 7,
    summary: {
      fact_edges_considered: 1,
      frontier_edges: 1,
      frontier_companies: 1,
      component_dependency_leads: 0,
      leads_with_fact_coverage: 0,
      leads_with_source_path: 0,
      leads_with_fact_capable_source_path: 0,
      leads_with_observation_source_path: 0,
      leads_with_lead_only_source_path: 0,
      lead_only_items: 0,
      observation_layer_items: 0,
      blocked_frontier_edges: 0,
      stop_conditions: 0,
      explicit_unknown_refs: 1
    },
    frontier: [
      {
        frontier_id: "frontier:EDGE-1",
        edge_id: "EDGE-1",
        path_depth: 1,
        expansion_state: "expand_candidate",
        from_id: "ENT-NVIDIA",
        from_name: "NVIDIA",
        to_id: "ENT-SAMSUNG-MEMORY",
        to_name: "Samsung Memory",
        next_company_id: "ENT-SAMSUNG-MEMORY",
        next_company_name: "Samsung Memory",
        relation: "BUYS_FROM",
        component_id: "COMP-MEMORY",
        evidence_level: 5,
        unknown_ids: ["UNK-EDGE-1-SINGLE-SOURCE"],
        source_plan_refs: ["source-plan:item:samsung-ir"],
        rationale: "Component-scoped frontier company is ready for the generic research path.",
        action: "Run generic research pack."
      }
    ],
    component_dependency_leads: [],
    stop_conditions: []
  };
}

export function samsungMemoryAffiliation(): Gate1EntityAffiliationContext {
  return {
    context_id: "gate1-entity-affiliation:ENT-SAMSUNG-MEMORY:ENT-SAMSUNG-ELECTRONICS",
    subject_entity_id: "ENT-SAMSUNG-MEMORY",
    subject_name: "Samsung Memory",
    subject_kind: "business_unit",
    parent_entity_id: "ENT-SAMSUNG-ELECTRONICS",
    parent_name: "Samsung Electronics",
    parent_kind: "company",
    parent_unknown_ids: ["UNK-SAMSUNG-PARENT-ROOT"],
    edge_ids: ["EDGE-1"],
    component_ids: ["COMP-MEMORY"],
    latest_disposition: null
  };
}

export function samsungMemoryAffiliationWithDisposition(
  decision: NonNullable<Gate1EntityAffiliationContext["latest_disposition"]>["decision"]
): Gate1EntityAffiliationContext {
  return {
    ...samsungMemoryAffiliation(),
    latest_disposition: {
      change_id: "CHG-ENTITY-AFFILIATION-1",
      decision,
      reviewer: "unit-test",
      reason: "fixture disposition",
      recorded_at: "2026-05-26T00:00:00.000Z",
      edge_ids: ["EDGE-1"],
      component_ids: ["COMP-MEMORY"],
      unknown_ids: ["UNK-SAMSUNG-PARENT-ROOT"]
    }
  };
}

function criterion(
  criterionId: OfficialDisclosureReadinessReport["scorecard"]["criteria"][number]["criterion_id"],
  kind: OfficialDisclosureReadinessReport["scorecard"]["criteria"][number]["kind"],
  measured: number,
  target: number
): OfficialDisclosureReadinessReport["scorecard"]["criteria"][number] {
  return {
    criterion_id: criterionId,
    label: criterionId,
    kind,
    status: "partial",
    measured,
    target,
    progress: target === 0 ? 0 : measured / target,
    rationale: "fixture"
  };
}

function sourceTargetFixture(): OfficialDisclosureReadinessReport["corroboration_queue"][number]["source_targets"][number] {
  return {
    source_adapter_id: "samsung-ir",
    target_kind: "official-html-disclosure",
    runnable: true,
    target_key: "samsung-ir:official-html-disclosure:2025",
    target_entity_id: "ENT-SAMSUNG-MEMORY",
    target_component_id: "COMP-MEMORY",
    expected_check_target_id: null,
    matched_check_target_id: null,
    match_kind: "none",
    check_target_id: null,
    state: "not_synced",
    synced: false,
    observations: 0,
    latest_event_type: null
  };
}

function coverageItem(
  checkTargetId: string,
  sourceAdapterId: string,
  state: SourceTargetCoverageReport["items"][number]["state"],
  eventType: string
): SourceTargetCoverageReport["items"][number] {
  return {
    expected_target: {
      check_target_id: checkTargetId,
      source_adapter_id: sourceAdapterId,
      target_kind: "official-html-disclosure",
      enabled: true,
      target_config: {}
    },
    synced: true,
    match_kind: "check_target_id",
    matched_check_target_id: checkTargetId,
    state,
    target_enabled: true,
    policy_enabled: true,
    next_check_at: "2026-01-08T00:00:00.000Z",
    effective_check_cadence_minutes: 10080,
    effective_jitter_minutes: 120,
    latest_job: {
      job_id: `job-${checkTargetId}`,
      status: state === "retry_wait" ? "failed" : "succeeded",
      attempts: state === "retry_wait" ? 1 : 0,
      last_error: state === "retry_wait" ? `${sourceAdapterId} requires AdapterContext.credentials.SOURCE_KEY` : null,
      failure_kind: state === "retry_wait" ? "missing_credentials" : null,
      next_attempt_at: "2026-01-01T00:02:00.000Z",
      completed_at: state === "retry_wait" ? null : "2026-01-01T00:01:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:01:00.000Z"
    },
    latest_event: {
      event_id: `event-${checkTargetId}`,
      event_type: eventType,
      doc_id: null,
      detected_at: "2026-01-01T00:00:00.000Z",
      caused_by: `source-check.${sourceAdapterId}`
    },
    observations: 0,
    observations_by_metric: {},
    observation_samples: [],
    latest_observation_at: null
  };
}
