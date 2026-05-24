import { describe, expect, it } from "vitest";
import { buildWorkbenchModel, workbenchEdgeFromSegment } from "@supplystrata/workbench-export";
import { parseWorkbenchModel } from "@supplystrata/workbench-export/schema";
import type { ChainViewSegmentModel } from "@supplystrata/chain-view";
import type pg from "pg";
import type { DbClient } from "@supplystrata/db/read";

interface QueryCall {
  sql: string;
  params: readonly unknown[];
}

class WorkbenchDbClient implements DbClient {
  private readonly options: { includeEdgeEvidence: boolean; includeDeprecatedClaim: boolean; includeAttentionSignals: boolean; includeReviewSignals: boolean };

  constructor(
    input:
      | boolean
      | { includeEdgeEvidence?: boolean; includeDeprecatedClaim?: boolean; includeAttentionSignals?: boolean; includeReviewSignals?: boolean } = false
  ) {
    this.options =
      typeof input === "boolean"
        ? { includeEdgeEvidence: input, includeDeprecatedClaim: false, includeAttentionSignals: false, includeReviewSignals: false }
        : {
            includeEdgeEvidence: input.includeEdgeEvidence ?? false,
            includeDeprecatedClaim: input.includeDeprecatedClaim ?? false,
            includeAttentionSignals: input.includeAttentionSignals ?? false,
            includeReviewSignals: input.includeReviewSignals ?? false
          };
  }

  readonly calls: QueryCall[] = [];

  async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    return {
      command: "MOCK",
      rowCount: 0,
      oid: 0,
      fields: [],
      rows: rowsForWorkbench<T>(sql, params, this.options)
    };
  }
}

describe("workbench-export", () => {
  it("converts fact edge segments into workbench edges", () => {
    const segment: ChainViewSegmentModel = {
      sequence_index: 0,
      depth: 1,
      semantic_layer: "edge",
      from: { kind: "company", id: "ENT-NVIDIA", name: "NVIDIA" },
      to: { kind: "company", id: "ENT-TSMC", name: "TSMC" },
      relation: "USES_FOUNDRY",
      component: "foundry services",
      component_id: "COMP-FOUNDRY",
      edge_id: "EDGE-1",
      evidence_ids: ["EV-1"],
      evidence_level: 5,
      confidence: 0.93,
      label: "NVIDIA -USES_FOUNDRY-> TSMC"
    };

    expect(workbenchEdgeFromSegment(segment)).toEqual({
      edge_id: "EDGE-1",
      from_id: "ENT-NVIDIA",
      from_name: "NVIDIA",
      to_id: "ENT-TSMC",
      to_name: "TSMC",
      relation: "USES_FOUNDRY",
      component: "foundry services",
      component_id: "COMP-FOUNDRY",
      evidence_level: 5,
      confidence: 0.93,
      evidence_ids: ["EV-1"]
    });
  });

  it("rejects observation segments as workbench fact edges", () => {
    const segment: ChainViewSegmentModel = {
      sequence_index: 1,
      depth: 0,
      semantic_layer: "observation",
      from: { kind: "company", id: "ENT-NVIDIA", name: "NVIDIA" },
      to: { kind: "component", id: "COMP-MEMORY", name: "COMP-MEMORY" },
      relation: "OBSERVES",
      component: null,
      component_id: "COMP-MEMORY",
      observation_id: "OBS-1",
      evidence_ids: [],
      confidence: 0.7,
      label: "INVENTORY_OBSERVATION: inventory_days = 42 days"
    };

    expect(() => workbenchEdgeFromSegment(segment)).toThrow("Segment is not a fact edge");
  });

  it("exports draft claims separately from chain fact edges", async () => {
    const client = new WorkbenchDbClient();

    const model = await buildWorkbenchModel(client, { company: "nvidia", depth: 1, generatedAt: "2026-05-23T00:00:00.000Z", draftClaimLimit: 5 });

    expect(model.edges).toHaveLength(0);
    expect(model.draft_claims).toHaveLength(1);
    expect(model.draft_claims[0]?.status).toBe("draft");
    expect(model.draft_claims[0]?.evidence_refs).toEqual([
      { evidence_id: "EV-PRIMARY", role: "primary" },
      { evidence_id: "EV-CONTRA", role: "contradicting" }
    ]);
    expect(model.draft_claims[0]?.unknown_refs).toEqual([{ unknown_id: "UNK-CONFLICT-1", role: "blocking", status: "open" }]);
    expect(model.draft_claims[0]?.conflict_state).toBe("open_conflict");
    expect(model.draft_claims[0]?.conflict_adjudication).toMatchObject({
      state: "open_conflict",
      severity: "medium",
      recommended_action: "collect_resolution_evidence",
      edge_review_required: false,
      allowed_edge_mutation: "none",
      reason_codes: ["open_conflict_unknown", "contradicting_evidence_linked", "draft_or_non_edge_claim"]
    });
    expect(model.draft_claims[0]?.conflict_review).toMatchObject({
      conflict_state: "open_conflict",
      review_queue_kind: "claim_conflict_review",
      safe_write_status: "blocked_pending_review",
      required_review_steps: ["inspect_supporting_evidence", "inspect_contradicting_evidence", "resolve_conflict_unknown"],
      fact_write_policy: {
        automatic_fact_mutation_allowed: false,
        allowed_edge_mutation: "none",
        requires_human_review: true
      }
    });
    expect(model.unknown_items.map((item) => item.unknown_id)).toContain("UNK-CONFLICT-1");
    expect(model.unknown_items.find((item) => item.unknown_id === "UNK-CONFLICT-1")).toMatchObject({
      scope_kind: "claim",
      scope_id: "CLM-REVIEW-1"
    });
    expect(model.attention_queue).toContainEqual(
      expect.objectContaining({
        attention_id: "ATTN-CLAIM-CONFLICT-CLM-REVIEW-1",
        kind: "claim_conflict",
        priority: "P1",
        scope_kind: "claim",
        scope_id: "CLM-REVIEW-1",
        refs: ["claim:CLM-REVIEW-1", "evidence:EV-CONTRA", "evidence:EV-PRIMARY", "unknown:UNK-CONFLICT-1"]
      })
    );
    expect(model.chain_segments.some((segment) => segment.claim_id === model.draft_claims[0]?.claim_id)).toBe(false);
    expect(client.calls.some((call) => call.sql.includes("WHERE c.status = 'draft'"))).toBe(true);
  });

  it("uses explicit generatedAt for repeatable export timestamps and default change windows", async () => {
    const client = new WorkbenchDbClient(true);

    const model = await buildWorkbenchModel(client, { company: "nvidia", depth: 1, generatedAt: "2026-05-23T00:00:00.000Z" });

    expect(model.generated_at).toBe("2026-05-23T00:00:00.000Z");
    expect(model.intelligence.edge_freshness[0]?.computed_at).toBe("2026-05-23T00:00:00.000Z");
    expect(client.calls.find((call) => call.sql.includes("FROM change_records cr"))?.params[0]).toBe("2026-04-23T00:00:00.000Z");
  });

  it("normalizes legacy workbench snapshots without mutating caller-owned objects", async () => {
    const model = await buildWorkbenchModel(new WorkbenchDbClient(), { company: "nvidia", depth: 1, generatedAt: "2026-05-23T00:00:00.000Z" });
    const legacy = JSON.parse(JSON.stringify(model)) as {
      draft_claims?: unknown;
      attention_queue?: unknown;
      review_queue?: unknown;
      intelligence?: unknown;
      unknown_items?: Record<string, unknown>[];
    };
    delete legacy.draft_claims;
    delete legacy.attention_queue;
    delete legacy.review_queue;
    delete legacy.intelligence;
    if (legacy.unknown_items?.[0] !== undefined) {
      delete legacy.unknown_items[0]["scope_kind"];
      delete legacy.unknown_items[0]["scope_id"];
    }

    const parsed = parseWorkbenchModel(JSON.stringify(legacy));

    expect(parsed.draft_claims).toEqual([]);
    expect(parsed.attention_queue).toEqual([]);
    expect(parsed.review_queue).toEqual([]);
    expect(parsed.intelligence).toEqual({ edge_strengths: [], edge_freshness: [] });
    expect(parsed.unknown_items[0]).toMatchObject({ scope_kind: "legacy", scope_id: parsed.unknown_items[0]?.unknown_id });
    expect(legacy.draft_claims).toBeUndefined();
    expect(legacy.unknown_items?.[0]?.["scope_kind"]).toBeUndefined();
  });

  it("exports all evidence attached to chain edges, including superseded evidence", async () => {
    const client = new WorkbenchDbClient(true);

    const model = await buildWorkbenchModel(client, { company: "nvidia", depth: 1, generatedAt: "2026-05-23T00:00:00.000Z" });

    expect(model.edges).toHaveLength(1);
    expect(model.edges[0]?.evidence_ids).toEqual(["EV-PRIMARY"]);
    expect(model.evidences.map((item) => item.evidence_id)).toEqual(["EV-PRIMARY", "EV-OLD"]);
    expect(model.evidences[1]?.superseded_by).toBe("EV-PRIMARY");
    expect(model.intelligence.edge_strengths[0]).toMatchObject({ edge_id: "EDGE-NVIDIA-TSMC", strength_kind: "qualitative" });
    expect(model.intelligence.edge_freshness[0]).toMatchObject({
      edge_id: "EDGE-NVIDIA-TSMC",
      decay_model: "methodology.v1",
      freshness_score: 1
    });
  });

  it("exports active claims still attached to deprecated edges as lifecycle warnings", async () => {
    const client = new WorkbenchDbClient({ includeDeprecatedClaim: true });

    const model = await buildWorkbenchModel(client, { company: "nvidia", depth: 1, generatedAt: "2026-05-23T00:00:00.000Z", lifecycleClaimLimit: 5 });

    expect(model.claims).toHaveLength(1);
    expect(model.claims[0]).toMatchObject({
      claim_id: "CLM-STALE-EDGE",
      status: "active",
      edge_id: "EDGE-DEPRECATED",
      edge_validity: "deprecated",
      edge_deprecated_reason: "Reviewed counterparty disclosure contradicted the edge.",
      edge_superseded_by_edge_id: "EDGE-REPLACEMENT",
      lifecycle_warnings: [
        {
          code: "active_claim_on_inactive_edge",
          severity: "warn"
        }
      ]
    });
    expect(model.claims[0]?.lifecycle_warnings[0]?.message).toContain("deprecated edge EDGE-DEPRECATED");
    expect(model.attention_queue).toContainEqual(
      expect.objectContaining({
        attention_id: "ATTN-CLAIM-LIFECYCLE-CLM-STALE-EDGE-active_claim_on_inactive_edge",
        kind: "claim_lifecycle",
        priority: "P0",
        scope_kind: "claim",
        scope_id: "CLM-STALE-EDGE",
        refs: ["claim:CLM-STALE-EDGE", "edge:EDGE-DEPRECATED"]
      })
    );
    expect(client.calls.some((call) => call.sql.includes("e.validity <> 'current'"))).toBe(true);
  });

  it("exports alert candidates into the unified attention queue", async () => {
    const client = new WorkbenchDbClient({ includeAttentionSignals: true });

    const model = await buildWorkbenchModel(client, { company: "nvidia", depth: 1, generatedAt: "2026-05-23T00:00:00.000Z", alertLimit: 10 });

    expect(model.attention_queue).toContainEqual(
      expect.objectContaining({
        attention_id: "ATTN-ALERT-ALERT-OBS-1",
        kind: "alert",
        priority: "P0",
        status: "open",
        title: "Critical revenue anomaly",
        scope_kind: "component",
        scope_id: "COMP-GPU",
        refs: ["alert:ALERT-OBS-1", "observation:OBS-REVENUE-1", "risk_metric:RISK-METRIC-1", "source:sec-edgar"]
      })
    );
    expect(client.calls.some((call) => call.sql.includes("FROM alert_candidates"))).toBe(true);
  });

  it("exports official disclosure review signals as read-only workbench context", async () => {
    const client = new WorkbenchDbClient({ includeEdgeEvidence: true, includeReviewSignals: true });

    const model = await buildWorkbenchModel(client, { company: "nvidia", depth: 1, generatedAt: "2026-05-23T00:00:00.000Z", reviewCandidateLimit: 10 });

    expect(model.review_queue).toHaveLength(1);
    expect(model.review_queue[0]).toMatchObject({
      review_id: "REV-OFFICIAL-SIGNAL-1",
      kind: "official_disclosure_signal",
      status: "pending",
      source_adapter_id: "tsmc-ir",
      signal: {
        signal_title: "TSMC links demand to AI and HPC",
        evidence_level_hint: 4,
        automatic_fact_mutation_allowed: false
      }
    });
    expect(model.review_queue[0]?.dispositions).toContainEqual(
      expect.objectContaining({
        review_id: "REV-OFFICIAL-SIGNAL-1",
        edge_id: "EDGE-NVIDIA-TSMC",
        decision: "needs_more_evidence",
        fact_write_policy: {
          automatic_fact_mutation_allowed: false,
          allowed_edge_mutation: "none",
          requires_human_review: true
        }
      })
    );
    expect(client.calls.some((call) => call.sql.includes("FROM review_candidates") && call.params[1] === 10)).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("OFFICIAL_DISCLOSURE_SIGNAL_DISPOSITION_RECORDED"))).toBe(true);
  });
});

function rowsForWorkbench<T extends pg.QueryResultRow>(
  sql: string,
  params: readonly unknown[],
  input: { includeEdgeEvidence: boolean; includeDeprecatedClaim: boolean; includeAttentionSignals: boolean; includeReviewSignals: boolean }
): T[] {
  if (sql.includes("SELECT entity_id FROM entity_master")) {
    return [{ entity_id: "ENT-NVIDIA" }] as unknown as T[];
  }
  if (sql.includes("SELECT entity_id, display_name FROM entity_master")) {
    return [{ entity_id: "ENT-NVIDIA", display_name: "NVIDIA" }] as unknown as T[];
  }
  if (input.includeEdgeEvidence && sql.includes("WITH RECURSIVE walk AS")) {
    return [
      {
        depth: 1,
        edge_id: "EDGE-NVIDIA-TSMC",
        relation: "USES_FOUNDRY",
        subject_id: "ENT-NVIDIA",
        subject_name: "NVIDIA",
        object_id: "ENT-TSMC",
        object_name: "TSMC",
        upstream_id: "ENT-TSMC",
        upstream_name: "TSMC",
        component: "wafer",
        component_id: "COMP-WAFER",
        evidence_level: 5,
        confidence: 0.93,
        primary_evidence_id: "EV-PRIMARY",
        claim_id: null,
        claim_text: null
      }
    ] as unknown as T[];
  }
  if (input.includeEdgeEvidence && sql.includes("FROM evidence ev") && sql.includes("WHERE ev.edge_id = ANY")) {
    expect(params).toEqual([["EDGE-NVIDIA-TSMC"]]);
    return evidenceRows() as unknown as T[];
  }
  if (input.includeEdgeEvidence && sql.includes("FROM edge_strength_estimates")) {
    return [
      {
        strength_id: "STR-QUALITATIVE-1",
        edge_id: "EDGE-NVIDIA-TSMC",
        strength_kind: "qualitative",
        value: "1",
        lower_bound: null,
        upper_bound: null,
        unit: null,
        evidence_id: "EV-PRIMARY",
        method: "manual-reviewed.v1",
        valid_from: null,
        valid_to: null,
        attrs: {}
      }
    ] as unknown as T[];
  }
  if (input.includeEdgeEvidence && sql.includes("FROM edge_freshness")) {
    return [] as T[];
  }
  if (input.includeEdgeEvidence && sql.includes("FROM edges") && sql.includes("last_verified_at")) {
    return [
      {
        edge_id: "EDGE-NVIDIA-TSMC",
        last_verified_at: new Date("2026-02-01T00:00:00.000Z"),
        primary_evidence_id: "EV-PRIMARY"
      }
    ] as unknown as T[];
  }
  if (sql.includes("JOIN edges e ON e.edge_id = c.edge_id") && sql.includes("e.validity <> 'current'")) {
    if (!input.includeDeprecatedClaim) return [];
    return [
      {
        claim_id: "CLM-STALE-EDGE",
        claim_type: "SUPPLY_RELATION_CLAIM",
        claim_text: "NVIDIA publicly discloses that it buys memory from SK Hynix.",
        subject_id: "ENT-NVIDIA",
        object_id: "ENT-SKHYNIX",
        component_id: "COMP-MEMORY",
        edge_id: "EDGE-DEPRECATED",
        edge_validity: "deprecated",
        edge_deprecated_reason: "Reviewed counterparty disclosure contradicted the edge.",
        edge_superseded_by_edge_id: "EDGE-REPLACEMENT",
        review_id: null,
        status: "active",
        evidence_level: 5,
        confidence: 0.91,
        is_inferred: false,
        generated_by: "claim-builder.edge-fact.v1",
        last_verified_at: new Date("2026-01-01T00:00:00.000Z"),
        created_at: new Date("2026-01-01T00:00:00.000Z"),
        updated_at: new Date("2026-05-20T00:00:00.000Z")
      }
    ] as unknown as T[];
  }
  if (sql.includes("FROM claims") && sql.includes("WHERE c.status = 'draft'")) {
    expect(sql).toContain("(c.subject_id = $1 OR c.object_id = $1)");
    expect(params[0]).toBe("ENT-NVIDIA");
    expect(params[1]).toBeTypeOf("number");
    return [
      {
        claim_id: "CLM-REVIEW-1",
        claim_type: "RISK_SIGNAL_CLAIM",
        claim_text: "Reviewed official-disclosure monitoring flagged changed wording for a monitored candidate.",
        subject_id: "ENT-NVIDIA",
        object_id: "ENT-TSMC",
        component_id: null,
        edge_id: null,
        edge_validity: null,
        edge_deprecated_reason: null,
        edge_superseded_by_edge_id: null,
        review_id: "REV-SEMANTIC-1",
        status: "draft",
        evidence_level: 3,
        confidence: 0.82,
        is_inferred: true,
        generated_by: "claim-builder.semantic-change-draft.v1",
        last_verified_at: new Date("2026-05-18T00:00:00.000Z"),
        created_at: new Date("2026-05-18T00:00:00.000Z"),
        updated_at: new Date("2026-05-18T00:00:00.000Z")
      }
    ] as unknown as T[];
  }
  if (sql.includes("FROM claim_evidence") && params[0] === "CLM-REVIEW-1") {
    return [
      { claim_id: "CLM-REVIEW-1", evidence_id: "EV-PRIMARY", role: "primary" },
      { claim_id: "CLM-REVIEW-1", evidence_id: "EV-CONTRA", role: "contradicting" }
    ] as unknown as T[];
  }
  if (sql.includes("FROM claim_unknowns") && params[0] === "CLM-REVIEW-1") {
    return [{ claim_id: "CLM-REVIEW-1", unknown_id: "UNK-CONFLICT-1", role: "blocking", status: "open" }] as unknown as T[];
  }
  if (sql.includes("FROM claim_evidence") && params[0] === "CLM-STALE-EDGE") {
    return [{ claim_id: "CLM-STALE-EDGE", evidence_id: "EV-STALE", role: "primary" }] as unknown as T[];
  }
  if (sql.includes("FROM claim_unknowns") && params[0] === "CLM-STALE-EDGE") {
    return [] as T[];
  }
  if (sql.includes("FROM unknown_items") && sql.includes("unknown_id = ANY")) {
    expect(params).toEqual([["UNK-CONFLICT-1"]]);
    return [
      {
        unknown_id: "UNK-CONFLICT-1",
        scope_kind: "claim",
        scope_id: "CLM-REVIEW-1",
        question: "Does this claim remain valid?",
        why_unknown: "Counterparty disclosure no longer lists this relationship.",
        blocking_data_sources: ["tsmc-ir"],
        proxies: ["EV-CONTRA"],
        status: "open"
      }
    ] as unknown as T[];
  }
  if (input.includeAttentionSignals && sql.includes("FROM alert_candidates")) {
    return [
      {
        alert_id: "ALERT-OBS-1",
        alert_kind: "observation_anomaly",
        severity: "critical",
        status: "open",
        scope_kind: "component",
        scope_id: "COMP-GPU",
        title: "Critical revenue anomaly",
        summary: "Revenue moved well outside the explicit baseline.",
        dedupe_key: "financial_anomaly:COMP-GPU:revenue",
        observation_id: "OBS-REVENUE-1",
        risk_view_id: null,
        risk_metric_id: "RISK-METRIC-1",
        change_id: null,
        source_event_id: null,
        source_adapter_id: "sec-edgar",
        detected_at: new Date("2026-05-20T00:00:00.000Z"),
        provenance: {},
        attrs: {}
      }
    ] as unknown as T[];
  }
  if (input.includeReviewSignals && sql.includes("FROM review_candidates")) {
    expect(params[0]).toContain("tsmc-ir");
    return [
      {
        review_id: "REV-OFFICIAL-SIGNAL-1",
        kind: "official_disclosure_signal",
        status: "pending",
        title: "Official disclosure signal: TSMC links demand to AI and HPC",
        confidence: "0.84",
        source_adapter_id: "tsmc-ir",
        doc_id: "DOC-TSMC-IR",
        source_url: "https://investor.tsmc.com/fixture",
        source_locator: "page 4",
        source_row_text: "TSMC observed AI and HPC demand across customer products.",
        signal_title: "TSMC links demand to AI and HPC",
        signal_evidence_level_hint: "4",
        signal_automatic_fact_mutation_allowed: "false",
        reviewed_at: null,
        decision_reason: null,
        created_at: new Date("2026-05-21T00:00:00.000Z")
      }
    ] as unknown as T[];
  }
  if (input.includeReviewSignals && sql.includes("FROM change_records") && sql.includes("OFFICIAL_DISCLOSURE_SIGNAL_DISPOSITION_RECORDED")) {
    return [
      {
        change_id: "CHG-OFFICIAL-SIGNAL-DISPOSITION-1",
        review_id: "REV-OFFICIAL-SIGNAL-1",
        after: {
          review_id: "REV-OFFICIAL-SIGNAL-1",
          edge_id: "EDGE-NVIDIA-TSMC",
          decision: "needs_more_evidence",
          reviewer: "unit-test",
          reason: "Signal mentions demand but does not name the exact edge counterparty.",
          source_adapter_id: "tsmc-ir",
          doc_id: "DOC-TSMC-IR",
          signal_title: "TSMC links demand to AI and HPC",
          evidence_id: null,
          unknown_id: null,
          check_target_id: null,
          recorded_at: "2026-05-22T00:00:00.000Z",
          fact_write_policy: {
            automatic_fact_mutation_allowed: false,
            allowed_edge_mutation: "none",
            requires_human_review: true
          }
        },
        caused_by: "unit-test",
        detected_at: new Date("2026-05-22T00:00:00.000Z")
      }
    ] as unknown as T[];
  }
  return [];
}

function evidenceRows(): pg.QueryResultRow[] {
  const base = {
    edge_id: "EDGE-NVIDIA-TSMC",
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
    source_date: new Date("2026-02-01T00:00:00.000Z"),
    fetched_at: new Date("2026-02-01T00:00:00.000Z"),
    source_adapter_id: "sec-edgar",
    document_type: "10-K",
    subject_name: "NVIDIA",
    object_name: "TSMC",
    relation: "USES_FOUNDRY"
  };
  return [
    {
      ...base,
      evidence_id: "EV-PRIMARY",
      superseded_by: null,
      cite_text: "NVIDIA uses TSMC for wafer fabrication."
    },
    {
      ...base,
      evidence_id: "EV-OLD",
      superseded_by: "EV-PRIMARY",
      cite_text: "Older evidence for the same foundry relationship."
    }
  ];
}
