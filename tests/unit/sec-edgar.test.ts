import { afterEach, describe, expect, it, vi } from "vitest";
import { secEdgarAdapter, normalizeCik } from "@supplystrata/sources-sec-edgar";

describe("SEC EDGAR adapter helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes CIK to SEC 10 digit format", () => {
    expect(normalizeCik("1045810")).toBe("0001045810");
    expect(normalizeCik("0001045810")).toBe("0001045810");
  });

  it("rejects invalid CIKs", () => {
    expect(() => normalizeCik("not-a-cik")).toThrow("Invalid CIK");
  });

  it("plans the latest matching 10-Q and multiple recent 8-K filings", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({
          filings: {
            recent: {
              accessionNumber: ["0001045810-26-000011", "0001045810-26-000010", "0001045810-26-000009", "0001045810-26-000008"],
              primaryDocument: ["nvda-20260426.htm", "nvda-8k-a.htm", "nvda-8k-b.htm", "nvda-10k.htm"],
              form: ["10-Q", "8-K", "8-K", "10-K"],
              filingDate: ["2026-05-27", "2026-05-10", "2026-04-20", "2026-02-24"]
            }
          }
        }),
        { status: 200 }
      )
    );

    const quarterlyTasks = [];
    for await (const task of secEdgarAdapter.plan({ cik: "1045810", entityId: "ENT-NVIDIA", formTypes: ["10-Q"] }, adapterContext())) {
      quarterlyTasks.push(task);
    }
    const currentReportTasks = [];
    for await (const task of secEdgarAdapter.plan({ cik: "1045810", entityId: "ENT-NVIDIA", formTypes: ["8-K"], limit: 2 }, adapterContext())) {
      currentReportTasks.push(task);
    }

    expect(quarterlyTasks).toHaveLength(1);
    expect(quarterlyTasks[0]).toMatchObject({
      expected_format: "html",
      hint: { entity_id: "ENT-NVIDIA", document_type: "10-Q", period: "2026-05-27" }
    });
    expect(currentReportTasks.map((task) => task.hint?.document_type)).toEqual(["8-K", "8-K"]);
    expect(currentReportTasks.map((task) => task.hint?.period)).toEqual(["2026-05-10", "2026-04-20"]);
  });

  it("normalizes SEC raw documents using the metadata document type", async () => {
    const raw = {
      doc_id: "DOC-SEC-8K",
      source_adapter_id: "sec-edgar",
      url: "https://www.sec.gov/Archives/edgar/data/1045810/example-8k.htm",
      fetched_at: "2026-05-17T00:00:00.000Z",
      bytes_sha256: "sha",
      storage_key: "sec-edgar/example-8k.htm",
      body: new TextEncoder().encode("<html><head><title>NVIDIA 8-K</title></head><body><p>NVIDIA filed a current report describing supply commitments.</p></body></html>"),
      metadata: {
        document_type: "8-K",
        primary_entity_id: "ENT-NVIDIA",
        source_date: "2026-05-10"
      }
    };

    const normalized = await secEdgarAdapter.normalize(raw, adapterContext());
    expect(normalized.doc_id).toBe("DOC-SEC-8K");
    expect(normalized.document_type).toBe("8-K");
    expect(normalized.primary_entity_id).toBe("ENT-NVIDIA");
    expect(normalized.source_date).toBe("2026-05-10");
    expect(normalized.metadata["parser_version"]).toBe("html-parser-v1");
    expect(normalized.text).toContain("NVIDIA filed a current report");
    expect(normalized.chunks.length).toBeGreaterThan(0);
  });
});

function adapterContext() {
  return {
    userAgent: "SupplyStrata test contact@example.com",
    now: () => new Date("2026-05-17T00:00:00.000Z")
  };
}
