import type { WorkbenchModel } from "@supplystrata/workbench-export";

export function workbenchScbomFixture(): WorkbenchModel {
  return {
    schema_version: "1.0.0",
    generated_at: "2026-05-23T00:00:00.000Z",
    selected_company_id: "ENT-NVIDIA",
    companies: [
      { entity_id: "ENT-NVIDIA", name: "NVIDIA", role: "root" },
      { entity_id: "ENT-TSMC", name: "TSMC", role: "counterparty" }
    ],
    chain: {
      schema_version: "1.0.0",
      view_type: "company_chain",
      root: { kind: "company", id: "ENT-NVIDIA", name: "NVIDIA" },
      max_depth: 1,
      generated_by: "unit-test",
      segments: [
        {
          sequence_index: 0,
          depth: 1,
          semantic_layer: "edge",
          from: { kind: "company", id: "ENT-NVIDIA", name: "NVIDIA" },
          to: { kind: "company", id: "ENT-TSMC", name: "TSMC" },
          relation: "USES_FOUNDRY",
          component: "wafer",
          component_id: "COMP-WAFER",
          edge_id: "EDGE-NVIDIA-TSMC",
          evidence_ids: ["EV-PRIMARY"],
          evidence_level: 5,
          confidence: 0.93,
          label: "NVIDIA -USES_FOUNDRY-> TSMC"
        },
        {
          sequence_index: 1,
          depth: 0,
          semantic_layer: "observation",
          from: { kind: "company", id: "ENT-NVIDIA", name: "NVIDIA" },
          to: { kind: "component", id: "COMP-GPU", name: "GPU" },
          relation: "OBSERVES",
          component: "GPU",
          component_id: "COMP-GPU",
          observation_id: "OBS-GPU-1",
          evidence_ids: ["EV-PRIMARY"],
          confidence: 0.72,
          label: "NVIDIA discloses GPU demand context without asserting a new supplier relationship."
        }
      ],
      stats: { fact_edges: 1, claims: 0, observations: 1, leads: 0, unknowns: 0 }
    },
    chain_segments: [
      {
        sequence_index: 0,
        depth: 1,
        semantic_layer: "edge",
        from: { kind: "company", id: "ENT-NVIDIA", name: "NVIDIA" },
        to: { kind: "company", id: "ENT-TSMC", name: "TSMC" },
        relation: "USES_FOUNDRY",
        component: "wafer",
        component_id: "COMP-WAFER",
        edge_id: "EDGE-NVIDIA-TSMC",
        evidence_ids: ["EV-PRIMARY"],
        evidence_level: 5,
        confidence: 0.93,
        label: "NVIDIA -USES_FOUNDRY-> TSMC"
      },
      {
        sequence_index: 1,
        depth: 0,
        semantic_layer: "observation",
        from: { kind: "company", id: "ENT-NVIDIA", name: "NVIDIA" },
        to: { kind: "component", id: "COMP-GPU", name: "GPU" },
        relation: "OBSERVES",
        component: "GPU",
        component_id: "COMP-GPU",
        observation_id: "OBS-GPU-1",
        evidence_ids: ["EV-PRIMARY"],
        confidence: 0.72,
        label: "NVIDIA discloses GPU demand context without asserting a new supplier relationship."
      }
    ],
    edges: [
      {
        edge_id: "EDGE-NVIDIA-TSMC",
        from_id: "ENT-NVIDIA",
        from_name: "NVIDIA",
        to_id: "ENT-TSMC",
        to_name: "TSMC",
        relation: "USES_FOUNDRY",
        component: "wafer",
        component_id: "COMP-WAFER",
        evidence_level: 5,
        confidence: 0.93,
        evidence_ids: ["EV-PRIMARY"]
      }
    ],
    upstream_edges: [
      {
        edge_id: "EDGE-NVIDIA-TSMC",
        from_id: "ENT-NVIDIA",
        from_name: "NVIDIA",
        to_id: "ENT-TSMC",
        to_name: "TSMC",
        relation: "USES_FOUNDRY",
        component: "wafer",
        component_id: "COMP-WAFER",
        evidence_level: 5,
        confidence: 0.93,
        evidence_ids: ["EV-PRIMARY"]
      }
    ],
    downstream_edges: [],
    claims: [],
    draft_claims: [],
    evidences: [
      {
        evidence_id: "EV-PRIMARY",
        edge_id: "EDGE-NVIDIA-TSMC",
        superseded_by: null,
        cite_text: "NVIDIA uses TSMC for wafer fabrication.",
        cite_locator: "Item 1",
        cite_start_char: null,
        cite_end_char: null,
        cite_text_sha256: null,
        normalized_cite_text_sha256: null,
        source_snapshot_sha256: null,
        parser_version: null,
        extractor_version: null,
        relation_candidate_hash: null,
        evidence_level: 5,
        confidence: 0.93,
        is_inferred: false,
        extraction_method: "rule",
        source_url: "https://www.sec.gov/fixture",
        source_date: "2026-02-01",
        fetched_at: "2026-02-02T00:00:00.000Z",
        source_adapter_id: "sec-edgar",
        document_type: "10-K",
        subject_name: "NVIDIA",
        object_name: "TSMC",
        relation: "USES_FOUNDRY"
      }
    ],
    unknown_items: [
      {
        unknown_id: "UNK-CONFLICT-1",
        scope_kind: "claim",
        scope_id: "CLM-REVIEW-1",
        question: "Does this draft claim remain valid?",
        why_unknown: "Counterparty disclosure no longer lists this relationship.",
        blocking_data_sources: ["tsmc-ir"],
        proxies: ["EV-PRIMARY"],
        status: "open"
      }
    ],
    sources: [
      {
        source_adapter_id: "sec-edgar",
        tier: "official",
        category: "filing",
        registry_status: "active",
        automation: "automated",
        tos_url: "https://www.sec.gov/privacy.htm",
        official_url: "https://www.sec.gov/",
        requires_key: false,
        last_checked_at: "2026-05-20T00:00:00.000Z",
        last_success_at: "2026-05-20T00:00:00.000Z",
        last_failure_at: null,
        failure_count: 0,
        last_change_at: null,
        last_error_message: null,
        policy_enabled: true,
        check_cadence_minutes: 1440,
        jitter_minutes: 30,
        priority: 1,
        next_check_at: "2026-05-21T00:00:00.000Z",
        policy_config_source: "unit-test",
        policy_notes: null
      }
    ],
    source_plan: [],
    changes: [
      {
        event_id: "CHG-EDGE-1",
        event_family: "graph",
        event_type: "EDGE_CREATED",
        occurred_at: "2026-05-23T00:00:00.000Z",
        caused_by: "unit-test",
        requires_attention: false,
        edge_id: "EDGE-NVIDIA-TSMC",
        evidence_id: "EV-PRIMARY"
      },
      {
        event_id: "CHG-RISK-1",
        event_family: "risk",
        event_type: "RISK_METRIC_UPDATED",
        occurred_at: "2026-05-23T00:00:00.000Z",
        caused_by: "unit-test",
        requires_attention: true,
        metric_name: "revenue_anomaly"
      }
    ],
    attention_queue: [
      {
        attention_id: "ATTN-RISK-1",
        kind: "alert",
        priority: "P0",
        status: "open",
        title: "Risk signal",
        summary: "Internal risk queue item.",
        action: "review",
        scope_kind: "component",
        scope_id: "COMP-GPU",
        refs: ["risk_metric:RISK-METRIC-1"],
        detected_at: "2026-05-23T00:00:00.000Z"
      }
    ],
    review_queue: [
      {
        review_id: "REV-OFFICIAL-SIGNAL-1",
        kind: "official_disclosure_signal",
        status: "pending",
        title: "Official disclosure signal",
        confidence: 0.84,
        source_adapter_id: "tsmc-ir",
        doc_id: "DOC-TSMC-IR",
        source_url: "https://investor.tsmc.com/fixture",
        source_locator: "page 4",
        source_row_text: "TSMC observed AI and HPC demand across customer products.",
        created_at: "2026-05-21T00:00:00.000Z",
        reviewed_at: null,
        decision_reason: null,
        signal: {
          signal_title: "TSMC links demand to AI and HPC",
          evidence_level_hint: 4,
          automatic_fact_mutation_allowed: false
        },
        dispositions: []
      }
    ],
    intelligence: {
      edge_strengths: [],
      edge_freshness: []
    }
  };
}
