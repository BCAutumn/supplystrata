import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it } from "vitest";
import type { RawDocument } from "@supplystrata/core";
import { buildEdinetDocumentsListUrl, extractEdinetDocumentEntries } from "@supplystrata/source-workflows";

describe("edinet source workflow", () => {
  const previousApiKey = process.env["EDINET_API_KEY"];

  afterEach(() => {
    if (previousApiKey === undefined) delete process.env["EDINET_API_KEY"];
    else process.env["EDINET_API_KEY"] = previousApiKey;
  });

  it("builds EDINET documents list URLs from deterministic target config", () => {
    process.env["EDINET_API_KEY"] = "test-edinet-key";

    const url = new URL(
      buildEdinetDocumentsListUrl({
        date: "2026-06-30",
        listType: 2,
        componentId: "COMP-SILICON-WAFER",
        scopeKind: "component",
        scopeId: "COMP-SILICON-WAFER",
        edinetCodes: ["E01234"],
        docTypeCodes: ["120"]
      })
    );

    expect(url.origin).toBe("https://api.edinet-fsa.go.jp");
    expect(url.pathname).toBe("/api/v2/documents.json");
    expect(url.searchParams.get("date")).toBe("2026-06-30");
    expect(url.searchParams.get("type")).toBe("2");
    expect(url.searchParams.get("Subscription-Key")).toBe("test-edinet-key");
  });

  it("extracts and filters EDINET document entries without inventing supply-chain facts", () => {
    const raw = edinetRawDocument(
      {
        metadata: {
          status: "200",
          message: "OK",
          resultset: { count: 2 }
        },
        results: [
          {
            docID: "S100AAAA",
            edinetCode: "E01234",
            secCode: "40630",
            JCN: "1234567890123",
            filerName: "Shin-Etsu Chemical Co., Ltd.",
            docTypeCode: "120",
            docDescription: "Annual Securities Report",
            periodStart: "2025-04-01",
            periodEnd: "2026-03-31",
            submitDateTime: "2026-06-30 10:00",
            xbrlFlag: "1",
            pdfFlag: "1",
            englishDocFlag: "0",
            csvFlag: "1"
          },
          {
            docID: "S100BBBB",
            edinetCode: "E09999",
            secCode: "99990",
            filerName: "Out of scope company",
            docTypeCode: "120"
          }
        ]
      },
      { edinet_codes: ["E01234"], doc_type_codes: ["120"] }
    );

    expect(extractEdinetDocumentEntries(raw)).toEqual([
      {
        docId: "S100AAAA",
        edinetCode: "E01234",
        secCode: "40630",
        jcn: "1234567890123",
        filerName: "Shin-Etsu Chemical Co., Ltd.",
        docTypeCode: "120",
        docDescription: "Annual Securities Report",
        periodStart: "2025-04-01",
        periodEnd: "2026-03-31",
        submitDateTime: "2026-06-30 10:00",
        xbrlFlag: "1",
        pdfFlag: "1",
        englishDocFlag: "0",
        csvFlag: "1"
      }
    ]);
  });

  it("keeps empty EDINET result sets as monitor state", () => {
    const raw = edinetRawDocument({
      metadata: { status: "200", message: "OK", resultset: { count: 0 } },
      results: []
    });

    expect(extractEdinetDocumentEntries(raw)).toEqual([]);
  });
});

function edinetRawDocument(payload: Record<string, unknown>, metadata: Record<string, unknown> = {}): RawDocument<Uint8Array> {
  return {
    doc_id: "DOC-EDINET",
    source_adapter_id: "edinet",
    url: "https://api.edinet-fsa.go.jp/api/v2/documents.json?date=2026-06-30&type=2",
    fetched_at: "2026-05-21T00:00:00.000Z",
    bytes_sha256: "sha256",
    storage_key: "official-disclosure/edinet/test.json",
    body: new Uint8Array(Buffer.from(JSON.stringify(payload))),
    metadata: {
      document_type: "company_registry",
      source_date: "2026-06-30",
      ...metadata
    }
  };
}
