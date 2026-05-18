import { describe, expect, it } from "vitest";
import { buildWorkbenchModel, workbenchEdgeFromSegment } from "@supplystrata/workbench-export";
import type { ChainViewSegmentModel } from "@supplystrata/chain-view";
import type pg from "pg";
import type { DbClient } from "@supplystrata/db";

interface QueryCall {
  sql: string;
  params: readonly unknown[];
}

class WorkbenchDbClient implements DbClient {
  constructor(private readonly includeEdgeEvidence: boolean = false) {}

  readonly calls: QueryCall[] = [];

  async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    return {
      command: "MOCK",
      rowCount: 0,
      oid: 0,
      fields: [],
      rows: rowsForWorkbench<T>(sql, params, { includeEdgeEvidence: this.includeEdgeEvidence })
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

    const model = await buildWorkbenchModel(client, { company: "nvidia", depth: 1, draftClaimLimit: 5 });

    expect(model.edges).toHaveLength(0);
    expect(model.draft_claims).toHaveLength(1);
    expect(model.draft_claims[0]?.status).toBe("draft");
    expect(model.chain_segments.some((segment) => segment.claim_id === model.draft_claims[0]?.claim_id)).toBe(false);
    expect(client.calls.some((call) => call.sql.includes("WHERE status = 'draft'"))).toBe(true);
  });

  it("exports all evidence attached to chain edges, including superseded evidence", async () => {
    const client = new WorkbenchDbClient(true);

    const model = await buildWorkbenchModel(client, { company: "nvidia", depth: 1 });

    expect(model.edges).toHaveLength(1);
    expect(model.edges[0]?.evidence_ids).toEqual(["EV-PRIMARY"]);
    expect(model.evidences.map((item) => item.evidence_id)).toEqual(["EV-PRIMARY", "EV-OLD"]);
    expect(model.evidences[1]?.superseded_by).toBe("EV-PRIMARY");
  });
});

function rowsForWorkbench<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[], input: { includeEdgeEvidence: boolean }): T[] {
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
  if (sql.includes("FROM claims") && sql.includes("WHERE status = 'draft'")) {
    expect(sql).toContain("(subject_id = $1 OR object_id = $1)");
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
