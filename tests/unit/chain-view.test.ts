import { describe, expect, it } from "vitest";
import {
  segmentFromComponentUpstreamLead,
  segmentFromLead,
  segmentFromObservation,
  segmentFromUnknown,
  segmentsFromFact
} from "@supplystrata/chain-view-builder";
import type { ChainViewRoot } from "@supplystrata/chain-view";
import { listComponentUpstreamLeads } from "@supplystrata/component-context";

describe("chain-view", () => {
  it("keeps fact edges and claims as separate semantic segments", () => {
    const row = {
      depth: 1,
      edge_id: "EDGE-1",
      relation: "BUYS_FROM",
      subject_id: "ENT-NVIDIA",
      subject_name: "NVIDIA",
      object_id: "ENT-SK-HYNIX",
      object_name: "SK hynix",
      upstream_id: "ENT-SK-HYNIX",
      upstream_name: "SK hynix",
      component: "memory",
      component_id: "COMP-MEMORY",
      evidence_level: 5,
      confidence: 0.93,
      primary_evidence_id: "EV-1",
      claim_id: "CLM-1",
      claim_text: "NVIDIA publicly discloses that it buys memory from SK hynix."
    } satisfies Parameters<typeof segmentsFromFact>[0];

    const segments = segmentsFromFact(row, 0);

    expect(segments).toHaveLength(2);
    expect(segments[0]?.semantic_layer).toBe("edge");
    expect(segments[0]?.edge_id).toBe("EDGE-1");
    expect(segments[1]?.semantic_layer).toBe("claim");
    expect(segments[1]?.claim_id).toBe("CLM-1");
    expect(segments[1]?.label).toBe("NVIDIA publicly discloses that it buys memory from SK hynix.");
  });

  it("omits claim segments when no active claim exists for the edge", () => {
    const row = {
      depth: 1,
      edge_id: "EDGE-2",
      relation: "USES_FOUNDRY",
      subject_id: "ENT-NVIDIA",
      subject_name: "NVIDIA",
      object_id: "ENT-TSMC",
      object_name: "TSMC",
      upstream_id: "ENT-TSMC",
      upstream_name: "TSMC",
      component: "GPU wafer fabrication",
      component_id: "COMP-WAFER",
      evidence_level: 5,
      confidence: 0.91,
      primary_evidence_id: "EV-2",
      claim_id: null,
      claim_text: null
    } satisfies Parameters<typeof segmentsFromFact>[0];

    const segments = segmentsFromFact(row, 3);

    expect(segments).toHaveLength(1);
    expect(segments[0]?.sequence_index).toBe(6);
    expect(segments[0]?.semantic_layer).toBe("edge");
  });

  it("creates observation, lead, and unknown segments without evidence levels", () => {
    const root: ChainViewRoot = { kind: "company", id: "ENT-NVIDIA", name: "NVIDIA" };
    const observation = segmentFromObservation(
      {
        observation_id: "OBS-1",
        observation_type: "INVENTORY_OBSERVATION",
        component_id: "COMP-MEMORY",
        metric_name: "inventory_days",
        metric_value: "42",
        metric_unit: "days",
        confidence: 0.7
      },
      { root, sequence_index: 10 }
    );
    const lead = segmentFromLead(
      {
        lead_id: "LEAD-1",
        title: "Potential procurement signal",
        summary: "Needs corroboration.",
        status: "open"
      },
      { root, sequence_index: 11 }
    );
    const unknown = segmentFromUnknown(
      {
        unknown_id: "UNK-1",
        question: "Exact HBM allocation",
        why_unknown: "Private contracts are not public."
      },
      { root, sequence_index: 12 }
    );

    expect(observation.semantic_layer).toBe("observation");
    expect(observation.evidence_level).toBeUndefined();
    expect(observation.to.kind).toBe("component");
    expect(lead.semantic_layer).toBe("lead");
    expect(lead.confidence).toBe(0.25);
    expect(unknown.semantic_layer).toBe("unknown");
    expect(unknown.label).toContain("Private contracts");
  });

  it("creates component upstream lead segments without promoting them to fact edges", () => {
    const row = {
      depth: 1,
      edge_id: "EDGE-3",
      relation: "USES_FOUNDRY",
      subject_id: "ENT-NVIDIA",
      subject_name: "NVIDIA",
      object_id: "ENT-TSMC",
      object_name: "TSMC",
      upstream_id: "ENT-TSMC",
      upstream_name: "TSMC",
      component: "wafer",
      component_id: "COMP-WAFER",
      evidence_level: 5,
      confidence: 0.91,
      primary_evidence_id: "EV-3",
      claim_id: null,
      claim_text: null
    } satisfies Parameters<typeof segmentsFromFact>[0];
    const lead = listComponentUpstreamLeads("COMP-WAFER", 1).find((item) => item.target_id === "COMP-EUV-LITHOGRAPHY");
    if (lead === undefined) throw new Error("expected EUV component lead fixture");

    const segment = segmentFromComponentUpstreamLead(lead, { fact: row, sequence_index: 20 });

    expect(segment.semantic_layer).toBe("lead");
    expect(segment.evidence_level).toBeUndefined();
    expect(segment.from).toMatchObject({ kind: "company", id: "ENT-TSMC" });
    expect(segment.to).toMatchObject({ kind: "component", id: "COMP-EUV-LITHOGRAPHY" });
    expect(segment.label).toContain("Trace advanced wafer production");
    expect(segment.source_hints?.some((hint) => hint.source_id === "asml-ir" && hint.expected_output_layer === "edge")).toBe(true);
    expect(segment.source_hints?.every((hint) => hint.relation_policy !== "lead_only")).toBe(true);
  });
});
