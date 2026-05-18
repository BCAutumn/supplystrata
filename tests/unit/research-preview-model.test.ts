import { describe, expect, it } from "vitest";
import { parseWorkbenchModel } from "../../apps/research-preview/src/data/normalize-workbench-model.js";

describe("research-preview workbench model parser", () => {
  it("accepts a structurally valid workbench export", () => {
    const model = validWorkbenchModel();
    expect(parseWorkbenchModel(JSON.stringify(model)).selected_company_id).toBe("ENT-NVIDIA");
  });

  it("rejects nested malformed evidence rows before rendering", () => {
    const model = validWorkbenchModel();
    model.evidences[0] = { ...model.evidences[0], confidence: "high" };
    expect(() => parseWorkbenchModel(JSON.stringify(model))).toThrow(/evidences\[0\]\.confidence/);
  });
});

function validWorkbenchModel(): Record<string, unknown> & { evidences: Record<string, unknown>[] } {
  const segment = {
    sequence_index: 0,
    depth: 1,
    semantic_layer: "edge",
    from: { kind: "company", id: "ENT-NVIDIA", name: "NVIDIA" },
    to: { kind: "company", id: "ENT-TSMC", name: "TSMC" },
    relation: "USES_FOUNDRY",
    component: "wafer",
    component_id: "COMP-WAFER",
    edge_id: "EDGE-1",
    evidence_ids: ["EV-1"],
    evidence_level: 5,
    confidence: 0.92,
    label: "NVIDIA uses TSMC foundry"
  };
  const edge = {
    edge_id: "EDGE-1",
    from_id: "ENT-NVIDIA",
    from_name: "NVIDIA",
    to_id: "ENT-TSMC",
    to_name: "TSMC",
    relation: "USES_FOUNDRY",
    component: "wafer",
    component_id: "COMP-WAFER",
    evidence_level: 5,
    confidence: 0.92,
    evidence_ids: ["EV-1"]
  };
  const claim = {
    claim_id: "CLAIM-1",
    claim_type: "SUPPLY_RELATION_CLAIM",
    claim_text: "NVIDIA discloses that it uses TSMC for wafer fabrication.",
    subject_id: "ENT-NVIDIA",
    object_id: "ENT-TSMC",
    component_id: "COMP-WAFER",
    edge_id: "EDGE-1",
    review_id: null,
    status: "draft",
    evidence_level: 5,
    confidence: 0.92,
    is_inferred: false,
    generated_by: "test",
    last_verified_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z"
  };
  const evidence = {
    evidence_id: "EV-1",
    edge_id: "EDGE-1",
    superseded_by: null,
    cite_text: "We depend on TSMC for wafer fabrication.",
    cite_locator: "Item 1",
    cite_start_char: 10,
    cite_end_char: 53,
    cite_text_sha256: "abc",
    normalized_cite_text_sha256: "def",
    source_snapshot_sha256: "ghi",
    parser_version: "parser.v1",
    extractor_version: "rule.v1",
    relation_candidate_hash: "hash",
    evidence_level: 5,
    confidence: 0.92,
    is_inferred: false,
    extraction_method: "rule",
    source_url: "https://example.com",
    source_date: "2026-01-01",
    fetched_at: "2026-01-01T00:00:00.000Z",
    source_adapter_id: "sec-edgar",
    document_type: "10-K",
    subject_name: "NVIDIA",
    object_name: "TSMC",
    relation: "USES_FOUNDRY"
  };
  return {
    schema_version: "1.0.0",
    generated_at: "2026-01-01T00:00:00.000Z",
    selected_company_id: "ENT-NVIDIA",
    companies: [
      { entity_id: "ENT-NVIDIA", name: "NVIDIA", role: "root" },
      { entity_id: "ENT-TSMC", name: "TSMC", role: "counterparty" }
    ],
    chain: {
      schema_version: "1.0.0",
      view_type: "company_chain",
      root: { kind: "company", id: "ENT-NVIDIA", name: "NVIDIA" },
      max_depth: 2,
      generated_by: "test",
      segments: [segment],
      stats: { fact_edges: 1, claims: 0, observations: 0, leads: 0, unknowns: 0 }
    },
    chain_segments: [segment],
    edges: [edge],
    upstream_edges: [edge],
    downstream_edges: [],
    claims: [claim],
    draft_claims: [claim],
    evidences: [evidence],
    unknown_items: [
      {
        unknown_id: "UNK-1",
        question: "Exact allocation?",
        why_unknown: "Private contracts are not disclosed.",
        blocking_data_sources: ["customer contract"],
        proxies: ["supplier capex"],
        status: "open"
      }
    ],
    sources: [
      {
        source_adapter_id: "sec-edgar",
        tier: "A",
        category: "company_disclosure",
        registry_status: "active",
        automation: "automated",
        tos_url: "https://www.sec.gov",
        official_url: "https://www.sec.gov/edgar",
        requires_key: false,
        last_checked_at: null,
        last_success_at: null,
        last_failure_at: null,
        failure_count: 0,
        last_change_at: null,
        last_error_message: null,
        policy_enabled: true,
        check_cadence_minutes: 1440,
        jitter_minutes: 30,
        priority: 1,
        next_check_at: null,
        policy_config_source: "default",
        policy_notes: null
      }
    ],
    source_plan: [
      {
        source_id: "sec-edgar",
        source_name: "SEC EDGAR",
        purpose: "official_disclosure",
        priority: "A",
        status: "active",
        automation: "automated",
        requires_key: false,
        expected_output_layer: "edge",
        relation_policy: "can_create_fact_edge",
        parent_component_ids: ["COMP-WAFER"],
        target_ids: ["COMP-WAFER"],
        trigger_dependency_ids: [],
        reasons: ["official disclosure"]
      }
    ],
    changes: [
      {
        event_id: "CHG-1",
        event_family: "graph",
        event_type: "EDGE_ADDED",
        occurred_at: "2026-01-01T00:00:00.000Z",
        caused_by: "test",
        requires_attention: false
      }
    ]
  };
}
