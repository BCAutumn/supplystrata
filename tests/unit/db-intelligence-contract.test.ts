import type pg from "pg";
import { describe, expect, it } from "vitest";
import {
  ALERT_KINDS,
  EDGE_CALIBRATION_ERROR_CATEGORIES,
  EDGE_CALIBRATION_LABELS,
  EDGE_FRESHNESS_DECAY_MODELS,
  EDGE_STRENGTH_KINDS,
  OBSERVATION_TYPES,
  RISK_METRIC_KINDS
} from "@supplystrata/core";
import { dbTxClientBrand, type DbClient, type DbTxClient } from "@supplystrata/db";
import { sql as migration0012ObservationTypeContractSql } from "../../packages/db/src/migration-sql/0012_observation_type_contract.js";
import { sql as migration0013EdgeIntelligenceContextSql } from "../../packages/db/src/migration-sql/0013_edge_intelligence_context.js";
import { sql as migration0014RiskViewsSql } from "../../packages/db/src/migration-sql/0014_risk_views.js";
import { sql as migration0015AlertCandidatesSql } from "../../packages/db/src/migration-sql/0015_alert_candidates.js";
import { sql as migration0018EdgeCalibrationSql } from "../../packages/db/src/migration-sql/0018_edge_calibration.js";
import { sql as migration0019RiskMetricKindContractSql } from "../../packages/db/src/migration-sql/0019_risk_metric_kind_contract.js";
import { sql as migration0020WeightedNodeKnockoutMetricSql } from "../../packages/db/src/migration-sql/0020_weighted_node_knockout_metric.js";
import { sql as migration0021FinancialMetricObservationTypeSql } from "../../packages/db/src/migration-sql/0021_financial_metric_observation_type.js";
import { sql as migration0022FinancialPeerMetricKindSql } from "../../packages/db/src/migration-sql/0022_financial_peer_metric_kind.js";
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
  upsertEdgeStrengthEstimate,
  recordSemanticChange,
  resolveUnknownItem,
  upsertClaim,
  upsertLeadObservation,
  upsertObservation,
  upsertUnknownItem,
  linkClaimEvidence,
  linkClaimUnknown,
  listChainSegments,
  listAlertCandidates,
  listClaimsByScope,
  listLeadObservationsByScope,
  listObservationsByScope,
  patchObservationMetadata,
  replaceRiskView,
  updateAlertCandidateStatus,
  upsertAlertCandidate,
  upsertEdgeCalibrationLabel,
  replaceEdgeCalibrationRun
} from "@supplystrata/db";

interface QueryCall {
  sql: string;
  params: readonly unknown[];
}

class RecordingDbClient implements DbTxClient {
  readonly [dbTxClientBrand]: true = true;
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

class ResolvedUnknownUpsertDbClient extends RecordingDbClient {
  override async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    if (sql.includes("SELECT unknown_id FROM unknown_items")) {
      return queryResult([{ unknown_id: "UNK-TEST" }] as unknown as T[]);
    }
    if (sql.includes("RETURNING unknown_id, status, scope_kind, scope_id, question")) {
      return queryResult([
        {
          unknown_id: "UNK-TEST",
          status: "resolved",
          scope_kind: "company",
          scope_id: "ENT-NVIDIA",
          question: "Original resolved question"
        }
      ] as unknown as T[]);
    }
    return queryResult([]);
  }
}

class EdgeDeprecationDbClient extends RecordingDbClient {
  override async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    if (sql.includes("SELECT evidence_id AS id FROM evidence")) {
      return {
        command: "MOCK",
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [{ id: "EV-CONTRA" }] as unknown as T[]
      };
    }
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

class AlertStatusDbClient extends RecordingDbClient {
  override async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    const rows = rowsForAlertStatusUpdate<T>(sql, params);
    return {
      command: "MOCK",
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows
    };
  }
}

describe("db intelligence-network repositories", () => {
  it("keeps DB observation type constraint synchronized with core observation types", () => {
    for (const observationType of OBSERVATION_TYPES) {
      expect(migration0012ObservationTypeContractSql).toContain(`'${observationType}'`);
      expect(migration0021FinancialMetricObservationTypeSql).toContain(`'${observationType}'`);
    }
  });

  it("keeps DB edge intelligence constraints synchronized with core methodology types", () => {
    for (const strengthKind of EDGE_STRENGTH_KINDS) {
      expect(migration0013EdgeIntelligenceContextSql).toContain(`'${strengthKind}'`);
    }
    for (const decayModel of EDGE_FRESHNESS_DECAY_MODELS) {
      expect(migration0013EdgeIntelligenceContextSql).toContain(`'${decayModel}'`);
    }
  });

  it("keeps DB risk metric constraints synchronized with core methodology types", () => {
    for (const metricKind of RISK_METRIC_KINDS) {
      expect(migration0014RiskViewsSql).toContain(`'${metricKind}'`);
      expect(migration0019RiskMetricKindContractSql).toContain(`'${metricKind}'`);
      expect(migration0020WeightedNodeKnockoutMetricSql).toContain(`'${metricKind}'`);
      expect(migration0022FinancialPeerMetricKindSql).toContain(`'${metricKind}'`);
    }
  });

  it("keeps DB alert constraints synchronized with core alert kinds", () => {
    for (const alertKind of ALERT_KINDS) {
      expect(migration0015AlertCandidatesSql).toContain(`'${alertKind}'`);
    }
  });

  it("keeps DB calibration constraints synchronized with core calibration labels", () => {
    for (const label of EDGE_CALIBRATION_LABELS) {
      expect(migration0018EdgeCalibrationSql).toContain(`'${label}'`);
    }
    for (const category of EDGE_CALIBRATION_ERROR_CATEGORIES) {
      expect(migration0018EdgeCalibrationSql).toContain(`'${category}'`);
    }
  });

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

  it("does not resurrect rejected or superseded claims through generated upserts", async () => {
    const client = new RecordingDbClient();

    await upsertClaim(client, {
      claim_id: "CLM-EDGE-TEST",
      claim_type: "SUPPLY_RELATION_CLAIM",
      claim_text: "Generated claim text.",
      subject_id: "ENT-NVIDIA",
      object_id: "ENT-SK-HYNIX",
      edge_id: "EDGE-TEST",
      status: "active",
      evidence_level: 5,
      confidence: 0.93,
      is_inferred: false,
      generated_by: "unit-test"
    });

    expect(client.calls[0]?.sql).toContain("WHEN claims.status IN ('superseded','rejected') THEN claims.status");
  });

  it("does not overwrite rejected or superseded claim content through generated upserts", async () => {
    const client = new RecordingDbClient();

    await upsertClaim(client, {
      claim_id: "CLM-EDGE-TEST",
      claim_type: "SUPPLY_RELATION_CLAIM",
      claim_text: "Generated claim text should not rewrite terminal claims.",
      subject_id: "ENT-NVIDIA",
      object_id: "ENT-SK-HYNIX",
      edge_id: "EDGE-TEST",
      status: "active",
      evidence_level: 5,
      confidence: 0.93,
      is_inferred: false,
      generated_by: "unit-test"
    });

    expect(client.calls[0]?.sql).toContain(
      "claim_text = CASE WHEN claims.status IN ('superseded','rejected') THEN claims.claim_text ELSE EXCLUDED.claim_text END"
    );
    expect(client.calls[0]?.sql).toContain("edge_id = CASE WHEN claims.status IN ('superseded','rejected') THEN claims.edge_id ELSE EXCLUDED.edge_id END");
    expect(client.calls[0]?.sql).toContain(
      "last_verified_at = CASE WHEN claims.status IN ('superseded','rejected') THEN claims.last_verified_at ELSE EXCLUDED.last_verified_at END"
    );
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

  it("reasserts existing observations without mutating measurement or metadata fields", async () => {
    const client = new RecordingDbClient();

    await upsertObservation(client, {
      observation_id: "OBS-TEST",
      observation_type: "FACILITY_PROFILE_OBSERVATION",
      source_adapter_id: "osh",
      scope_kind: "facility",
      scope_id: "FAC-TEST",
      metric_name: "profile_confidence",
      confidence: 0.7,
      provenance: { source: "osh" },
      attrs: { country: "MY" }
    });

    expect(client.calls[0]?.sql).toContain("ON CONFLICT (observation_id) DO UPDATE SET");
    expect(client.calls[0]?.sql).toContain("observation_id = observations.observation_id");
    expect(client.calls[0]?.sql).not.toContain("metric_value = EXCLUDED.metric_value");
    expect(client.calls[0]?.sql).not.toContain("provenance = observations.provenance || EXCLUDED.provenance");
  });

  it("patches observation metadata through an explicit patch entrypoint", async () => {
    const client = new RecordingDbClient();

    await patchObservationMetadata(client, {
      observation_id: "OBS-TEST",
      provenance_patch: { reviewer: "unit-test" },
      attrs_patch: { reviewed: true }
    });

    expect(client.calls[0]?.sql).toContain("UPDATE observations");
    expect(client.calls[0]?.sql).toContain("provenance = provenance || $2::jsonb");
    expect(client.calls[0]?.sql).toContain("attrs = attrs || $3::jsonb");
    expect(client.calls[0]?.params[0]).toBe("OBS-TEST");
  });

  it("does not reopen or rewrite terminal lead observations through ordinary upserts", async () => {
    const client = new RecordingDbClient();

    await upsertLeadObservation(client, {
      lead_id: "LEAD-TEST",
      lead_type: "PROCUREMENT_SIGNAL",
      source_adapter_id: "manual",
      scope_kind: "company",
      scope_id: "ENT-NVIDIA",
      title: "Potential procurement lead",
      summary: "A lead that may already have been promoted.",
      status: "open"
    });

    expect(client.calls[0]?.sql).toContain(
      "title = CASE WHEN lead_observations.status IN ('promoted','rejected','closed') THEN lead_observations.title ELSE EXCLUDED.title END"
    );
    expect(client.calls[0]?.sql).toContain("WHEN lead_observations.status IN ('promoted','rejected','closed') THEN lead_observations.status");
    expect(client.calls[0]?.sql).toContain("WHEN lead_observations.status = 'in_review' AND EXCLUDED.status = 'open' THEN lead_observations.status");
    expect(client.calls[0]?.sql).toContain(
      "attrs = CASE WHEN lead_observations.status IN ('promoted','rejected','closed') THEN lead_observations.attrs ELSE EXCLUDED.attrs END"
    );
  });

  it("upserts edge strength through an explicit business identity key", async () => {
    const client = new RecordingDbClient();

    const strength = await upsertEdgeStrengthEstimate(client, {
      edge_id: "EDGE-TEST",
      strength_kind: "qualitative",
      value: "1",
      evidence_id: "EV-TEST",
      method: "manual-reviewed.v1"
    });

    expect(strength.strength_id).toMatch(/^STR-/);
    expect(strength.edge_id).toBe("EDGE-TEST");
    expect(client.calls[0]?.sql).toContain("identity_key");
    expect(client.calls[0]?.sql).toContain("ON CONFLICT (identity_key)");
    expect(client.calls[0]?.params[1]).toBe("EDGE-TEST\u001Fqualitative\u001FEV-TEST\u001Fmanual-reviewed.v1\u001F\u001F");
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
      source_refs: [{ kind: "evidence", id: "EV-CONTRA" }],
      superseded_by_edge_id: "EDGE-MEMORY",
      caused_by: "unit-test"
    });

    expect(result).toEqual({ edge_id: "EDGE-TEST", primary_evidence_id: "EV-TEST", source_refs: [{ kind: "evidence", id: "EV-CONTRA" }] });
    const updateCall = client.calls.find((call) => call.sql.includes("UPDATE edges"));
    expect(updateCall?.sql).toContain("validity = 'deprecated'");
    expect(updateCall?.sql).toContain("validity = 'current'");
    const changeCall = client.calls.find((call) => call.sql.includes("INSERT INTO change_records"));
    expect(changeCall?.params).toContain("EDGE_DEPRECATED");
    expect(changeCall?.params[5]).toMatchObject({
      validity: "deprecated",
      source_refs: [{ kind: "evidence", id: "EV-CONTRA" }]
    });
    expect(changeCall?.params[6]).toEqual(["EV-CONTRA", "EV-TEST"]);
    expect(client.calls.some((call) => call.sql.includes("DELETE FROM edges"))).toBe(false);
  });

  it("requires an auditable source ref before deprecating an edge", async () => {
    const client = new EdgeDeprecationDbClient();

    await expect(
      deprecateEdge(client, {
        edge_id: "EDGE-TEST",
        reason: "superseded by reviewed memory edge",
        source_refs: [],
        superseded_by_edge_id: "EDGE-MEMORY",
        caused_by: "unit-test"
      })
    ).rejects.toThrow("edge deprecation requires at least one source ref");
    expect(client.calls.some((call) => call.sql.includes("UPDATE edges"))).toBe(false);
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

  it("does not overwrite resolved unknown content on deterministic re-upsert", async () => {
    const client = new ResolvedUnknownUpsertDbClient();

    const unknown = await upsertUnknownItem(client, {
      unknown_id: "UNK-TEST",
      scope_kind: "edge",
      scope_id: "EDGE-NEW",
      question: "New generated question must not replace resolved content",
      why_unknown: "New generated reason",
      blocking_data_sources: ["new source"],
      proxies: ["new proxy"],
      created_by: "unit-test"
    });

    expect(unknown).toEqual({ unknown_id: "UNK-TEST", inserted: false });
    const upsertCall = client.calls.find((call) => call.sql.includes("INSERT INTO unknown_items"));
    expect(upsertCall?.sql).toContain("CASE WHEN unknown_items.status = 'resolved' THEN unknown_items.question ELSE EXCLUDED.question END");
    const changeCall = client.calls.find((call) => call.sql.includes("INSERT INTO change_records"));
    expect(changeCall?.params[3]).toBe("UNKNOWN_REASSERTED_RESOLVED");
    expect(changeCall?.params[5]).toMatchObject({
      scope_kind: "company",
      scope_id: "ENT-NVIDIA",
      question: "Original resolved question",
      status: "resolved"
    });
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

  it("replaces risk view metrics without touching fact edges", async () => {
    const client = new RecordingDbClient();

    const result = await replaceRiskView(client, {
      risk_view_id: "RSK-TEST",
      scope_kind: "component",
      scope_id: "COMP-MEMORY",
      generated_at: "2026-05-19T00:00:00.000Z",
      model_version: "component-risk-baseline.v1",
      inputs_fingerprint: "fingerprint",
      summary: { share_unknown: true },
      metrics: [
        {
          metric_id: "RKM-TEST",
          metric_kind: "supplier_concentration_hhi",
          subject_kind: "component",
          subject_id: "COMP-MEMORY",
          component_id: "COMP-MEMORY",
          confidence: 0,
          provenance: { input_edges: ["EDGE-TEST"] },
          attrs: { share_unknown: true }
        }
      ]
    });

    expect(result).toEqual({ risk_view_id: "RSK-TEST", metrics: 1 });
    expect(client.calls[0]?.sql).toContain("INSERT INTO risk_views");
    expect(client.calls[1]?.sql).toContain("DELETE FROM risk_metrics");
    expect(client.calls[2]?.sql).toContain("INSERT INTO risk_metrics");
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO edges"))).toBe(false);
  });

  it("upserts alert candidates through a dedupe key without touching fact edges", async () => {
    const client = new RecordingDbClient();

    const result = await upsertAlertCandidate(client, {
      alert_id: "ALT-TEST",
      alert_kind: "observation_anomaly",
      severity: "high",
      scope_kind: "observation",
      scope_id: "OBS-TEST",
      title: "Observation anomaly",
      summary: "An observation breached its anomaly rule.",
      dedupe_key: "observation_anomaly:OBS-TEST:RSK-TEST",
      observation_id: "OBS-TEST",
      risk_view_id: "RSK-TEST",
      change_id: "CHG-TEST",
      detected_at: "2026-05-19T00:00:00.000Z",
      provenance: { rule: "unit-test" }
    });

    expect(result).toEqual({ alert_id: "ALT-TEST", inserted: true });
    expect(client.calls[0]?.sql).toContain("INSERT INTO alert_candidates");
    expect(client.calls[0]?.sql).toContain("ON CONFLICT (dedupe_key)");
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO edges"))).toBe(false);
  });

  it("keeps alert candidate queries read-only", async () => {
    const client = new RecordingDbClient();

    await listAlertCandidates(client, { status: "open", limit: 25 });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.sql.trimStart().startsWith("SELECT")).toBe(true);
    expect(client.calls[0]?.params).toEqual(["open", 25]);
  });

  it("updates alert candidate status through an auditable semantic change", async () => {
    const client = new AlertStatusDbClient();

    const result = await updateAlertCandidateStatus(client, {
      alert_id: "ALT-TEST",
      status: "acknowledged",
      reviewer: "unit-test",
      reason: "reviewed in daily monitor"
    });

    expect(result.alert.status).toBe("acknowledged");
    expect(result.changed).toBe(true);
    expect(result.change_id).toMatch(/^CHG-/);
    expect(client.calls[0]?.sql).toContain("FOR UPDATE");
    expect(client.calls[1]?.sql).toContain("UPDATE alert_candidates");
    expect(client.calls[1]?.sql).toContain("last_status_change");
    expect(client.calls[2]?.sql).toContain("INSERT INTO change_records");
    expect(client.calls[2]?.params).toContain("ALERT_STATUS_CHANGED");
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO edges"))).toBe(false);
  });

  it("records edge calibration labels and runs without mutating fact edges", async () => {
    const client = new RecordingDbClient();

    const label = await upsertEdgeCalibrationLabel(client, {
      edge_id: "EDGE-TEST",
      evidence_id: "EV-TEST",
      label: "incorrect",
      error_category: "entity_resolution_error",
      reviewer: "unit-test",
      reviewed_at: "2026-05-19T00:00:00.000Z",
      rationale: "Wrong counterparty."
    });
    const run = await replaceEdgeCalibrationRun(client, {
      run_id: "CAL-RUN-TEST",
      generated_at: "2026-05-19T00:05:00.000Z",
      model_version: "edge-calibration-baseline.v1",
      inputs_fingerprint: "fingerprint",
      min_evidence_level: 4,
      sample_size: 1,
      evaluated_count: 1,
      correct_count: 0,
      incorrect_count: 1,
      uncertain_count: 0,
      precision: 0,
      reliability_buckets: [{ bucket: "0.9-1.0", empirical_precision: 0 }],
      error_summary: { entity_resolution_error: 1 },
      items: [
        {
          label_id: label.label_id,
          edge_id: "EDGE-TEST",
          evidence_id: "EV-TEST",
          evidence_level: 5,
          predicted_confidence: 0.93,
          confidence_bucket: "0.9-1.0",
          label: "incorrect",
          error_category: "entity_resolution_error"
        }
      ]
    });

    expect(label.label_id).toMatch(/^CAL-LABEL-/);
    expect(run).toEqual({ run_id: "CAL-RUN-TEST", items: 1 });
    expect(client.calls[0]?.sql).toContain("INSERT INTO edge_calibration_labels");
    expect(client.calls[1]?.sql).toContain("INSERT INTO edge_calibration_runs");
    expect(client.calls[2]?.sql).toContain("DELETE FROM edge_calibration_run_items");
    expect(client.calls[3]?.sql).toContain("INSERT INTO edge_calibration_run_items");
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO edges"))).toBe(false);
  });
});

function mockRowsForAtomicUpsert<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[]): T[] {
  if (sql.includes("RETURNING claim_id, (xmax = 0) AS inserted") && typeof params[0] === "string") {
    return [{ claim_id: params[0], inserted: true }] as unknown as T[];
  }
  if (sql.includes("RETURNING observation_id, (xmax = 0) AS inserted") && typeof params[0] === "string") {
    return [{ observation_id: params[0], inserted: true }] as unknown as T[];
  }
  if (sql.includes("RETURNING observation_id") && sql.includes("UPDATE observations") && typeof params[0] === "string") {
    return [{ observation_id: params[0] }] as unknown as T[];
  }
  if (sql.includes("RETURNING unknown_id, status, scope_kind, scope_id, question") && typeof params[0] === "string") {
    return [
      {
        unknown_id: params[0],
        status: "open",
        scope_kind: params[1],
        scope_id: params[2],
        question: params[3]
      }
    ] as unknown as T[];
  }
  if (sql.includes("RETURNING lead_id, (xmax = 0) AS inserted") && typeof params[0] === "string") {
    return [{ lead_id: params[0], inserted: true }] as unknown as T[];
  }
  if (sql.includes("RETURNING strength_id") && typeof params[0] === "string") {
    return [
      {
        strength_id: params[0],
        edge_id: "EDGE-TEST",
        strength_kind: "qualitative",
        value: "1",
        lower_bound: null,
        upper_bound: null,
        unit: null,
        evidence_id: "EV-TEST",
        method: "manual-reviewed.v1",
        valid_from: null,
        valid_to: null,
        attrs: {}
      }
    ] as unknown as T[];
  }
  if (sql.includes("RETURNING risk_view_id") && typeof params[0] === "string") {
    return [{ risk_view_id: params[0] }] as unknown as T[];
  }
  if (sql.includes("RETURNING alert_id, (xmax = 0) AS inserted") && typeof params[0] === "string") {
    return [{ alert_id: params[0], inserted: true }] as unknown as T[];
  }
  if (sql.includes("RETURNING label_id, (xmax = 0) AS inserted") && typeof params[0] === "string") {
    return [{ label_id: params[0], inserted: true }] as unknown as T[];
  }
  if (sql.includes("RETURNING run_id") && typeof params[0] === "string") {
    return [{ run_id: params[0] }] as unknown as T[];
  }
  return [];
}

function queryResult<T extends pg.QueryResultRow>(rows: T[]): pg.QueryResult<T> {
  return {
    command: "MOCK",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows
  };
}

function rowsForAlertStatusUpdate<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[]): T[] {
  if (sql.includes("FROM alert_candidates") && sql.includes("FOR UPDATE") && params[0] === "ALT-TEST") {
    return [alertCandidateRow("open")] as unknown as T[];
  }
  if (sql.includes("UPDATE alert_candidates") && params[0] === "ALT-TEST") {
    return [alertCandidateRow("acknowledged")] as unknown as T[];
  }
  return [];
}

function alertCandidateRow(status: "open" | "acknowledged"): pg.QueryResultRow {
  return {
    alert_id: "ALT-TEST",
    alert_kind: "observation_anomaly",
    severity: "high",
    status,
    scope_kind: "observation",
    scope_id: "OBS-TEST",
    title: "Observation anomaly",
    summary: "An observation breached its anomaly rule.",
    dedupe_key: "observation_anomaly:OBS-TEST:RSK-TEST",
    observation_id: "OBS-TEST",
    risk_view_id: "RSK-TEST",
    risk_metric_id: null,
    change_id: "CHG-ANOMALY",
    source_event_id: null,
    source_adapter_id: null,
    detected_at: new Date("2026-05-19T00:00:00.000Z"),
    provenance: { rule: "unit-test" },
    attrs: {}
  };
}
