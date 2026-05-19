import type pg from "pg";
import { describe, expect, it } from "vitest";
import {
  inferEdgeStrengthDrafts,
  listRefreshableComponentRiskComponentIds,
  recordEdgeCalibrationLabel,
  refreshAlertCandidates,
  refreshEdgeCalibrationRun,
  refreshComponentRiskView,
  refreshEdgeIntelligenceContext,
  refreshFinancialMetricPeerComparisonViews,
  refreshObservationAnomalyViews
} from "@supplystrata/evidence-maintenance";
import type { DbClient } from "@supplystrata/db";

interface QueryCall {
  sql: string;
  params: readonly unknown[];
}

class IntelligenceDbClient implements DbClient {
  readonly calls: QueryCall[] = [];

  async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    const rows = rowsForIntelligence<T>(sql, params);
    return {
      command: "MOCK",
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows
    };
  }
}

class ComponentRiskDbClient implements DbClient {
  readonly calls: QueryCall[] = [];

  async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    const rows = rowsForComponentRisk<T>(sql, params);
    return {
      command: "MOCK",
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows
    };
  }
}

class ComponentRiskCentralityDbClient implements DbClient {
  readonly calls: QueryCall[] = [];

  async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    const rows = rowsForComponentRiskCentrality<T>(sql, params);
    return {
      command: "MOCK",
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows
    };
  }
}

class ComponentRiskChangeDbClient implements DbClient {
  readonly calls: QueryCall[] = [];

  async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    const rows = rowsForComponentRiskChange<T>(sql, params);
    return {
      command: "MOCK",
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows
    };
  }
}

class ObservationAnomalyDbClient implements DbClient {
  readonly calls: QueryCall[] = [];

  async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    const rows = rowsForObservationAnomaly<T>(sql, params);
    return {
      command: "MOCK",
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows
    };
  }
}

class FinancialPeerComparisonDbClient implements DbClient {
  readonly calls: QueryCall[] = [];

  async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    const rows = rowsForFinancialPeerComparison<T>(sql, params);
    return {
      command: "MOCK",
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows
    };
  }
}

class AlertRulesDbClient implements DbClient {
  readonly calls: QueryCall[] = [];

  async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    const rows = rowsForAlertRules<T>(sql, params);
    return {
      command: "MOCK",
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows
    };
  }
}

class EdgeCalibrationDbClient implements DbClient {
  readonly calls: QueryCall[] = [];

  async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    const rows = rowsForEdgeCalibration<T>(sql, params);
    return {
      command: "MOCK",
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows
    };
  }
}

describe("evidence-maintenance intelligence refresh", () => {
  it("infers only explicit, named relationship strength from cite text", () => {
    expect(
      inferEdgeStrengthDrafts({
        object_name: "TSMC",
        cite_text: "We have long-term wafer supply agreements and capacity reservations with TSMC for semiconductor wafers."
      }).map((draft) => draft.strength_kind)
    ).toEqual(["capacity"]);

    expect(
      inferEdgeStrengthDrafts({
        object_name: "ASML",
        cite_text: "We depend on ASML as a sole supplier for lithography systems used in advanced semiconductor manufacturing."
      })
    ).toMatchObject([{ strength_kind: "dependency", value: "1" }]);

    expect(
      inferEdgeStrengthDrafts({
        object_name: "Microsoft",
        cite_text: "Sales to Microsoft accounted for 18% of our total revenue from GPU products during fiscal 2026."
      })
    ).toMatchObject([{ strength_kind: "share", value: "18", unit: "percent" }]);

    expect(
      inferEdgeStrengthDrafts({
        object_name: "Microsoft",
        cite_text: "One customer accounted for 21% of total revenue in fiscal 2026."
      })
    ).toEqual([]);
  });

  it("refreshes freshness, upserts deterministic strengths, and creates explicit unknowns without touching fact edges", async () => {
    const client = new IntelligenceDbClient();

    const summary = await refreshEdgeIntelligenceContext(client, {
      min_evidence_level: 4,
      limit: 10,
      computed_at: "2026-05-19T00:00:00.000Z",
      generated_by: "unit-test"
    });

    expect(summary).toMatchObject({
      scanned: 2,
      freshness_refreshed: 2,
      strengths_upserted: 1,
      edges_with_strength: 1,
      unknowns_inserted: 1,
      unknowns_updated: 0,
      generated_by: "unit-test"
    });
    expect(client.calls[0]?.sql).toContain("JOIN evidence ev ON ev.evidence_id = e.primary_evidence_id");
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO edge_freshness"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO edge_strength_estimates"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO unknown_items"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO edges"))).toBe(false);
  });

  it("lists only components with auditable fact edges for risk refresh", async () => {
    const client = new ComponentRiskDbClient();

    const componentIds = await listRefreshableComponentRiskComponentIds(client, ["COMP-PCB", "COMP-MEMORY", " "]);

    expect(componentIds).toEqual(["COMP-MEMORY"]);
    expect(client.calls[0]?.params).toEqual([["COMP-MEMORY", "COMP-PCB"]]);
  });

  it("computes deterministic component risk baseline from strength and freshness without mutating fact edges", async () => {
    const firstClient = new ComponentRiskDbClient();
    const secondClient = new ComponentRiskDbClient();

    const firstSummary = await refreshComponentRiskView(firstClient, {
      component_id: "COMP-MEMORY",
      computed_at: "2026-05-19T00:00:00.000Z",
      generated_by: "unit-test"
    });
    const secondSummary = await refreshComponentRiskView(secondClient, {
      component_id: "COMP-MEMORY",
      computed_at: "2026-05-19T00:00:00.000Z",
      generated_by: "unit-test"
    });

    expect(firstSummary).toMatchObject({
      component_id: "COMP-MEMORY",
      metrics: 9,
      edge_count: 2,
      supplier_count: 2,
      share_unknown: true,
      model_version: "component-risk-baseline.v1"
    });
    expect(firstSummary.risk_view_id).toBe(secondSummary.risk_view_id);
    expect(firstSummary.inputs_fingerprint).toBe(secondSummary.inputs_fingerprint);

    const riskMetricInserts = firstClient.calls.filter((call) => call.sql.includes("INSERT INTO risk_metrics"));
    expect(riskMetricInserts).toHaveLength(9);
    expect(riskMetricInserts.some((call) => call.params[2] === "supplier_concentration_hhi" && call.params[6] === null)).toBe(true);
    expect(riskMetricInserts.some((call) => call.params[2] === "single_source_exposure" && call.params[6] === "1")).toBe(true);
    expect(riskMetricInserts.some((call) => call.params[2] === "path_redundancy" && call.params[6] === "1")).toBe(true);
    expect(riskMetricInserts.filter((call) => call.params[2] === "node_knockout_reach" && call.params[6] === "1")).toHaveLength(2);
    expect(
      riskMetricInserts.some((call) => call.params[2] === "node_knockout_weighted_impact" && call.params[4] === "ENT-SKHYNIX" && call.params[6] === "0.200000")
    ).toBe(true);
    expect(
      riskMetricInserts.some((call) => call.params[2] === "node_knockout_weighted_impact" && call.params[4] === "ENT-MICRON" && call.params[6] === "0.250000")
    ).toBe(true);
    expect(riskMetricInserts.some((call) => call.params[2] === "freshness_adjusted_exposure" && call.params[6] === "0.250000")).toBe(true);
    expect(firstClient.calls.some((call) => call.sql.includes("INSERT INTO edges"))).toBe(false);
  });

  it("computes directed betweenness centrality for component fact-edge bottlenecks", async () => {
    const client = new ComponentRiskCentralityDbClient();

    const summary = await refreshComponentRiskView(client, {
      component_id: "COMP-ACCELERATOR",
      computed_at: "2026-05-19T00:00:00.000Z",
      generated_by: "unit-test"
    });

    expect(summary).toMatchObject({
      component_id: "COMP-ACCELERATOR",
      metrics: 10,
      edge_count: 2,
      supplier_count: 2
    });
    const riskMetricInserts = client.calls.filter((call) => call.sql.includes("INSERT INTO risk_metrics"));
    expect(riskMetricInserts).toHaveLength(10);
    expect(riskMetricInserts.some((call) => call.params[2] === "node_knockout_reach" && call.params[4] === "ENT-TSMC" && call.params[6] === "2")).toBe(true);
    expect(
      riskMetricInserts.some((call) => call.params[2] === "node_knockout_weighted_impact" && call.params[4] === "ENT-TSMC" && call.params[6] === "1.440000")
    ).toBe(true);
    expect(
      riskMetricInserts.some((call) => call.params[2] === "betweenness_centrality" && call.params[4] === "ENT-OSAT" && call.params[6] === "0.500000")
    ).toBe(true);
    expect(riskMetricInserts.every((call) => call.params[2] !== "betweenness_centrality" || call.params[7] === 0.85)).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO edges"))).toBe(false);
  });

  it("records auditable component risk metric changes when the new baseline materially differs", async () => {
    const client = new ComponentRiskChangeDbClient();

    const summary = await refreshComponentRiskView(client, {
      component_id: "COMP-MEMORY",
      computed_at: "2026-05-19T00:00:00.000Z",
      generated_by: "unit-test"
    });

    expect(summary.risk_changes_recorded).toBe(1);
    const semanticChangeInserts = client.calls.filter((call) => call.sql.includes("INSERT INTO change_records"));
    expect(semanticChangeInserts).toHaveLength(1);
    expect(semanticChangeInserts[0]?.params[1]).toBe("risk_metric");
    expect(semanticChangeInserts[0]?.params[3]).toBe("RISK_METRIC_CHANGED");
    expect(semanticChangeInserts[0]?.params[7]).toBe("unit-test");
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO edges"))).toBe(false);
  });

  it("refreshes observation anomaly views from explicit baselines and comparable history without mutating fact edges", async () => {
    const client = new ObservationAnomalyDbClient();

    const summary = await refreshObservationAnomalyViews(client, {
      limit: 25,
      threshold_percent: 25,
      z_threshold: 3.5,
      history_periods: 12,
      min_history_points: 5,
      computed_at: "2026-05-19T00:00:00.000Z",
      generated_by: "unit-test"
    });

    expect(summary).toMatchObject({
      scanned: 3,
      evaluated: 3,
      anomalies: 2,
      risk_views_refreshed: 3,
      threshold_percent: 25,
      z_threshold: 3.5,
      explicit_baseline_evaluated: 2,
      time_series_evaluated: 1,
      semantic_changes_recorded: 2,
      generated_by: "unit-test"
    });

    const riskMetricInserts = client.calls.filter((call) => call.sql.includes("INSERT INTO risk_metrics"));
    expect(riskMetricInserts).toHaveLength(3);
    expect(riskMetricInserts.every((call) => call.params[2] === "observation_anomaly")).toBe(true);
    expect(riskMetricInserts.some((call) => call.params[4] === "OBS-ANOMALY" && call.params[6] === "42.000000")).toBe(true);
    expect(riskMetricInserts.some((call) => call.params[4] === "OBS-NORMAL" && call.params[6] === "5.000000")).toBe(true);
    expect(riskMetricInserts.some((call) => call.params[4] === "OBS-SPIKE" && call.params[6] === "8.000000")).toBe(true);
    const semanticChangeInserts = client.calls.filter((call) => call.sql.includes("INSERT INTO change_records"));
    expect(semanticChangeInserts).toHaveLength(2);
    expect(semanticChangeInserts.every((call) => call.params[3] === "OBSERVATION_ANOMALY")).toBe(true);
    expect(semanticChangeInserts.some((call) => matchesObservationAnomalyAfter(call.params[5], "component", "COMP-MEMORY"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO edges"))).toBe(false);
  });

  it("computes same-period financial peer comparison metrics without mutating fact edges", async () => {
    const client = new FinancialPeerComparisonDbClient();

    const summary = await refreshFinancialMetricPeerComparisonViews(client, {
      limit: 50,
      min_peer_count: 3,
      computed_at: "2026-05-19T00:00:00.000Z",
      generated_by: "unit-test"
    });

    expect(summary).toMatchObject({
      scanned: 6,
      groups_considered: 2,
      groups_evaluated: 1,
      metrics_written: 4,
      min_peer_count: 3,
      risk_views_refreshed: 1,
      generated_by: "unit-test"
    });

    const riskMetricInserts = client.calls.filter((call) => call.sql.includes("INSERT INTO risk_metrics"));
    expect(riskMetricInserts).toHaveLength(4);
    expect(riskMetricInserts.every((call) => call.params[2] === "financial_metric_peer_zscore")).toBe(true);
    expect(riskMetricInserts.some((call) => call.params[4] === "ENT-NVIDIA" && call.params[6] === "0.447214")).toBe(true);
    expect(riskMetricInserts.some((call) => call.params[4] === "ENT-AMD" && call.params[6] === "-1.341641")).toBe(true);
    expect(riskMetricInserts.some((call) => call.params[4] === "ENT-INTEL" && call.params[6] === "1.341641")).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO edges"))).toBe(false);
  });

  it("refreshes deterministic alert candidates from existing derived events without touching fact edges", async () => {
    const client = new AlertRulesDbClient();

    const summary = await refreshAlertCandidates(client, {
      since: "2026-05-01T00:00:00.000Z",
      limit: 50,
      generated_by: "unit-test"
    });

    expect(summary).toMatchObject({
      scanned: 3,
      upserted: 3,
      inserted: 3,
      updated: 0,
      observation_anomaly_alerts: 1,
      source_failure_alerts: 1,
      component_risk_alerts: 1,
      generated_by: "unit-test"
    });
    const alertInserts = client.calls.filter((call) => call.sql.includes("INSERT INTO alert_candidates"));
    expect(alertInserts).toHaveLength(3);
    expect(alertInserts.some((call) => call.params[1] === "observation_anomaly" && call.params[9] === "RSK-OBS-1")).toBe(true);
    expect(alertInserts.some((call) => call.params[1] === "source_failure" && call.params[13] === "sec-edgar")).toBe(true);
    expect(alertInserts.some((call) => call.params[1] === "component_risk" && call.params[10] === "RKM-SINGLE")).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO edges"))).toBe(false);
  });

  it("computes edge calibration precision and reliability buckets from human labels", async () => {
    const client = new EdgeCalibrationDbClient();

    const label = await recordEdgeCalibrationLabel(client, {
      edge_id: "EDGE-BAD",
      evidence_id: "EV-BAD",
      label: "incorrect",
      error_category: "semantic_misread",
      reviewer: "unit-test",
      reviewed_at: "2026-05-19T00:00:00.000Z",
      rationale: "The cited paragraph names a generic supplier, not the edge counterparty."
    });
    const summary = await refreshEdgeCalibrationRun(client, {
      min_evidence_level: 4,
      limit: 10,
      generated_at: "2026-05-19T00:05:00.000Z",
      generated_by: "unit-test"
    });

    expect(label.label_id).toBe("CAL-LABEL-EDGE-BAD");
    expect(summary).toMatchObject({
      sample_size: 3,
      evaluated_count: 2,
      correct_count: 1,
      incorrect_count: 1,
      uncertain_count: 1,
      precision: 0.5,
      error_summary: { semantic_misread: 1 },
      model_version: "edge-calibration-baseline.v1"
    });
    expect(summary.reliability_buckets).toEqual([
      {
        bucket: "0.7-0.8",
        sample_size: 1,
        evaluated_count: 0,
        correct_count: 0,
        incorrect_count: 0,
        uncertain_count: 1,
        average_confidence: 0.72
      },
      {
        bucket: "0.8-0.9",
        sample_size: 1,
        evaluated_count: 1,
        correct_count: 0,
        incorrect_count: 1,
        uncertain_count: 0,
        average_confidence: 0.84,
        empirical_precision: 0
      },
      {
        bucket: "0.9-1.0",
        sample_size: 1,
        evaluated_count: 1,
        correct_count: 1,
        incorrect_count: 0,
        uncertain_count: 0,
        average_confidence: 0.93,
        empirical_precision: 1
      }
    ]);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO edge_calibration_runs"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO edge_calibration_run_items"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO edges"))).toBe(false);
  });
});

function rowsForIntelligence<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[]): T[] {
  if (sql.includes("FROM edges e") && sql.includes("JOIN evidence ev ON ev.evidence_id = e.primary_evidence_id")) {
    expect(params).toEqual([4, 10]);
    return [
      {
        edge_id: "EDGE-CAPACITY",
        subject_id: "ENT-NVIDIA",
        subject_name: "NVIDIA",
        object_id: "ENT-TSMC",
        object_name: "TSMC",
        relation: "USES_FOUNDRY",
        component: "wafer",
        component_id: "COMP-WAFER",
        evidence_level: 5,
        primary_evidence_id: "EV-CAPACITY",
        cite_text: "We have long-term wafer supply agreements and capacity reservations with TSMC for semiconductor wafers.",
        source_date: new Date("2026-02-01T00:00:00.000Z")
      },
      {
        edge_id: "EDGE-UNKNOWN",
        subject_id: "ENT-NVIDIA",
        subject_name: "NVIDIA",
        object_id: "ENT-SKHYNIX",
        object_name: "SK hynix",
        relation: "BUYS_FROM",
        component: "memory",
        component_id: "COMP-MEMORY",
        evidence_level: 5,
        primary_evidence_id: "EV-UNKNOWN",
        cite_text: "We purchase memory products from SK hynix.",
        source_date: new Date("2026-02-01T00:00:00.000Z")
      }
    ] as unknown as T[];
  }

  if (sql.includes("SELECT edge_id, last_verified_at, primary_evidence_id")) {
    return [
      { edge_id: "EDGE-CAPACITY", last_verified_at: new Date("2026-02-01T00:00:00.000Z"), primary_evidence_id: "EV-CAPACITY" },
      { edge_id: "EDGE-UNKNOWN", last_verified_at: new Date("2026-02-01T00:00:00.000Z"), primary_evidence_id: "EV-UNKNOWN" }
    ] as unknown as T[];
  }

  if (sql.includes("RETURNING edge_id, last_verified_at, decay_model")) {
    return [
      {
        edge_id: params[0],
        last_verified_at: params[1],
        decay_model: params[2],
        age_days: params[3],
        freshness_score: params[4],
        computed_at: params[5],
        source_evidence_id: params[6],
        attrs: {}
      }
    ] as unknown as T[];
  }

  if (sql.includes("FROM edge_strength_estimates")) {
    return [] as T[];
  }

  if (sql.includes("RETURNING strength_id, edge_id, strength_kind")) {
    return [
      {
        strength_id: params[0],
        edge_id: params[2],
        strength_kind: params[3],
        value: params[4],
        lower_bound: params[5],
        upper_bound: params[6],
        unit: params[7],
        evidence_id: params[8],
        method: params[9],
        valid_from: params[10],
        valid_to: params[11],
        attrs: {}
      }
    ] as unknown as T[];
  }

  if (sql.includes("SELECT unknown_id FROM unknown_items")) return [] as T[];
  return [];
}

function rowsForEdgeCalibration<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[]): T[] {
  if (sql.includes("INSERT INTO edge_calibration_labels")) {
    return [{ label_id: "CAL-LABEL-EDGE-BAD", inserted: true }] as unknown as T[];
  }

  if (sql.includes("FROM edge_calibration_labels labels")) {
    expect(params).toEqual([4, 10]);
    return [
      calibrationSampleRow({
        label_id: "CAL-LABEL-GOOD",
        edge_id: "EDGE-GOOD",
        evidence_id: "EV-GOOD",
        label: "correct",
        error_category: null,
        confidence: 0.93
      }),
      calibrationSampleRow({
        label_id: "CAL-LABEL-BAD",
        edge_id: "EDGE-BAD",
        evidence_id: "EV-BAD",
        label: "incorrect",
        error_category: "semantic_misread",
        confidence: 0.84
      }),
      calibrationSampleRow({
        label_id: "CAL-LABEL-UNCERTAIN",
        edge_id: "EDGE-UNCERTAIN",
        evidence_id: "EV-UNCERTAIN",
        label: "uncertain",
        error_category: null,
        confidence: 0.72
      })
    ] as unknown as T[];
  }

  if (sql.includes("RETURNING run_id")) {
    return [{ run_id: params[0] }] as unknown as T[];
  }

  return [];
}

function calibrationSampleRow(input: {
  label_id: string;
  edge_id: string;
  evidence_id: string;
  label: string;
  error_category: string | null;
  confidence: number;
}): pg.QueryResultRow {
  return {
    label_id: input.label_id,
    edge_id: input.edge_id,
    evidence_id: input.evidence_id,
    label: input.label,
    error_category: input.error_category,
    reviewer: "unit-test",
    reviewed_at: new Date("2026-05-19T00:00:00.000Z"),
    rationale: null,
    subject_id: "ENT-NVIDIA",
    object_id: "ENT-SUPPLIER",
    relation: "BUYS_FROM",
    component_id: "COMP-MEMORY",
    evidence_level: 5,
    confidence: input.confidence,
    is_inferred: false,
    extraction_method: "rule",
    source_adapter_id: "sec-edgar",
    doc_id: `DOC-${input.edge_id}`
  };
}

function rowsForComponentRisk<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[]): T[] {
  if (sql.includes("SELECT DISTINCT e.component_id") && sql.includes("e.component_id = ANY($1::text[])")) {
    expect(params).toEqual([["COMP-MEMORY", "COMP-PCB"]]);
    return [{ component_id: "COMP-MEMORY" }] as unknown as T[];
  }

  if (sql.includes("FROM edges e") && sql.includes("e.component_id = $1") && sql.includes("MANUFACTURES_AT")) {
    expect(params).toEqual(["COMP-MEMORY"]);
    return [
      {
        edge_id: "EDGE-SHARE",
        relation: "BUYS_FROM",
        subject_id: "ENT-NVIDIA",
        subject_name: "NVIDIA",
        object_id: "ENT-SKHYNIX",
        object_name: "SK hynix",
        component_id: "COMP-MEMORY",
        evidence_level: 5,
        confidence: 0.9,
        primary_evidence_id: "EV-SHARE"
      },
      {
        edge_id: "EDGE-UNKNOWN",
        relation: "BUYS_FROM",
        subject_id: "ENT-NVIDIA",
        subject_name: "NVIDIA",
        object_id: "ENT-MICRON",
        object_name: "Micron",
        component_id: "COMP-MEMORY",
        evidence_level: 5,
        confidence: 0.8,
        primary_evidence_id: "EV-UNKNOWN"
      }
    ] as unknown as T[];
  }

  if (sql.includes("FROM edge_strength_estimates")) {
    return [
      {
        strength_id: "STR-SHARE",
        edge_id: "EDGE-SHARE",
        strength_kind: "share",
        value: "25",
        lower_bound: null,
        upper_bound: null,
        unit: "percent",
        evidence_id: "EV-SHARE",
        method: "unit-test.share",
        valid_from: null,
        valid_to: null,
        attrs: {}
      },
      {
        strength_id: "STR-DEP",
        edge_id: "EDGE-UNKNOWN",
        strength_kind: "dependency",
        value: "1",
        lower_bound: null,
        upper_bound: null,
        unit: "dependency_index",
        evidence_id: "EV-UNKNOWN",
        method: "unit-test.dependency",
        valid_from: null,
        valid_to: null,
        attrs: { dependency_kind: "single_source" }
      }
    ] as unknown as T[];
  }

  if (sql.includes("FROM edge_freshness")) {
    return [
      {
        edge_id: "EDGE-SHARE",
        last_verified_at: new Date("2026-02-01T00:00:00.000Z"),
        decay_model: "methodology.v1",
        age_days: 107,
        freshness_score: 0.8,
        computed_at: new Date("2026-05-19T00:00:00.000Z"),
        source_evidence_id: "EV-SHARE",
        attrs: {}
      },
      {
        edge_id: "EDGE-UNKNOWN",
        last_verified_at: new Date("2024-01-01T00:00:00.000Z"),
        decay_model: "methodology.v1",
        age_days: 869,
        freshness_score: 0.25,
        computed_at: new Date("2026-05-19T00:00:00.000Z"),
        source_evidence_id: "EV-UNKNOWN",
        attrs: {}
      }
    ] as unknown as T[];
  }

  if (sql.includes("RETURNING risk_view_id")) {
    return [{ risk_view_id: params[0] }] as unknown as T[];
  }

  return [];
}

function rowsForComponentRiskCentrality<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[]): T[] {
  if (sql.includes("FROM edges e") && sql.includes("e.component_id = $1") && sql.includes("MANUFACTURES_AT")) {
    expect(params).toEqual(["COMP-ACCELERATOR"]);
    return [
      {
        edge_id: "EDGE-TIER1",
        relation: "BUYS_FROM",
        subject_id: "ENT-NVIDIA",
        subject_name: "NVIDIA",
        object_id: "ENT-OSAT",
        object_name: "OSAT Partner",
        component_id: "COMP-ACCELERATOR",
        evidence_level: 5,
        confidence: 0.9,
        primary_evidence_id: "EV-TIER1"
      },
      {
        edge_id: "EDGE-TIER2",
        relation: "BUYS_FROM",
        subject_id: "ENT-OSAT",
        subject_name: "OSAT Partner",
        object_id: "ENT-TSMC",
        object_name: "TSMC",
        component_id: "COMP-ACCELERATOR",
        evidence_level: 5,
        confidence: 0.85,
        primary_evidence_id: "EV-TIER2"
      }
    ] as unknown as T[];
  }

  if (sql.includes("FROM edge_strength_estimates")) {
    return [
      {
        strength_id: "STR-TIER1-CAPACITY",
        edge_id: "EDGE-TIER1",
        strength_kind: "capacity",
        value: "1",
        lower_bound: null,
        upper_bound: null,
        unit: "capacity_commitment",
        evidence_id: "EV-TIER1",
        method: "unit-test.capacity",
        valid_from: null,
        valid_to: null,
        attrs: {}
      },
      {
        strength_id: "STR-TIER2-CAPACITY",
        edge_id: "EDGE-TIER2",
        strength_kind: "capacity",
        value: "1",
        lower_bound: null,
        upper_bound: null,
        unit: "capacity_commitment",
        evidence_id: "EV-TIER2",
        method: "unit-test.capacity",
        valid_from: null,
        valid_to: null,
        attrs: {}
      }
    ] as unknown as T[];
  }

  if (sql.includes("FROM edge_freshness")) {
    return [
      {
        edge_id: "EDGE-TIER1",
        last_verified_at: new Date("2026-02-01T00:00:00.000Z"),
        decay_model: "methodology.v1",
        age_days: 107,
        freshness_score: 0.8,
        computed_at: new Date("2026-05-19T00:00:00.000Z"),
        source_evidence_id: "EV-TIER1",
        attrs: {}
      },
      {
        edge_id: "EDGE-TIER2",
        last_verified_at: new Date("2026-02-01T00:00:00.000Z"),
        decay_model: "methodology.v1",
        age_days: 107,
        freshness_score: 0.8,
        computed_at: new Date("2026-05-19T00:00:00.000Z"),
        source_evidence_id: "EV-TIER2",
        attrs: {}
      }
    ] as unknown as T[];
  }

  if (sql.includes("RETURNING risk_view_id")) {
    return [{ risk_view_id: params[0] }] as unknown as T[];
  }

  return [];
}

function rowsForComponentRiskChange<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[]): T[] {
  if (sql.includes("FROM risk_views") && sql.includes("WHERE scope_kind = $1 AND scope_id = $2")) {
    expect(params).toEqual(["component", "COMP-MEMORY"]);
    return [
      {
        risk_view_id: "RSK-PREVIOUS",
        scope_kind: "component",
        scope_id: "COMP-MEMORY",
        generated_at: new Date("2026-05-01T00:00:00.000Z"),
        model_version: "component-risk-baseline.v1",
        inputs_fingerprint: "previous-fingerprint",
        summary: {},
        attrs: {}
      }
    ] as unknown as T[];
  }

  if (sql.includes("SELECT metric_id") && sql.includes("FROM risk_metrics") && sql.includes("WHERE risk_view_id = $1")) {
    expect(params).toEqual(["RSK-PREVIOUS"]);
    return [
      riskMetricRow("RKM-PREV-HHI", "supplier_concentration_hhi", "component", "COMP-MEMORY", "COMP-MEMORY", null),
      riskMetricRow("RKM-PREV-SINGLE", "single_source_exposure", "component", "COMP-MEMORY", "COMP-MEMORY", "0"),
      riskMetricRow("RKM-PREV-REDUNDANCY", "path_redundancy", "component", "COMP-MEMORY", "COMP-MEMORY", "1"),
      riskMetricRow("RKM-PREV-KNOCKOUT-1", "node_knockout_reach", "entity", "ENT-SKHYNIX", "COMP-MEMORY", "1"),
      riskMetricRow("RKM-PREV-KNOCKOUT-2", "node_knockout_reach", "entity", "ENT-MICRON", "COMP-MEMORY", "1"),
      riskMetricRow("RKM-PREV-WEIGHTED-KNOCKOUT-1", "node_knockout_weighted_impact", "entity", "ENT-SKHYNIX", "COMP-MEMORY", "0.200000"),
      riskMetricRow("RKM-PREV-WEIGHTED-KNOCKOUT-2", "node_knockout_weighted_impact", "entity", "ENT-MICRON", "COMP-MEMORY", "0.250000"),
      riskMetricRow("RKM-PREV-FRESH-1", "freshness_adjusted_exposure", "edge", "EDGE-SHARE", "COMP-MEMORY", "0.200000"),
      riskMetricRow("RKM-PREV-FRESH-2", "freshness_adjusted_exposure", "edge", "EDGE-UNKNOWN", "COMP-MEMORY", "0.250000")
    ] as unknown as T[];
  }

  if (sql.includes("FROM change_records") && sql.includes("RISK_METRIC_CHANGED")) {
    return [];
  }

  return rowsForComponentRisk<T>(sql, params);
}

function rowsForObservationAnomaly<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[]): T[] {
  if (sql.includes("FROM change_records") && sql.includes("OBSERVATION_ANOMALY")) {
    return [] as T[];
  }

  if (sql.includes("jsonb_to_recordset") && sql.includes("ranked_history")) {
    expect(params[1]).toBe(12);
    expect(params[0]).toBe(JSON.stringify([{ ...historyCandidatePayload("OBS-SPIKE", "2026-06-01T00:00:00.000Z") }]));
    return [
      { candidate_observation_id: "OBS-SPIKE", ...observationRow("OBS-H1", "100", null, null, "2026-04-01T00:00:00.000Z") },
      { candidate_observation_id: "OBS-SPIKE", ...observationRow("OBS-H2", "102", null, null, "2026-03-01T00:00:00.000Z") },
      { candidate_observation_id: "OBS-SPIKE", ...observationRow("OBS-H3", "98", null, null, "2026-02-01T00:00:00.000Z") },
      { candidate_observation_id: "OBS-SPIKE", ...observationRow("OBS-H4", "101", null, null, "2026-01-01T00:00:00.000Z") },
      { candidate_observation_id: "OBS-SPIKE", ...observationRow("OBS-H5", "99", null, null, "2025-12-01T00:00:00.000Z") }
    ] as unknown as T[];
  }

  if (sql.includes("FROM observations") && sql.includes("WHERE metric_value IS NOT NULL")) {
    expect(params).toEqual([25]);
    return [
      {
        observation_id: "OBS-ANOMALY",
        observation_type: "INVENTORY_OBSERVATION",
        source_adapter_id: "unit-test",
        source_item_id: "ITEM-1",
        doc_id: "DOC-1",
        scope_kind: "component",
        scope_id: "COMP-MEMORY",
        geography_kind: null,
        geography_id: null,
        component_id: "COMP-MEMORY",
        metric_name: "inventory_days",
        metric_value: "142",
        metric_unit: "days",
        time_window_start: null,
        time_window_end: new Date("2026-05-01T00:00:00.000Z"),
        baseline_value: "100",
        change_value: "42",
        change_percent: 42,
        confidence: 0.8,
        provenance: { fixture: true },
        attrs: {},
        created_at: new Date("2026-05-01T00:00:00.000Z")
      },
      {
        observation_id: "OBS-NORMAL",
        observation_type: "INVENTORY_OBSERVATION",
        source_adapter_id: "unit-test",
        source_item_id: "ITEM-2",
        doc_id: "DOC-2",
        scope_kind: "component",
        scope_id: "COMP-MEMORY",
        geography_kind: null,
        geography_id: null,
        component_id: "COMP-MEMORY",
        metric_name: "inventory_days",
        metric_value: "105",
        metric_unit: "days",
        time_window_start: null,
        time_window_end: new Date("2026-04-01T00:00:00.000Z"),
        baseline_value: "100",
        change_value: "5",
        change_percent: 5,
        confidence: 0.7,
        provenance: { fixture: true },
        attrs: {},
        created_at: new Date("2026-04-01T00:00:00.000Z")
      },
      {
        observation_id: "OBS-SPIKE",
        observation_type: "INVENTORY_OBSERVATION",
        source_adapter_id: "unit-test",
        source_item_id: "ITEM-3",
        doc_id: "DOC-3",
        scope_kind: "component",
        scope_id: "COMP-MEMORY",
        geography_kind: null,
        geography_id: null,
        component_id: "COMP-MEMORY",
        metric_name: "inventory_days",
        metric_value: "108",
        metric_unit: "days",
        time_window_start: null,
        time_window_end: new Date("2026-06-01T00:00:00.000Z"),
        baseline_value: null,
        change_value: null,
        change_percent: null,
        confidence: 0.75,
        provenance: { fixture: true },
        attrs: {},
        created_at: new Date("2026-06-01T00:00:00.000Z")
      }
    ] as unknown as T[];
  }

  if (sql.includes("RETURNING risk_view_id")) {
    return [{ risk_view_id: params[0] }] as unknown as T[];
  }

  return [];
}

function rowsForFinancialPeerComparison<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[]): T[] {
  if (sql.includes("FROM observations o") && sql.includes("FINANCIAL_METRIC_OBSERVATION")) {
    expect(params).toEqual([50]);
    return [
      financialObservationRow("OBS-FIN-NVIDIA", "ENT-NVIDIA", "NVIDIA", "revenue", "100", "USD", 2026, "FY"),
      financialObservationRow("OBS-FIN-AMD", "ENT-AMD", "AMD", "revenue", "50", "USD", 2026, "FY"),
      financialObservationRow("OBS-FIN-MICRON", "ENT-MICRON", "Micron", "revenue", "75", "USD", 2026, "FY"),
      financialObservationRow("OBS-FIN-INTEL", "ENT-INTEL", "Intel", "revenue", "125", "USD", 2026, "FY"),
      financialObservationRow("OBS-FIN-NVIDIA-CAPEX", "ENT-NVIDIA", "NVIDIA", "capital_expenditures", "10", "USD", 2026, "FY"),
      financialObservationRow("OBS-FIN-AMD-CAPEX", "ENT-AMD", "AMD", "capital_expenditures", "5", "USD", 2026, "FY")
    ] as unknown as T[];
  }

  if (sql.includes("RETURNING risk_view_id")) {
    return [{ risk_view_id: params[0] }] as unknown as T[];
  }

  return [];
}

function rowsForAlertRules<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[]): T[] {
  if (sql.includes("FROM change_records") && sql.includes("OBSERVATION_ANOMALY")) {
    expect(params).toEqual(["2026-05-01T00:00:00.000Z", 50]);
    return [
      {
        change_id: "CHG-OBS-ANOMALY",
        detected_at: new Date("2026-05-19T00:00:00.000Z"),
        observation_id: "OBS-ANOMALY",
        after: {
          risk_view_id: "RSK-OBS-1",
          severity: "high",
          metric_name: "inventory_days"
        }
      }
    ] as unknown as T[];
  }

  if (sql.includes("FROM source_change_events") && sql.includes("SOURCE_FAILED")) {
    expect(params).toEqual(["2026-05-01T00:00:00.000Z", 50]);
    return [
      {
        event_id: "SEV-FAILED",
        detected_at: new Date("2026-05-19T00:05:00.000Z"),
        source_adapter_id: "sec-edgar",
        after: { failure_count: 3, error_message: "rate limited" }
      }
    ] as unknown as T[];
  }

  if (sql.includes("FROM risk_views rv") && sql.includes("JOIN risk_metrics rm")) {
    expect(params).toEqual(["2026-05-01T00:00:00.000Z", 50]);
    return [
      {
        risk_view_id: "RSK-COMP-1",
        generated_at: new Date("2026-05-19T00:10:00.000Z"),
        model_version: "component-risk-baseline.v1",
        metric_id: "RKM-SINGLE",
        metric_kind: "single_source_exposure",
        subject_kind: "component",
        subject_id: "COMP-MEMORY",
        component_id: "COMP-MEMORY",
        value: "1",
        confidence: 0.8,
        attrs: { supplier_count: 1 }
      }
    ] as unknown as T[];
  }

  if (sql.includes("RETURNING alert_id, (xmax = 0) AS inserted")) {
    return [{ alert_id: params[0], inserted: true }] as unknown as T[];
  }

  return [];
}

function riskMetricRow(
  metricId: string,
  metricKind: string,
  subjectKind: string,
  subjectId: string,
  componentId: string | null,
  value: string | null
): pg.QueryResultRow {
  return {
    metric_id: metricId,
    risk_view_id: "RSK-PREVIOUS",
    metric_kind: metricKind,
    subject_kind: subjectKind,
    subject_id: subjectId,
    component_id: componentId,
    value,
    confidence: 0.8,
    provenance: { fixture: true },
    attrs: {}
  };
}

function historyCandidatePayload(observationId: string, anchorAt: string): Record<string, string | null> {
  return {
    observation_id: observationId,
    observation_type: "INVENTORY_OBSERVATION",
    scope_kind: "component",
    scope_id: "COMP-MEMORY",
    metric_name: "inventory_days",
    metric_unit: "days",
    geography_kind: null,
    geography_id: null,
    component_id: "COMP-MEMORY",
    anchor_at: anchorAt
  };
}

function observationRow(
  observationId: string,
  metricValue: string,
  baselineValue: string | null,
  changePercent: number | null,
  timeWindowEnd: string
): pg.QueryResultRow {
  return {
    observation_id: observationId,
    observation_type: "INVENTORY_OBSERVATION",
    source_adapter_id: "unit-test",
    source_item_id: observationId,
    doc_id: `DOC-${observationId}`,
    scope_kind: "component",
    scope_id: "COMP-MEMORY",
    geography_kind: null,
    geography_id: null,
    component_id: "COMP-MEMORY",
    metric_name: "inventory_days",
    metric_value: metricValue,
    metric_unit: "days",
    time_window_start: null,
    time_window_end: new Date(timeWindowEnd),
    baseline_value: baselineValue,
    change_value: null,
    change_percent: changePercent,
    confidence: 0.7,
    provenance: { fixture: true },
    attrs: {},
    created_at: new Date(timeWindowEnd)
  };
}

function financialObservationRow(
  observationId: string,
  scopeId: string,
  companyName: string,
  metricName: string,
  metricValue: string,
  metricUnit: string,
  fiscalYear: number,
  fiscalPeriod: string
): pg.QueryResultRow {
  return {
    observation_id: observationId,
    source_adapter_id: "sec-edgar",
    source_item_id: observationId,
    doc_id: `DOC-${observationId}`,
    scope_kind: "company",
    scope_id: scopeId,
    company_name: companyName,
    metric_name: metricName,
    metric_value: metricValue,
    metric_unit: metricUnit,
    time_window_start: new Date("2025-02-01T00:00:00.000Z"),
    time_window_end: new Date("2026-01-31T00:00:00.000Z"),
    confidence: 0.9,
    provenance: {
      fiscal_year: fiscalYear,
      fiscal_period: fiscalPeriod,
      accession: `ACC-${observationId}`,
      official_structured_source: true
    },
    attrs: {},
    created_at: new Date("2026-03-01T00:00:00.000Z")
  };
}

function matchesObservationAnomalyAfter(value: unknown, scopeKind: string, scopeId: string): boolean {
  if (!isRecord(value)) return false;
  return value["observation_scope_kind"] === scopeKind && value["observation_scope_id"] === scopeId && value["change_percent"] !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
