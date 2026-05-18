import type pg from "pg";
import { describe, expect, it } from "vitest";
import {
  buildClaimDraftFromEdge,
  buildClaimDraftFromSemanticChangeReview,
  buildEdgeClaimsFromCurrentEdges,
  claimTypeForRelation,
  deterministicClaimIdForEdge,
  deterministicClaimIdForSemanticReview,
  upsertSemanticChangeClaimDraft,
  type ClaimableFactEdge
} from "@supplystrata/claim-builder";
import type { DbClient } from "@supplystrata/db";
import { buildSemanticChangeReviewCandidate } from "@supplystrata/review-candidates";

interface QueryCall {
  sql: string;
  params: readonly unknown[];
}

class EmptyDbClient implements DbClient {
  readonly calls: QueryCall[] = [];

  async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    return {
      command: "MOCK",
      rowCount: 0,
      oid: 0,
      fields: [],
      rows: rowsForClaimBuilder<T>(sql, params)
    };
  }
}

describe("claim-builder", () => {
  it("creates stable claim drafts from current fact edges", () => {
    const edge: ClaimableFactEdge = {
      edge_id: "EDGE-1",
      subject_id: "ENT-NVIDIA",
      object_id: "ENT-SK-HYNIX",
      relation: "BUYS_FROM",
      component: "memory",
      component_id: "COMP-MEMORY",
      evidence_level: 5,
      confidence: 0.93,
      is_inferred: false,
      primary_evidence_id: "EV-1",
      last_verified_at: new Date("2026-01-01T00:00:00.000Z"),
      subject_name: "NVIDIA",
      object_name: "SK hynix"
    };

    const draft = buildClaimDraftFromEdge(edge, { generated_by: "unit-test" });

    expect(draft.claim_id).toBe(deterministicClaimIdForEdge("EDGE-1"));
    expect(draft.claim_type).toBe("SUPPLY_RELATION_CLAIM");
    expect(draft.claim_text).toBe("NVIDIA publicly discloses that it buys memory from SK hynix.");
    expect(draft.evidence_id).toBe("EV-1");
    expect(draft.is_inferred).toBe(false);
    expect(draft.last_verified_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("does not create active fact claims from inferred edges", () => {
    const edge: ClaimableFactEdge = {
      edge_id: "EDGE-INF",
      subject_id: "ENT-NVIDIA",
      object_id: "ENT-TSMC",
      relation: "USES_FOUNDRY",
      component: "GPU wafer fabrication",
      component_id: "COMP-WAFER",
      evidence_level: 4,
      confidence: 0.78,
      is_inferred: true,
      primary_evidence_id: "EV-INF",
      last_verified_at: "2026-01-01T00:00:00.000Z",
      subject_name: "NVIDIA",
      object_name: "TSMC"
    };

    expect(() => buildClaimDraftFromEdge(edge)).toThrow(/inferred edge/);
  });

  it("maps relation types without creating new relation semantics", () => {
    expect(claimTypeForRelation("MANUFACTURES_AT")).toBe("FACILITY_RELATION_CLAIM");
    expect(claimTypeForRelation("USES_COMPONENT")).toBe("COMPONENT_EXPOSURE_CLAIM");
    expect(claimTypeForRelation("OWNS_SUBSIDIARY")).toBe("ENTITY_FACT_CLAIM");
    expect(claimTypeForRelation("BUYS_FROM")).toBe("SUPPLY_RELATION_CLAIM");
  });

  it("scans only current non-inferred edges with primary evidence", async () => {
    const client = new EmptyDbClient();

    const summary = await buildEdgeClaimsFromCurrentEdges(client, { min_evidence_level: 5, limit: 25, generated_by: "unit-test" });

    expect(summary).toEqual({ scanned: 0, inserted: 0, updated: 0, generated_by: "unit-test" });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.sql).toContain("e.validity = 'current'");
    expect(client.calls[0]?.sql).toContain("e.is_inferred = false");
    expect(client.calls[0]?.sql).toContain("e.primary_evidence_id IS NOT NULL");
    expect(client.calls[0]?.params).toEqual([5, 25]);
  });

  it("builds draft claims from reviewed semantic changes without creating active fact claims", async () => {
    const candidate = semanticChangeCandidate();

    const draft = buildClaimDraftFromSemanticChangeReview(candidate, {
      generated_by: "unit-test",
      reviewed_at: "2026-05-18T00:00:00.000Z"
    });

    expect(draft).toMatchObject({
      claim_id: deterministicClaimIdForSemanticReview(candidate.review_id),
      claim_type: "RISK_SIGNAL_CLAIM",
      review_id: candidate.review_id,
      status: "draft",
      evidence_level: 3,
      is_inferred: true,
      generated_by: "unit-test",
      last_verified_at: "2026-05-18T00:00:00.000Z"
    });
    expect(draft.claim_text).toContain("draft signal");
    expect(draft.claim_text).toContain("not an active fact edge");
  });

  it("upserts semantic-change claim drafts and records semantic events", async () => {
    const client = new EmptyDbClient();
    const candidate = semanticChangeCandidate();

    const result = await upsertSemanticChangeClaimDraft(client, candidate, {
      generated_by: "unit-test",
      reviewed_at: "2026-05-18T00:00:00.000Z",
      caused_by: "reviewer"
    });

    expect(result).toEqual({ claim_id: deterministicClaimIdForSemanticReview(candidate.review_id), inserted: true });
    expect(client.calls).toHaveLength(4);
    expect(client.calls[0]?.params).toEqual(["nvidia"]);
    expect(client.calls[1]?.params).toEqual(["tsmc"]);
    expect(client.calls[2]?.sql).toContain("INSERT INTO claims");
    expect(client.calls[2]?.sql).toContain("RETURNING claim_id, (xmax = 0) AS inserted");
    expect(client.calls[2]?.params).toContain("ENT-NVIDIA");
    expect(client.calls[2]?.params).toContain("ENT-TSMC");
    expect(client.calls[2]?.params).toContain("COMP-WAFER");
    expect(client.calls[2]?.params).toContain("draft");
    expect(client.calls[2]?.params).toContain(candidate.review_id);
    expect(client.calls[3]?.sql).toContain("INSERT INTO change_records");
    expect(client.calls[3]?.params).toContain("CLAIM_DRAFT_ADDED");
  });
});

function rowsForClaimBuilder<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[]): T[] {
  if (sql.includes("SELECT entity_id FROM entity_master") && params[0] === "nvidia") {
    return [{ entity_id: "ENT-NVIDIA" }] as unknown as T[];
  }
  if (sql.includes("SELECT entity_id FROM entity_master") && params[0] === "tsmc") {
    return [{ entity_id: "ENT-TSMC" }] as unknown as T[];
  }
  if (sql.includes("RETURNING claim_id, (xmax = 0) AS inserted") && typeof params[0] === "string") {
    return [{ claim_id: params[0], inserted: true }] as unknown as T[];
  }
  return [];
}

function semanticChangeCandidate() {
  return buildSemanticChangeReviewCandidate({
    changeType: "PURCHASE_OBLIGATION_CHANGED",
    sourceItemId: "SRCITEM-sec-edgar-nvidia",
    sourceUrl: "https://www.sec.gov/Archives/fixture/nvidia-10q.htm",
    snapshot: {
      doc_id: "DOC-NVIDIA-10Q",
      source_adapter_id: "sec-edgar",
      relation: "BUYS_FROM",
      semantic_relation_kind: "purchase_obligation",
      subject_surface: "nvidia",
      object_surface: "tsmc",
      component_id: "COMP-WAFER",
      component: "wafer",
      component_specificity: "explicit",
      cite_text: "We have purchase obligations with TSMC for wafer capacity.",
      cite_locator: "Item 2",
      fingerprint: "we have purchase obligations with tsmc for wafer capacity",
      extractor_id: "rule.sec.official-supply-chain"
    }
  });
}
