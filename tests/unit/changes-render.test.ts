import { describe, expect, it } from "vitest";
import { renderChangeTimelineItems } from "@supplystrata/render";
import type { ChangeTimelineItem } from "@supplystrata/db";

describe("changes renderer", () => {
  it("renders attention items and normal timeline items separately", () => {
    const markdown = renderChangeTimelineItems(changes(), { format: "markdown", since: "2026-05-01T00:00:00.000Z" });

    expect(markdown).toContain("# Changes since 2026-05-01T00:00:00.000Z");
    expect(markdown).toContain("Requires attention: 2");
    expect(markdown).toContain("## Requires attention");
    expect(markdown).toContain("DOCUMENT_CHANGED DOC-1");
    expect(markdown).toContain("## Timeline");
    expect(markdown).toContain("EDGE_ADDED EDGE-1");
    expect(markdown).toContain("NVIDIA -BUYS_FROM (memory)-> SK Hynix.");
    expect(markdown).toContain("Evidence: EV-1 [Level 5]");
    expect(markdown).toContain("OBSERVATION_ADDED OBS-1");
    expect(markdown).toContain("OBSERVATION_ANOMALY OBS-FIN-1");
    expect(markdown).toContain(
      "Observation inventory for company:ENT-NVIDIA increased 42.00% vs baseline 100; value 142 USD; severity high; method explicit_baseline."
    );
    expect(markdown).toContain("RISK_METRIC_CHANGED supplier_concentration_hhi:component:COMP-MEMORY:COMP-MEMORY");
    expect(markdown).toContain("Risk metric supplier_concentration_hhi:component:COMP-MEMORY:COMP-MEMORY changed by evidence-maintenance.component-risk.v1.");
  });

  it("renders JSON with schema version", () => {
    const json = JSON.parse(renderChangeTimelineItems(changes(), { format: "json", since: "2026-05-01T00:00:00.000Z" })) as {
      schema_version: string;
      changes: ChangeTimelineItem[];
    };

    expect(json.schema_version).toBe("1.0.0");
    expect(json.changes).toHaveLength(5);
    expect(json.changes[0]?.event_type).toBe("DOCUMENT_CHANGED");
  });
});

function changes(): ChangeTimelineItem[] {
  return [
    {
      event_id: "SRC-EVT-1",
      event_family: "source",
      event_type: "DOCUMENT_CHANGED",
      occurred_at: "2026-05-17T01:00:00.000Z",
      source_adapter_id: "sec-edgar",
      doc_id: "DOC-1",
      caused_by: "pipeline",
      requires_attention: true
    },
    {
      event_id: "CHG-1",
      event_family: "graph",
      event_type: "EDGE_ADDED",
      occurred_at: "2026-05-17T00:00:00.000Z",
      scope_kind: "edge",
      scope_id: "EDGE-1",
      edge_id: "EDGE-1",
      evidence_id: "EV-1",
      evidence_level: 5,
      subject_id: "ENT-NVIDIA",
      subject_name: "NVIDIA",
      object_id: "ENT-SKHYNIX",
      object_name: "SK Hynix",
      relation: "BUYS_FROM",
      component: "memory",
      source_adapter_id: "sec-edgar",
      doc_id: "DOC-2",
      caused_by: "review",
      requires_attention: false
    },
    {
      event_id: "CHG-OBS-1",
      event_family: "semantic",
      event_type: "OBSERVATION_ADDED",
      occurred_at: "2026-05-17T00:10:00.000Z",
      scope_kind: "observation",
      scope_id: "OBS-1",
      caused_by: "observation-store",
      requires_attention: false
    },
    {
      event_id: "CHG-OBS-ANOMALY",
      event_family: "semantic",
      event_type: "OBSERVATION_ANOMALY",
      occurred_at: "2026-05-17T00:15:00.000Z",
      scope_kind: "observation",
      scope_id: "OBS-FIN-1",
      observation_scope_kind: "company",
      observation_scope_id: "ENT-NVIDIA",
      source_adapter_id: "sec-edgar",
      doc_id: "DOC-FIN-1",
      metric_name: "inventory",
      metric_value: "142",
      metric_unit: "USD",
      baseline_method: "explicit_baseline",
      baseline_value: "100",
      change_percent: 42,
      anomaly_severity: "high",
      anomaly_direction: "increase",
      caused_by: "evidence-maintenance.observation-anomaly.v1",
      requires_attention: true
    },
    {
      event_id: "CHG-RISK-1",
      event_family: "risk",
      event_type: "RISK_METRIC_CHANGED",
      occurred_at: "2026-05-17T00:20:00.000Z",
      scope_kind: "risk_metric",
      scope_id: "supplier_concentration_hhi:component:COMP-MEMORY:COMP-MEMORY",
      caused_by: "evidence-maintenance.component-risk.v1",
      requires_attention: false
    }
  ];
}
