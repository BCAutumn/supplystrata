import type pg from "pg";
import { describe, expect, it } from "vitest";
import type { DbClient } from "@supplystrata/db";
import {
  deprecateEdge,
  claimDueGraphProjectionJobs,
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
  recordSemanticChange,
  resolveUnknownItem,
  upsertClaim,
  upsertUnknownItem,
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
      rowCount: mockRowsForAtomicUpsert<T>(sql, params).length,
      oid: 0,
      fields: [],
      rows: mockRowsForAtomicUpsert<T>(sql, params)
    };
  }
}

class UnknownResolveDbClient extends RecordingDbClient {
  override async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    return {
      command: "MOCK",
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: sql.includes("RETURNING unknown_id") ? ([{ unknown_id: "UNK-TEST" }] as unknown as T[]) : []
    };
  }
}

class EdgeDeprecationDbClient extends RecordingDbClient {
  override async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    return {
      command: "MOCK",
      rowCount: sql.includes("UPDATE edges") ? 1 : 0,
      oid: 0,
      fields: [],
      rows: sql.includes("RETURNING edge_id")
        ? ([
            {
              edge_id: "EDGE-TEST",
              subject_id: "ENT-NVIDIA",
              object_id: "ENT-SK-HYNIX",
              relation: "BUYS_FROM",
              component: "memory",
              component_id: "COMP-MEMORY",
              primary_evidence_id: "EV-TEST"
            }
          ] as unknown as T[])
        : []
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
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.sql).toContain("ON CONFLICT (claim_id) DO UPDATE");
    expect(client.calls[0]?.sql).toContain("RETURNING claim_id, (xmax = 0) AS inserted");
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

  it("records semantic changes without touching fact edges", async () => {
    const client = new RecordingDbClient();

    const change = await recordSemanticChange(client, {
      scope_kind: "observation",
      scope_id: "OBS-TEST",
      change_type: "OBSERVATION_ADDED",
      after: { observation_type: "TRADE_FLOW_OBSERVATION" },
      caused_by: "unit-test"
    });

    expect(change.change_id).toMatch(/^CHG-/);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.sql).toContain("INSERT INTO change_records");
    expect(client.calls[0]?.params).toContain("OBSERVATION_ADDED");
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO edges"))).toBe(false);
  });

  it("deprecates edges through a soft-delete change record", async () => {
    const client = new EdgeDeprecationDbClient();

    const result = await deprecateEdge(client, {
      edge_id: "EDGE-TEST",
      reason: "superseded by reviewed memory edge",
      superseded_by_edge_id: "EDGE-MEMORY",
      caused_by: "unit-test"
    });

    expect(result).toEqual({ edge_id: "EDGE-TEST", primary_evidence_id: "EV-TEST" });
    expect(client.calls[0]?.sql).toContain("UPDATE edges");
    expect(client.calls[0]?.sql).toContain("validity = 'deprecated'");
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO change_records") && call.params.includes("edge_deprecated"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("DELETE FROM edges"))).toBe(false);
  });

  it("upserts and resolves unknown items through semantic changes", async () => {
    const upsertClient = new RecordingDbClient();

    const unknown = await upsertUnknownItem(upsertClient, {
      unknown_id: "UNK-TEST",
      scope_kind: "company",
      scope_id: "ENT-NVIDIA",
      question: "Which exact HBM allocation is public?",
      why_unknown: "Official filings disclose memory suppliers but not customer-specific allocation.",
      blocking_data_sources: ["supplier allocation tables"],
      proxies: ["supplier capex"],
      created_by: "unit-test"
    });

    expect(unknown).toEqual({ unknown_id: "UNK-TEST", inserted: true });
    expect(upsertClient.calls.some((call) => call.sql.includes("INSERT INTO unknown_items"))).toBe(true);
    expect(upsertClient.calls.some((call) => call.sql.includes("INSERT INTO change_records") && call.params.includes("UNKNOWN_ADDED"))).toBe(true);
    expect(upsertClient.calls.some((call) => call.sql.includes("INSERT INTO edges"))).toBe(false);

    const resolveClient = new UnknownResolveDbClient();
    await resolveUnknownItem(resolveClient, { unknown_id: "UNK-TEST", resolved_evidence_ids: ["EV-TEST"], reviewer: "unit-test" });

    expect(resolveClient.calls[0]?.sql).toContain("UPDATE unknown_items");
    expect(resolveClient.calls.some((call) => call.sql.includes("INSERT INTO change_records") && call.params.includes("UNKNOWN_RESOLVED"))).toBe(true);
    expect(resolveClient.calls.some((call) => call.sql.includes("INSERT INTO edges"))).toBe(false);
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

  it("claims graph projection jobs with row locks before retry workers process them", async () => {
    const client = new RecordingDbClient();

    await claimDueGraphProjectionJobs(client, { limit: 25 });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(client.calls[0]?.sql).toContain("SET status = 'in_progress'");
    expect(client.calls[0]?.params).toEqual([25]);
  });
});

function mockRowsForAtomicUpsert<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[]): T[] {
  if (sql.includes("RETURNING claim_id, (xmax = 0) AS inserted") && typeof params[0] === "string") {
    return [{ claim_id: params[0], inserted: true }] as unknown as T[];
  }
  if (sql.includes("RETURNING observation_id, (xmax = 0) AS inserted") && typeof params[0] === "string") {
    return [{ observation_id: params[0], inserted: true }] as unknown as T[];
  }
  if (sql.includes("RETURNING lead_id, (xmax = 0) AS inserted") && typeof params[0] === "string") {
    return [{ lead_id: params[0], inserted: true }] as unknown as T[];
  }
  return [];
}
