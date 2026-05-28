import { describe, expect, it } from "vitest";
import type { NormalizedDocument } from "@supplystrata/core";
import { extractDisclosureObservations, extractSemanticSections } from "@supplystrata/observation-extractor";

describe("observation-extractor", () => {
  it("extracts official disclosure observations without creating fact edges", () => {
    const doc = normalizedFixture(
      [
        "Our inventories increased during the year as we purchased memory and HBM components to support customer demand.",
        "Backlog was not a meaningful indicator because lead times vary by product family.",
        "Customer A accounted for 14% of total revenue during fiscal 2026.",
        "We entered into long-term supply agreements and purchase obligations for certain wafer capacity.",
        "Capital expenditures increased as we expanded systems and infrastructure capacity."
      ].join(" ")
    );

    const observations = extractDisclosureObservations(doc);
    const types = observations.map((item) => item.observation_type);

    expect(types).toEqual([
      "INVENTORY_OBSERVATION",
      "BACKLOG_OBSERVATION",
      "CAPEX_OBSERVATION",
      "CUSTOMER_CONCENTRATION_OBSERVATION",
      "PROCUREMENT_OBSERVATION"
    ]);
    expect(observations.every((item) => item.metric_unit === "mention")).toBe(true);
    expect(observations.every((item) => item.source_adapter_id === "sec-edgar-fixture")).toBe(true);
    expect(observations.every((item) => item.time_window_start === "2026-02-24")).toBe(true);
    expect(observations.some((item) => item.scope_kind === "component" && item.scope_id === "COMP-HBM")).toBe(true);
    for (const observation of observations) {
      expect(doc.text).toContain(String(observation.provenance["cite_text"]));
    }
  });

  it("keeps unsupported documents and documents without primary entity out of observation storage", () => {
    expect(extractDisclosureObservations(normalizedFixture("Inventories increased.", { document_type: "company_registry" }))).toEqual([]);
    expect(extractDisclosureObservations(normalizedFixture("Inventories increased.", { primary_entity_id: undefined }))).toEqual([]);
  });

  it("does not treat partner or platform wording as customer concentration", () => {
    const doc = normalizedFixture(
      "We partner with Amazon and integrate with Microsoft platforms while our customers purchase products through multiple channels."
    );

    expect(extractDisclosureObservations(doc).map((item) => item.observation_type)).not.toContain("CUSTOMER_CONCENTRATION_OBSERVATION");
  });

  it("captures supplier-risk disclosure as procurement observation without asserting a supplier edge", () => {
    const doc = normalizedFixture(
      "Our products contain thousands of parts purchased globally from hundreds of suppliers, including single-source direct suppliers, which exposes us to component shortages."
    );

    const observations = extractDisclosureObservations(doc);
    const procurement = observations.find((item) => item.observation_type === "PROCUREMENT_OBSERVATION");

    expect(procurement).toMatchObject({
      scope_kind: "company",
      scope_id: "ENT-NVIDIA",
      metric_name: "official_procurement_commitment_mention",
      metric_unit: "mention"
    });
    expect(procurement?.attrs["title"]).toBe("Official disclosure mentions procurement, supply commitments, or supplier-risk context");
    expect(String(procurement?.provenance["cite_text"])).toContain("single-source direct suppliers");
  });

  it("uses a nearby citation window when web disclosure text is not sentence-delimited", () => {
    const longWebText = [
      "Annual Report Website ".repeat(90),
      "management described capital expenditures for advanced packaging capacity and AI infrastructure",
      " investor navigation ".repeat(90)
    ].join(" ");

    const observations = extractDisclosureObservations(normalizedFixture(longWebText));
    const capex = observations.find((item) => item.observation_type === "CAPEX_OBSERVATION");

    expect(capex?.metric_name).toBe("official_capex_mention");
    expect(String(capex?.provenance["cite_text"])).toContain("capital expenditures for advanced packaging capacity");
  });

  it("extracts deterministic semantic section fingerprints for change detection", () => {
    const doc = normalizedFixture("Customer A accounted for 14% of total revenue during fiscal 2026 and remained a named demand concentration.");

    const sections = extractSemanticSections(doc);

    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({
      section_kind: "customer_concentration",
      observation_type: "CUSTOMER_CONCENTRATION_OBSERVATION",
      source_adapter_id: "sec-edgar-fixture",
      scope_kind: "company",
      scope_id: "ENT-NVIDIA"
    });
    expect(sections[0]?.fingerprint).toContain("customer a accounted for 14");
  });
});

function normalizedFixture(
  text: string,
  overrides: { document_type?: NormalizedDocument["document_type"]; primary_entity_id?: string | undefined } = {}
): NormalizedDocument {
  return {
    doc_id: "DOC-OBS-FIXTURE",
    source_adapter_id: "sec-edgar-fixture",
    document_type: overrides.document_type ?? "10-K",
    ...(overrides.primary_entity_id === undefined && "primary_entity_id" in overrides
      ? {}
      : { primary_entity_id: overrides.primary_entity_id ?? "ENT-NVIDIA" }),
    language: "en",
    fetched_at: "2026-05-17T00:00:00.000Z",
    source_date: "2026-02-24",
    source_url: "fixture://sec-edgar/observation.html",
    storage_key: "fixtures/sec-edgar/observation.html",
    bytes_sha256: "fixture-sha",
    text,
    chunks: [{ chunk_id: "CH-OBS-FIXTURE", text, locator: "fixture" }],
    metadata: {}
  };
}
