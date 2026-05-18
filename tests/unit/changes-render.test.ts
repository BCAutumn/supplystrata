import { describe, expect, it } from "vitest";
import { renderChangeTimelineItems } from "@supplystrata/render";
import type { ChangeTimelineItem } from "@supplystrata/db";

describe("changes renderer", () => {
  it("renders attention items and normal timeline items separately", () => {
    const markdown = renderChangeTimelineItems(changes(), { format: "markdown", since: "2026-05-01T00:00:00.000Z" });

    expect(markdown).toContain("# Changes since 2026-05-01T00:00:00.000Z");
    expect(markdown).toContain("Requires attention: 1");
    expect(markdown).toContain("## Requires attention");
    expect(markdown).toContain("DOCUMENT_CHANGED DOC-1");
    expect(markdown).toContain("## Timeline");
    expect(markdown).toContain("EDGE_ADDED EDGE-1");
    expect(markdown).toContain("NVIDIA -BUYS_FROM (memory)-> SK Hynix.");
    expect(markdown).toContain("Evidence: EV-1 [Level 5]");
    expect(markdown).toContain("OBSERVATION_ADDED OBS-1");
  });

  it("renders JSON with schema version", () => {
    const json = JSON.parse(renderChangeTimelineItems(changes(), { format: "json", since: "2026-05-01T00:00:00.000Z" })) as {
      schema_version: string;
      changes: ChangeTimelineItem[];
    };

    expect(json.schema_version).toBe("1.0.0");
    expect(json.changes).toHaveLength(3);
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
    }
  ];
}
