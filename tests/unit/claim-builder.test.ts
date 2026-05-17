import type pg from "pg";
import { describe, expect, it } from "vitest";
import {
  buildClaimDraftFromEdge,
  buildEdgeClaimsFromCurrentEdges,
  claimTypeForRelation,
  deterministicClaimIdForEdge,
  type ClaimableFactEdge
} from "@supplystrata/claim-builder";
import type { DbClient } from "@supplystrata/db";

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
      rows: []
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
});
