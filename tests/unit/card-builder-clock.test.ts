import type pg from "pg";
import { describe, expect, it } from "vitest";
import { loadComponentCard } from "@supplystrata/card-builder";
import type { DbClient } from "@supplystrata/db/read";

interface QueryCall {
  sql: string;
  params: readonly unknown[];
}

class CardBuilderClockClient implements DbClient {
  readonly calls: QueryCall[] = [];

  async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    return {
      command: "MOCK",
      rowCount: 0,
      oid: 0,
      fields: [],
      rows: rowsForCardBuilder<T>(sql)
    };
  }
}

describe("card-builder clock input", () => {
  it("uses explicit computedAt when deriving edge freshness for cards", async () => {
    const client = new CardBuilderClockClient();

    const card = await loadComponentCard(client, "COMP-MEMORY", { computedAt: "2026-05-23T00:00:00.000Z" });

    const edge = card.evidence_edges[0];
    if (edge === undefined) throw new Error("Expected fixture component card to include one evidence edge");
    if (edge.intelligence === undefined) throw new Error("Expected fixture component edge to include intelligence summary");
    expect(edge.intelligence.freshness).toMatchObject({
      last_verified_at: "2026-02-25T00:00:00.000Z",
      age_days: 87,
      freshness_score: 1
    });
    expect(client.calls.find((call) => call.sql.includes("FROM edge_freshness"))?.params).toEqual([["EDGE-MEMORY"]]);
    expect(client.calls.find((call) => call.sql.includes("FROM edges") && call.sql.includes("last_verified_at"))?.params).toEqual([["EDGE-MEMORY"]]);
  });
});

function rowsForCardBuilder<T extends pg.QueryResultRow>(sql: string): T[] {
  if (sql.includes("FROM components")) {
    return [
      {
        component_id: "COMP-MEMORY",
        name: "memory",
        taxonomy_path: ["semiconductor", "memory"],
        aliases: ["DRAM/HBM"]
      }
    ] as unknown as T[];
  }
  if (sql.includes("FROM edges e") && sql.includes("e.validity = 'current'")) {
    return [
      {
        edge_id: "EDGE-MEMORY",
        relation: "BUYS_FROM",
        subject_id: "ENT-NVIDIA",
        subject_name: "NVIDIA",
        object_id: "ENT-SKHYNIX",
        object_name: "SK Hynix",
        evidence_level: 5,
        confidence: 0.94,
        is_inferred: false,
        primary_evidence_id: "EV-MEMORY",
        cite_text: "NVIDIA purchases memory from SK Hynix.",
        source_url: "https://example.com/filing",
        source_date: new Date("2026-02-25T00:00:00.000Z")
      }
    ] as unknown as T[];
  }
  if (sql.includes("FROM edge_strength_estimates") || sql.includes("FROM edge_freshness")) return [] as T[];
  if (sql.includes("FROM edges") && sql.includes("last_verified_at")) {
    return [
      {
        edge_id: "EDGE-MEMORY",
        last_verified_at: new Date("2026-02-25T00:00:00.000Z"),
        primary_evidence_id: "EV-MEMORY"
      }
    ] as unknown as T[];
  }
  return [] as T[];
}
