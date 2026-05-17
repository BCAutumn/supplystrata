import type pg from "pg";
import { describe, expect, it } from "vitest";
import { deterministicLeadId, deterministicObservationId, storeLeadObservation, storeObservation } from "@supplystrata/observation-store";
import type { DbClient } from "@supplystrata/db";

interface QueryCall {
  sql: string;
  params: readonly unknown[];
}

class RecordingDbClient implements DbClient {
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

describe("observation-store", () => {
  it("stores component observations idempotently without writing edges", async () => {
    const client = new RecordingDbClient();
    const input = {
      observation_type: "INVENTORY_OBSERVATION",
      source_adapter_id: "fixture-observation",
      scope_kind: "component",
      scope_id: "COMP-MEMORY",
      component_id: "COMP-MEMORY",
      metric_name: "inventory_days",
      metric_value: "42",
      metric_unit: "days",
      confidence: 0.72,
      provenance: { fixture: true }
    } as const;

    const result = await storeObservation(client, input);

    expect(result).toEqual({ id: deterministicObservationId(input), inserted: true });
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]?.sql).toContain("SELECT observation_id FROM observations");
    expect(client.calls[1]?.sql).toContain("ON CONFLICT (observation_id) DO UPDATE");
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO edges"))).toBe(false);
  });

  it("rejects invalid observation confidence and inverted windows before db writes", async () => {
    const client = new RecordingDbClient();

    await expect(
      storeObservation(client, {
        observation_type: "TRADE_FLOW_OBSERVATION",
        source_adapter_id: "fixture-observation",
        scope_kind: "component",
        scope_id: "COMP-HBM",
        metric_name: "trade_value",
        confidence: 1.2
      })
    ).rejects.toThrow(/confidence/);

    await expect(
      storeObservation(client, {
        observation_type: "TRADE_FLOW_OBSERVATION",
        source_adapter_id: "fixture-observation",
        scope_kind: "component",
        scope_id: "COMP-HBM",
        metric_name: "trade_value",
        time_window_start: "2026-03-01",
        time_window_end: "2026-02-01",
        confidence: 0.5
      })
    ).rejects.toThrow(/time window/);

    expect(client.calls).toHaveLength(0);
  });

  it("stores lead observations as reviewable leads, not facts", async () => {
    const client = new RecordingDbClient();
    const input = {
      lead_type: "PROCUREMENT_SIGNAL",
      source_adapter_id: "fixture-procurement",
      scope_kind: "company",
      scope_id: "ENT-NVIDIA",
      title: "Potential memory-related procurement lead",
      summary: "A fixture procurement signal that requires corroboration before it can affect graph facts.",
      status: "open"
    } as const;

    const result = await storeLeadObservation(client, input);

    expect(result).toEqual({ id: deterministicLeadId(input), inserted: true });
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]?.sql).toContain("SELECT lead_id FROM lead_observations");
    expect(client.calls[1]?.sql).toContain("ON CONFLICT (lead_id) DO UPDATE");
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO edges"))).toBe(false);
  });
});
