import type pg from "pg";
import { describe, expect, it } from "vitest";
import type { DbClient } from "@supplystrata/db";
import {
  insertChainSegment,
  insertChainSegments,
  insertChainView,
  getChainView,
  getClaim,
  getLeadObservation,
  getObservation,
  insertClaim,
  insertLeadObservation,
  insertObservation,
  upsertClaim,
  linkClaimEvidence,
  linkClaimUnknown,
  listChainSegments,
  listClaimsByScope,
  listLeadObservationsByScope,
  listObservationsByScope
} from "@supplystrata/db";

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

describe("db intelligence-network repositories", () => {
  it("inserts claims and links evidence/unknowns without business inference", async () => {
    const client = new RecordingDbClient();

    const claim = await insertClaim(client, {
      claim_id: "CLM-TEST",
      claim_type: "SUPPLY_RELATION_CLAIM",
      claim_text: "NVIDIA discloses that it buys memory from SK Hynix.",
      subject_id: "ENT-NVIDIA",
      object_id: "ENT-SK-HYNIX",
      component_id: "COMP-MEMORY",
      edge_id: "EDGE-TEST",
      evidence_level: 5,
      confidence: 0.93,
      is_inferred: false,
      generated_by: "unit-test"
    });
    await linkClaimEvidence(client, { claim_id: claim.claim_id, evidence_id: "EV-TEST", role: "primary" });
    await linkClaimUnknown(client, { claim_id: claim.claim_id, unknown_id: "UNK-TEST", role: "boundary" });

    expect(claim.claim_id).toBe("CLM-TEST");
    expect(client.calls).toHaveLength(3);
    expect(client.calls[0]?.sql).toContain("INSERT INTO claims");
    expect(client.calls[0]?.params).toContain("SUPPLY_RELATION_CLAIM");
    expect(client.calls[1]?.sql).toContain("INSERT INTO claim_evidence");
    expect(client.calls[2]?.sql).toContain("INSERT INTO claim_unknowns");
  });

  it("keeps claim scope queries read-only", async () => {
    const client = new RecordingDbClient();

    await getClaim(client, "CLM-TEST");
    await listClaimsByScope(client, { scope: { kind: "entity", id: "ENT-NVIDIA" }, limit: 10 });
    await listClaimsByScope(client, { scope: { kind: "component", id: "COMP-MEMORY" }, includeInactive: true });
    await listClaimsByScope(client, { scope: { kind: "edge", id: "EDGE-TEST" } });

    expect(client.calls).toHaveLength(4);
    expect(client.calls.every((call) => call.sql.trimStart().startsWith("SELECT"))).toBe(true);
  });

  it("upserts claims idempotently for generated claim builders", async () => {
    const client = new RecordingDbClient();

    const claim = await upsertClaim(client, {
      claim_id: "CLM-EDGE-TEST",
      claim_type: "SUPPLY_RELATION_CLAIM",
      claim_text: "NVIDIA publicly discloses that it buys memory from SK Hynix.",
      subject_id: "ENT-NVIDIA",
      object_id: "ENT-SK-HYNIX",
      component_id: "COMP-MEMORY",
      edge_id: "EDGE-TEST",
      evidence_level: 5,
      confidence: 0.93,
      is_inferred: false,
      generated_by: "unit-test"
    });

    expect(claim).toEqual({ claim_id: "CLM-EDGE-TEST", inserted: true });
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]?.sql).toContain("SELECT claim_id FROM claims");
    expect(client.calls[1]?.sql).toContain("ON CONFLICT (claim_id) DO UPDATE");
  });

  it("inserts observations and leads as non-edge records", async () => {
    const client = new RecordingDbClient();

    const observation = await insertObservation(client, {
      observation_id: "OBS-TEST",
      observation_type: "TRADE_FLOW_OBSERVATION",
      source_adapter_id: "un-comtrade",
      scope_kind: "component",
      scope_id: "COMP-HBM",
      component_id: "COMP-HBM",
      metric_name: "monthly_import_value",
      metric_value: "12345.67",
      metric_unit: "USD",
      confidence: 0.72,
      provenance: { table: "fixture" }
    });
    const lead = await insertLeadObservation(client, {
      lead_id: "LEAD-TEST",
      lead_type: "BOL_SINGLE_RECORD",
      source_adapter_id: "manual",
      scope_kind: "company",
      scope_id: "ENT-NVIDIA",
      title: "Potential shipment lead",
      summary: "A single manually reviewed BOL-like record needs corroboration."
    });

    expect(observation.observation_id).toBe("OBS-TEST");
    expect(lead.lead_id).toBe("LEAD-TEST");
    expect(client.calls[0]?.sql).toContain("INSERT INTO observations");
    expect(client.calls[1]?.sql).toContain("INSERT INTO lead_observations");
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO edges"))).toBe(false);
  });

  it("keeps observation and lead scope queries read-only", async () => {
    const client = new RecordingDbClient();

    await getObservation(client, "OBS-TEST");
    await listObservationsByScope(client, { scope_kind: "component", scope_id: "COMP-HBM", observation_type: "TRADE_FLOW_OBSERVATION" });
    await getLeadObservation(client, "LEAD-TEST");
    await listLeadObservationsByScope(client, { scope_kind: "company", scope_id: "ENT-NVIDIA", status: "open" });

    expect(client.calls).toHaveLength(4);
    expect(client.calls.every((call) => call.sql.trimStart().startsWith("SELECT"))).toBe(true);
  });

  it("inserts chain views and layer-specific segments", async () => {
    const client = new RecordingDbClient();

    const view = await insertChainView(client, {
      chain_id: "CHAIN-TEST",
      root_kind: "company",
      root_id: "ENT-NVIDIA",
      view_type: "company_chain",
      title: "NVIDIA supply chain",
      generated_by: "unit-test"
    });
    const segment = await insertChainSegment(client, {
      segment_id: "SEG-TEST",
      chain_id: view.chain_id,
      sequence_index: 0,
      from_kind: "company",
      from_id: "ENT-NVIDIA",
      to_kind: "company",
      to_id: "ENT-SK-HYNIX",
      semantic_layer: "edge",
      edge_id: "EDGE-TEST",
      relation: "BUYS_FROM",
      component_id: "COMP-MEMORY",
      evidence_ids: ["EV-TEST"],
      confidence: 0.93
    });

    expect(segment.segment_id).toBe("SEG-TEST");
    expect(client.calls[0]?.sql).toContain("INSERT INTO chain_views");
    expect(client.calls[1]?.sql).toContain("INSERT INTO chain_segments");
    expect(client.calls[1]?.params).toContain("edge");
    expect(client.calls[1]?.params).toContain("EDGE-TEST");
  });

  it("requires the matching semantic reference for chain segments", async () => {
    const client = new RecordingDbClient();

    await expect(
      insertChainSegment(client, {
        chain_id: "CHAIN-TEST",
        sequence_index: 1,
        from_kind: "component",
        from_id: "COMP-HBM",
        to_kind: "port",
        to_id: "PORT-TEST",
        semantic_layer: "observation"
      })
    ).rejects.toThrow(/observation_id is required/);

    expect(client.calls).toHaveLength(0);
  });

  it("batch inserts chain segments and keeps segment queries read-only", async () => {
    const client = new RecordingDbClient();

    await getChainView(client, "CHAIN-TEST");
    const result = await insertChainSegments(client, [
      {
        chain_id: "CHAIN-TEST",
        sequence_index: 0,
        from_kind: "company",
        from_id: "ENT-NVIDIA",
        to_kind: "company",
        to_id: "ENT-SK-HYNIX",
        semantic_layer: "claim",
        claim_id: "CLM-TEST"
      }
    ]);
    await listChainSegments(client, "CHAIN-TEST");

    expect(result.inserted).toBe(1);
    expect(client.calls[0]?.sql.trimStart().startsWith("SELECT")).toBe(true);
    expect(client.calls[1]?.sql).toContain("INSERT INTO chain_segments");
    expect(client.calls[2]?.sql.trimStart().startsWith("SELECT")).toBe(true);
  });
});
