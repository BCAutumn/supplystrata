import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import type { RawDocument } from "@supplystrata/core";
import { buildDartKrDisclosureListUrl, extractDartKrDisclosureEntries } from "@supplystrata/source-workflows";

describe("dart-kr source workflow", () => {
  it("builds OpenDART disclosure list URLs from deterministic target config", () => {
    const url = new URL(
      buildDartKrDisclosureListUrl(
        {
          entityId: "ENT-SKHYNIX",
          corpCode: "00164779",
          year: 2025,
          disclosureTypes: ["A", "B"],
          corpClass: "Y",
          finalReportsOnly: "Y",
          limit: 20
        },
        "B",
        "test-opendart-key"
      )
    );

    expect(url.origin).toBe("https://engopendart.fss.or.kr");
    expect(url.pathname).toBe("/engapi/list.json");
    expect(url.searchParams.get("crtfc_key")).toBe("test-opendart-key");
    expect(url.searchParams.get("corp_code")).toBe("00164779");
    expect(url.searchParams.get("bgn_de")).toBe("20250101");
    expect(url.searchParams.get("end_de")).toBe("20251231");
    expect(url.searchParams.get("pblntf_ty")).toBe("B");
    expect(url.searchParams.get("corp_cls")).toBe("Y");
    expect(url.searchParams.get("last_reprt_at")).toBe("Y");
    expect(url.searchParams.get("page_count")).toBe("20");
  });

  it("extracts disclosure entries from OpenDART JSON payloads without inventing facts", () => {
    const raw = dartDisclosureRawDocument({
      status: "000",
      message: "Normal",
      list: [
        {
          corp_cls: "Y",
          corp_name: "SK hynix",
          corp_code: "00164779",
          stock_code: "000660",
          report_nm: "Annual Report",
          rcept_no: "20260317000635",
          flr_nm: "SK hynix",
          rcept_dt: "20260317",
          rm: "S"
        }
      ]
    });

    expect(extractDartKrDisclosureEntries(raw)).toEqual([
      {
        corpClass: "Y",
        corpName: "SK hynix",
        corpCode: "00164779",
        stockCode: "000660",
        reportName: "Annual Report",
        receiptNumber: "20260317000635",
        filerName: "SK hynix",
        receiptDate: "2026-03-17",
        note: "S"
      }
    ]);
  });

  it("accepts empty disclosure lists as monitor state instead of throwing fake parsing errors", () => {
    const raw = dartDisclosureRawDocument({ status: "013", message: "No data", list: [] });

    expect(extractDartKrDisclosureEntries(raw)).toEqual([]);
  });
});

function dartDisclosureRawDocument(payload: Record<string, unknown>): RawDocument<Uint8Array> {
  return {
    doc_id: "DOC-DART",
    source_adapter_id: "dart-kr",
    url: "https://engopendart.fss.or.kr/engapi/list.json",
    fetched_at: "2026-05-21T00:00:00.000Z",
    bytes_sha256: "sha256",
    storage_key: "official-disclosure/dart-kr/test.json",
    body: new Uint8Array(Buffer.from(JSON.stringify(payload))),
    metadata: {
      document_type: "company_registry",
      primary_entity_id: "ENT-SKHYNIX"
    }
  };
}
