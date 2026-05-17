import { describe, expect, it } from "vitest";
import { extractAsmlSignalsFromText, extractSkHynixSignalsFromText, extractTsmcIrSignalsFromText } from "@supplystrata/pipeline";
import { annualReportUrl, tsmcIrAdapter } from "@supplystrata/sources-tsmc-ir";

describe("TSMC IR preview", () => {
  it("uses the official 2025 annual report URL shape", () => {
    expect(annualReportUrl(2025)).toBe("https://investor.tsmc.com/static/annualReports/2025/english/index.html");
  });

  it("normalizes official disclosure HTML into complete document text and chunks", async () => {
    const normalized = await tsmcIrAdapter.normalize({
      doc_id: "DOC-TSMC-2025",
      source_adapter_id: "tsmc-ir",
      url: "https://investor.tsmc.com/static/annualReports/2025/english/index.html",
      fetched_at: "2026-05-17T00:00:00.000Z",
      bytes_sha256: "sha",
      storage_key: "company-ir/tsmc/2025/example.html",
      body: new TextEncoder().encode("<html><head><title>TSMC Annual Report</title></head><body><p>TSMC is a pure-play foundry serving AI and HPC customers.</p></body></html>"),
      metadata: {
        document_type: "annual_report",
        primary_entity_id: "ENT-TSMC",
        source_date: "2025-12-31"
      }
    }, {
      userAgent: "SupplyStrata test contact@example.com",
      now: () => new Date("2026-05-17T00:00:00.000Z")
    });

    expect(normalized.document_type).toBe("annual_report");
    expect(normalized.primary_entity_id).toBe("ENT-TSMC");
    expect(normalized.source_date).toBe("2025-12-31");
    expect(normalized.metadata["parser_version"]).toBe("html-parser-v1");
    expect(normalized.text).toContain("pure-play foundry");
    expect(normalized.chunks.length).toBeGreaterThan(0);
  });

  it("extracts capability signals from annual report language", () => {
    const signals = extractTsmcIrSignalsFromText(
      [
        "Our success is predicated on our steadfast adherence to the pure-play foundry business model.",
        "We deployed 305 distinct process technologies, and manufactured 12,682 products for 534 customers.",
        "Our plan will enable TSMC to scale up to an independent GIGAFAB cluster in Arizona, to support the needs of our leading-edge customers in smartphone, AI and HPC applications.",
        "We are also developing advanced packaging and 3D chip stacking technologies, including CoWoS, InFO, and TSMC-SoIC."
      ].join(" ")
    );
    expect(signals.map((signal) => signal.title)).toEqual([
      "TSMC describes itself as a dedicated foundry",
      "TSMC reports broad customer and product coverage",
      "TSMC links demand to AI and HPC",
      "TSMC highlights advanced packaging capacity"
    ]);
  });

  it("extracts SK hynix memory-side signals", () => {
    const signals = extractSkHynixSignalsFromText(
      "In addition to HBM, demand on conventional memory solutions for servers increased sharply, to which SK hynix responded proactively. The company noted that as the AI market shifts from training to inference while demand for distributed architectures expands, the role of memory will become increasingly critical. Conventional DRAM entered full-scale mass production of 1cnm process, or the sixth-generation of the 10-nanometer technology."
    );
    expect(signals.map((signal) => signal.title)).toEqual([
      "SK hynix links results to HBM demand",
      "SK hynix describes AI memory momentum",
      "SK hynix mentions advanced memory products"
    ]);
  });

  it("extracts ASML semiconductor equipment signals without page chrome", () => {
    const signals = extractAsmlSignalsFromText(
      "We deliver value throughout the semiconductor value chain. Our comprehensive lithography portfolio enables cost-effective microchip scaling for our customers. TWINSCAN NXE:3800E – full-specification system improves throughput by 37%"
    );
    expect(signals.map((signal) => signal.cite_text)).toEqual([
      "We deliver value throughout the semiconductor value chain. Our comprehensive lithography portfolio enables cost-effective microchip scaling for our customers.",
      "TWINSCAN NXE:3800E – full-specification system improves throughput by 37%"
    ]);
  });
});
