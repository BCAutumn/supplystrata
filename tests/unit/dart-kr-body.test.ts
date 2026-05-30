import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import type { RawDocument } from "@supplystrata/core";
import {
  buildDartKrBodyListUrl,
  buildDartKrDocumentUrl,
  isDartKrAnnualReportName,
  normalizeDartKrBodyDocument,
  selectDartKrAnnualReports,
  type DartKrCompanyBodyInput
} from "@supplystrata/source-workflows";

const BODY_INPUT: DartKrCompanyBodyInput = { entityId: "ENT-SK-HYNIX", corpCode: "00164779", year: 2024 };

describe("dart-kr body adapter", () => {
  it("builds an annual-report list URL and a document download URL with the API key", () => {
    const list = new URL(buildDartKrBodyListUrl(BODY_INPUT, "test-dart-key"));
    expect(list.origin).toBe("https://opendart.fss.or.kr");
    expect(list.pathname).toBe("/api/list.json");
    expect(list.searchParams.get("corp_code")).toBe("00164779");
    expect(list.searchParams.get("pblntf_ty")).toBe("A");
    expect(list.searchParams.get("bgn_de")).toBe("20240101");
    expect(list.searchParams.get("crtfc_key")).toBe("test-dart-key");

    const doc = new URL(buildDartKrDocumentUrl("20240312000736", "test-dart-key"));
    expect(doc.pathname).toBe("/api/document.xml");
    expect(doc.searchParams.get("rcept_no")).toBe("20240312000736");
    expect(doc.searchParams.get("crtfc_key")).toBe("test-dart-key");
  });

  it("rejects malformed receipt numbers", () => {
    expect(() => buildDartKrDocumentUrl("123", "k")).toThrow(/14 digits/);
  });

  it("recognizes 사업보고서 bodies and rejects half/quarter/amendment filings", () => {
    expect(isDartKrAnnualReportName("사업보고서 (2023.12)")).toBe(true);
    expect(isDartKrAnnualReportName("반기보고서 (2023.06)")).toBe(false);
    expect(isDartKrAnnualReportName("분기보고서 (2023.09)")).toBe(false);
    expect(isDartKrAnnualReportName("[기재정정]사업보고서 (2023.12)")).toBe(false);
    expect(isDartKrAnnualReportName("주요사항보고서")).toBe(false);
  });

  it("selects annual-report entries with valid receipt numbers under the limit", () => {
    const entries = [
      { corpName: "SK하이닉스", corpCode: "00164779", reportName: "사업보고서 (2023.12)", receiptNumber: "20240312000736", receiptDate: "2024-03-12" },
      { corpName: "SK하이닉스", corpCode: "00164779", reportName: "반기보고서 (2023.06)", receiptNumber: "20230814000111", receiptDate: "2023-08-14" },
      { corpName: "SK하이닉스", corpCode: "00164779", reportName: "사업보고서 (2022.12)", receiptNumber: "20230310000222", receiptDate: "2023-03-10" }
    ];
    const selected = selectDartKrAnnualReports(entries, { ...BODY_INPUT, limit: 1 });
    expect(selected).toHaveLength(1);
    expect(selected[0]?.receiptNumber).toBe("20240312000736");
  });

  it("unzips the document body into a Korean annual_report document", () => {
    const narrative =
      "<DOCUMENT><TITLE>사업보고서</TITLE><BODY>" +
      "<P>당사는 주요 원재료를 삼성전자로부터 구매하고 있습니다.</P>" +
      "<P>특정 공급업체에 대한 의존도가 높습니다.</P>" +
      "</BODY></DOCUMENT>";
    const normalized = normalizeDartKrBodyDocument(dartBodyRaw({ "20240312000736.xml": narrative }));

    expect(normalized.source_adapter_id).toBe("dart-kr");
    expect(normalized.document_type).toBe("annual_report");
    expect(normalized.language).toBe("ko");
    expect(normalized.primary_entity_id).toBe("ENT-SK-HYNIX");
    expect(normalized.text).toContain("삼성전자로부터 구매");
    expect(normalized.metadata["parser_version"]).toBe("dart-kr-body-v1");
    expect(normalized.metadata["dart_rcept_no"]).toBe("20240312000736");
  });

  it("throws when the document body is not a ZIP archive (DART 200-with-XML error)", () => {
    const raw = dartBodyRaw({});
    raw.body = new Uint8Array(Buffer.from("<result><status>013</status><message>조회된 데이타가 없습니다.</message></result>"));
    expect(() => normalizeDartKrBodyDocument(raw)).toThrow(/not a ZIP archive/i);
  });
});

function dartBodyRaw(files: Record<string, string>): RawDocument<Uint8Array> {
  const zipped = zipSync(Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(content)])));
  return {
    doc_id: "DOC-DART-BODY",
    source_adapter_id: "dart-kr",
    url: "https://opendart.fss.or.kr/api/document.xml?rcept_no=20240312000736",
    fetched_at: "2024-03-12T00:00:00.000Z",
    bytes_sha256: "sha256-dart-body",
    storage_key: "official-disclosure/dart-kr/body/20240312000736/sha256-dart-body.zip",
    body: zipped,
    metadata: {
      task_id: "dart-kr-body-20240312000736",
      document_type: "annual_report",
      dart_rcept_no: "20240312000736",
      primary_entity_id: "ENT-SK-HYNIX",
      source_date: "2024-03-12"
    }
  };
}
