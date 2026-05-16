import { describe, expect, it } from "vitest";
import { listSources, sourceStatusSummary } from "@supplystrata/source-registry";

describe("source registry", () => {
  it("tracks the free P0 sources needed by the MVP", () => {
    const ids = new Set(listSources().map((source) => source.id));
    expect(ids.has("sec-edgar")).toBe(true);
    expect(ids.has("tsmc-ir")).toBe(true);
    expect(ids.has("samsung-ir")).toBe(true);
    expect(ids.has("skhynix-ir")).toBe(true);
    expect(ids.has("asml-ir")).toBe(true);
    expect(ids.has("apple-suppliers")).toBe(true);
    expect(ids.has("opencorporates")).toBe(true);
    expect(ids.has("companies-house")).toBe(true);
    expect(ids.has("seed-entities")).toBe(true);
  });

  it("summarizes implemented and preview source coverage", () => {
    expect(sourceStatusSummary()).toMatchObject({
      total: 11,
      implemented: 2,
      preview: 7,
      planned: 1,
      manualOnly: 1,
      requiresKey: 2
    });
  });
});
