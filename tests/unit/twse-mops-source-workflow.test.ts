import { describe, expect, it } from "vitest";
import { buildTwseMopsElectronicDocumentsUrl, extractTwseMopsElectronicDocumentEntries } from "@supplystrata/source-workflows";
import type { RawDocument } from "@supplystrata/core";

describe("twse mops source workflow", () => {
  it("builds TWSE MOPS electronic document directory URLs from deterministic target config", () => {
    const url = new URL(
      buildTwseMopsElectronicDocumentsUrl({
        entityId: "ENT-FOXCONN",
        stockCode: "2317",
        year: 2024,
        documentKind: "F",
        limit: 50
      })
    );

    expect(url.origin).toBe("https://doc.twse.com.tw");
    expect(url.pathname).toBe("/server-java/t57sb01");
    expect(url.searchParams.get("step")).toBe("1");
    expect(url.searchParams.get("colorchg")).toBe("1");
    expect(url.searchParams.get("co_id")).toBe("2317");
    expect(url.searchParams.get("year")).toBe("113");
    expect(url.searchParams.get("mtype")).toBe("F");
    expect(url.searchParams.has("limit")).toBe(false);
  });

  it("extracts electronic document directory rows without downloading PDFs or inventing facts", () => {
    const raw = twseRawDocument(
      `
        <html>
          <head><meta charset="utf-8"></head>
          <body>
            <table>
              <tr>
                <td>2317</td>
                <td>113 年</td>
                <td>股東會資料</td>
                <td>&nbsp;</td>
                <td>常會</td>
                <td>英文版-股東會年報</td>
                <td>&nbsp;</td>
                <td><a href='javascript:readfile2("F","2317","2024_2317_20240531FE4.pdf");'>下載</a></td>
                <td>10,044,849</td>
                <td>113/05/10 19:06:12</td>
              </tr>
            </table>
          </body>
        </html>
      `,
      { limit: 1 }
    );

    expect(extractTwseMopsElectronicDocumentEntries(raw)).toEqual([
      {
        stockCode: "2317",
        periodLabel: "113 年",
        documentCategory: "股東會資料",
        documentDetail: "英文版-股東會年報",
        kind: "F",
        filename: "2024_2317_20240531FE4.pdf",
        fileSize: "10,044,849",
        uploadedAt: "2024-05-10T19:06:12+08:00"
      }
    ]);
  });

  it("keeps empty TWSE MOPS result sets as monitor state", () => {
    const raw = twseRawDocument(`<html><head><meta charset="utf-8"></head><body><table></table></body></html>`);

    expect(extractTwseMopsElectronicDocumentEntries(raw)).toEqual([]);
  });
});

function twseRawDocument(html: string, metadata: Record<string, unknown> = {}): RawDocument<Uint8Array> {
  return {
    doc_id: "DOC-TWSE",
    source_adapter_id: "twse-mops",
    url: "https://doc.twse.com.tw/server-java/t57sb01?step=1&colorchg=1&co_id=2317&year=113&mtype=F",
    fetched_at: "2026-01-01T00:00:00.000Z",
    bytes_sha256: "sha",
    storage_key: "official-disclosure/twse-mops/test.html",
    body: new TextEncoder().encode(html),
    metadata
  };
}
