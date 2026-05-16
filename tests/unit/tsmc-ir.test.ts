import { describe, expect, it } from "vitest";
import { extractAsmlSignalsFromText, extractSkHynixSignalsFromText, extractTsmcIrSignalsFromText } from "@supplystrata/pipeline";
import { annualReportUrl } from "@supplystrata/sources-tsmc-ir";

describe("TSMC IR preview", () => {
  it("uses the official 2025 annual report URL shape", () => {
    expect(annualReportUrl(2025)).toBe("https://investor.tsmc.com/static/annualReports/2025/english/index.html");
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
