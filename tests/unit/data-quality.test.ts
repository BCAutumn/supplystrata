import type pg from "pg";
import { describe, expect, it } from "vitest";
import { dataQualityRules, runDataQualityChecks } from "@supplystrata/data-quality";
import type { DbClient } from "@supplystrata/db/read";

interface QueryCall {
  sql: string;
  params: readonly unknown[];
}

class DataQualityDbClient implements DbClient {
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

describe("data-quality rules", () => {
  it("uses the explicit checkedAt timestamp for reproducible summaries", async () => {
    const client = new DataQualityDbClient();

    const summary = await runDataQualityChecks(client, { checkedAt: "2026-05-23T00:00:00.000Z" });

    expect(summary.checked_at).toBe("2026-05-23T00:00:00.000Z");
    expect(summary.ok).toBe(true);
  });

  it("does not register entity-specific unknown-map checks unless targets are provided", () => {
    expect(dataQualityRules().some((rule) => rule.scope === "entity_specific")).toBe(false);
  });

  it("builds parameterized unknown-map checks for the selected company", async () => {
    const rules = dataQualityRules({
      entity_unknown_map_targets: [{ scope_id: "ENT-ACME", label: "ACME", minimum_open_items: 2 }]
    });
    const rule = rules.find((item) => item.rule_id === "unknown_map.minimum_open_items.ENT-ACME");
    if (rule === undefined) throw new Error("Expected entity unknown-map rule");
    const client = new DataQualityDbClient();

    const issues = await rule.check(client);

    expect(client.calls[0]?.sql).toContain("scope_id = $1");
    expect(client.calls[0]?.params).toEqual(["ENT-ACME"]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      rule_id: "unknown_map.minimum_open_items.ENT-ACME",
      scope_id: "ENT-ACME",
      message: "ACME unknown_map must keep at least 2 open item(s)."
    });
  });
});
