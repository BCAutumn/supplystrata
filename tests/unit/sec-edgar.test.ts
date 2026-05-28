import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeCik, parseSecCompanyFactObservations, secCompanyFactsAdapter, secEdgarAdapter } from "@supplystrata/sources-sec-edgar";

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
    vi.stubGlobal(
      "fetch",
      async () =>
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

  it("respects requested form priority so annual reports are not displaced by recent 8-K filings", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            filings: {
              recent: {
                accessionNumber: ["0001318605-26-000003", "0001318605-26-000002", "0001318605-26-000001"],
                primaryDocument: ["tsla-8k.htm", "tsla-10q.htm", "tsla-10k.htm"],
                form: ["8-K", "10-Q", "10-K"],
                filingDate: ["2026-04-22", "2026-04-21", "2026-01-29"]
              }
            }
          }),
          { status: 200 }
        )
    );

    const tasks = [];
    for await (const task of secEdgarAdapter.plan(
      { cik: "1318605", entityId: "ENT-TESLA", formTypes: ["10-K", "20-F", "10-Q", "8-K"], limit: 2 },
      adapterContext()
    )) {
      tasks.push(task);
    }

    expect(tasks.map((task) => task.hint?.document_type)).toEqual(["10-K", "10-Q"]);
    expect(tasks.map((task) => task.hint?.period)).toEqual(["2026-01-29", "2026-04-21"]);
  });

  it("normalizes SEC raw documents using the metadata document type", async () => {
    const raw = {
      doc_id: "DOC-SEC-8K",
      source_adapter_id: "sec-edgar",
      url: "https://www.sec.gov/Archives/edgar/data/1045810/example-8k.htm",
      fetched_at: "2026-05-17T00:00:00.000Z",
      bytes_sha256: "sha",
      storage_key: "sec-edgar/example-8k.htm",
      body: new TextEncoder().encode(
        "<html><head><title>NVIDIA 8-K</title></head><body><p>NVIDIA filed a current report describing supply commitments.</p></body></html>"
      ),
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

  it("parses SEC company facts JSON into financial metric observations without text/PDF parsing", async () => {
    const payload = new TextEncoder().encode(
      JSON.stringify({
        cik: 1045810,
        entityName: "NVIDIA CORP",
        facts: {
          "us-gaap": {
            InventoryNet: {
              units: {
                USD: [
                  { val: 1000, end: "2026-01-25", filed: "2026-02-24", form: "10-K", accn: "0001045810-26-000010", fy: 2026, fp: "FY" },
                  { val: 900, end: "2025-10-26", filed: "2025-11-20", form: "10-Q", accn: "0001045810-25-000030", fy: 2026, fp: "Q3" }
                ]
              }
            },
            AccountsPayableCurrent: {
              units: {
                USD: [{ val: 500, end: "2026-01-25", filed: "2026-02-24", form: "10-K", accn: "0001045810-26-000010", fy: 2026, fp: "FY" }]
              }
            }
          }
        }
      })
    );

    const observations = parseSecCompanyFactObservations(payload, { metrics: ["inventory", "accounts_payable"], maxPeriods: 1 });

    expect(observations).toHaveLength(2);
    expect(observations[0]).toMatchObject({
      observation_type: "FINANCIAL_METRIC_OBSERVATION",
      metric_name: "inventory",
      metric_value: "1000",
      metric_unit: "USD",
      time_window_end: "2026-01-25",
      baseline_value: "900",
      change_value: "100",
      change_percent: 11.111111,
      confidence: 0.9
    });
    expect(observations[0]?.provenance).toMatchObject({
      cik: 1045810,
      entity_name: "NVIDIA CORP",
      taxonomy: "us-gaap",
      xbrl_tag: "InventoryNet",
      accession: "0001045810-26-000010",
      official_structured_source: true,
      no_company_edge: true
    });
    expect(
      observations.every((observation) => observation.attrs["observation_policy"] === "sec_companyfacts_financial_metric_cannot_create_company_edge")
    ).toBe(true);
  });

  it("plans and normalizes SEC company facts as a company_facts JSON document", async () => {
    const tasks = [];
    for await (const task of secCompanyFactsAdapter.plan({ cik: "1045810", entityId: "ENT-NVIDIA" }, adapterContext())) {
      tasks.push(task);
    }
    expect(tasks[0]?.hint?.period).toBe("2026-05-17");

    const normalized = await secCompanyFactsAdapter.normalize(
      {
        doc_id: "DOC-COMPANYFACTS",
        source_adapter_id: "sec-edgar",
        url: tasks[0]?.url ?? "https://data.sec.gov/api/xbrl/companyfacts/CIK0001045810.json",
        fetched_at: "2026-05-19T00:00:00.000Z",
        bytes_sha256: "sha",
        storage_key: "sec-edgar/companyfacts/ENT-NVIDIA/sha.json",
        body: new TextEncoder().encode(
          JSON.stringify({
            facts: {
              "us-gaap": {
                Revenues: {
                  units: {
                    USD: [{ val: 100, start: "2025-01-27", end: "2026-01-25", filed: "2026-02-24", form: "10-K", accn: "0001045810-26-000010" }]
                  }
                }
              }
            }
          })
        ),
        metadata: {
          document_type: "company_facts",
          primary_entity_id: "ENT-NVIDIA",
          source_date: "2026-05-19"
        }
      },
      adapterContext()
    );

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      task_id: "sec-companyfacts-0001045810",
      expected_format: "json",
      hint: { entity_id: "ENT-NVIDIA", document_type: "company_facts" }
    });
    expect(normalized.document_type).toBe("company_facts");
    expect(normalized.primary_entity_id).toBe("ENT-NVIDIA");
    expect(normalized.text).toContain("revenue: 100 USD");
  });
});

function adapterContext() {
  return {
    userAgent: "SupplyStrata test contact@example.com",
    now: () => new Date("2026-05-17T00:00:00.000Z")
  };
}
