import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import type { RawDocument } from "@supplystrata/core";
import { extractHkexNewsAnnouncementEntries, routeCountryOfficialDirectoryTargets } from "@supplystrata/source-workflows";

const now = "2026-05-28T00:00:00.000Z";

describe("country official directory router", () => {
  it("routes US companies to SEC targets", () => {
    const result = routeCountryOfficialDirectoryTargets({
      identity: identity("ENT-NVIDIA", "NVIDIA", "US", { cik: "0001045810" }),
      namespace: "global-test",
      now
    });

    expect(result.routes).toMatchObject([{ status: "routable", source_adapter_id: "sec-edgar" }]);
    expect(result.check_targets.map((target) => `${target.source_adapter_id}/${target.target_kind}`)).toEqual([
      "sec-edgar/sec-company-filings",
      "sec-edgar/sec-company-facts"
    ]);
  });

  it("routes Korea, Japan, Taiwan, and Hong Kong only when market directory identifiers are present", () => {
    expect(
      routeCountryOfficialDirectoryTargets({
        identity: identity("ENT-SAMSUNG", "Samsung Electronics", "KR", { opendart_corp_code: "00126380" }),
        namespace: "global-test",
        now
      }).check_targets[0]
    ).toMatchObject({ source_adapter_id: "dart-kr", target_kind: "company-filings" });

    expect(
      routeCountryOfficialDirectoryTargets({
        identity: identity("ENT-TEL", "Tokyo Electron", "JP", { edinet_code: "E02652", jp_sec_code: "8035" }),
        namespace: "global-test",
        now
      }).check_targets[0]
    ).toMatchObject({ source_adapter_id: "edinet", target_kind: "daily-filings" });

    expect(
      routeCountryOfficialDirectoryTargets({
        identity: identity("ENT-TSMC", "TSMC", "TW", { twse_stock_code: "2330" }),
        namespace: "global-test",
        now
      }).check_targets[0]
    ).toMatchObject({ source_adapter_id: "twse-mops", target_kind: "electronic-documents" });

    expect(
      routeCountryOfficialDirectoryTargets({
        identity: identity("ENT-TENCENT", "Tencent", "HK", { hkex_stock_code: "00700" }),
        namespace: "global-test",
        now
      }).check_targets[0]
    ).toMatchObject({ source_adapter_id: "hkex-news", target_kind: "title-search" });
  });

  it("does not guess missing market identifiers for non-US directories", () => {
    const result = routeCountryOfficialDirectoryTargets({
      identity: identity("ENT-SAMSUNG", "Samsung Electronics", "KR", { lei: "988400K1R0A5KSIXZL66" }),
      namespace: "global-test",
      now
    });

    expect(result.routes).toMatchObject([{ status: "missing_identifier", source_adapter_id: "dart-kr" }]);
    expect(result.check_targets).toEqual([]);
  });

  it("marks UK and EU routes as registry-only until official disclosure connectors exist", () => {
    expect(
      routeCountryOfficialDirectoryTargets({
        identity: identity("ENT-AZ", "AstraZeneca", "GB", { companies_house_number: "02723534" }),
        namespace: "global-test",
        now
      }).routes[0]
    ).toMatchObject({ status: "unsupported_country", source_adapter_id: "companies-house" });

    expect(
      routeCountryOfficialDirectoryTargets({
        identity: identity("ENT-LVMH", "LVMH", "FR", { lei: "969500FP1Q07I98R6P10" }),
        namespace: "global-test",
        now
      }).routes[0]
    ).toMatchObject({ status: "unsupported_country", source_adapter_id: "gleif" });
  });
});

describe("HKEXnews title-search stub", () => {
  it("extracts announcement metadata without parsing PDF body text", () => {
    const entries = extractHkexNewsAnnouncementEntries(
      rawHtml(`
        <table>
          <tr>
            <td>2026-05-28 12:00</td>
            <td>00700 Tencent Holdings Limited</td>
            <td>Announcements and Notices</td>
            <td><a href="/listedco/listconews/sehk/2026/0528/2026052800123.pdf">POLL RESULTS OF ANNUAL GENERAL MEETING</a></td>
          </tr>
        </table>
      `)
    );

    expect(entries).toEqual([
      {
        stockCode: "00700",
        releaseTime: "2026-05-28T12:00:00+08:00",
        category: "Announcements and Notices",
        title: "POLL RESULTS OF ANNUAL GENERAL MEETING",
        documentUrl: "https://www1.hkexnews.hk/listedco/listconews/sehk/2026/0528/2026052800123.pdf"
      }
    ]);
  });
});

function identity(entityId: string, displayName: string, country: string, identifiers: Record<string, unknown>) {
  return {
    entity_id: entityId,
    display_name: displayName,
    primary_country: country,
    identifiers
  };
}

function rawHtml(html: string): RawDocument<Uint8Array> {
  return {
    doc_id: "DOC-HKEX",
    source_adapter_id: "hkex-news",
    url: "https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=en",
    fetched_at: now,
    bytes_sha256: "fixture",
    storage_key: "fixture/hkex.html",
    body: Buffer.from(html, "utf8"),
    metadata: {}
  };
}
