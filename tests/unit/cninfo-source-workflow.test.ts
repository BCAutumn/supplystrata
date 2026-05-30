import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  CNINFO_ANNUAL_REPORT_CATEGORY,
  buildCninfoQueryBody,
  buildCninfoQueryUrl,
  buildCninfoStockListUrl,
  cninfoExchangeFromStockCode,
  cninfoOrgId,
  cninfoPdfUrl,
  findCninfoOrgId,
  isChineseAnnualReportBody,
  parseCninfoAnnouncementsPayload,
  parseCninfoStockList,
  selectCninfoAnnualReports
} from "@supplystrata/source-workflows";

describe("cninfo source workflow", () => {
  it("derives exchange and orgId from Shanghai/Shenzhen codes", () => {
    expect(cninfoExchangeFromStockCode("600519")).toBe("sse");
    expect(cninfoExchangeFromStockCode("000001")).toBe("szse");
    expect(cninfoExchangeFromStockCode("300750")).toBe("szse");
    expect(cninfoExchangeFromStockCode("688981")).toBe("sse");
    expect(cninfoOrgId("600519", "sse")).toBe("gssh0600519");
    expect(cninfoOrgId("000001", "szse")).toBe("gssz0000001");
    expect(cninfoOrgId("000001", "szse", "gssz0000001real")).toBe("gssz0000001real");
  });

  it("builds a form-urlencoded annual-report query body", () => {
    expect(buildCninfoQueryUrl()).toBe("http://www.cninfo.com.cn/new/hisAnnouncement/query");
    const body = new URLSearchParams(buildCninfoQueryBody({ stockCode: "600519", seDate: "2024-01-01~2024-12-31" }));
    expect(body.get("stock")).toBe("600519,gssh0600519");
    expect(body.get("column")).toBe("sse");
    expect(body.get("category")).toBe(CNINFO_ANNUAL_REPORT_CATEGORY);
    expect(body.get("seDate")).toBe("2024-01-01~2024-12-31");
    expect(body.get("tabName")).toBe("fulltext");
  });

  it("rejects malformed stock codes", () => {
    expect(() => buildCninfoQueryBody({ stockCode: "60051" })).toThrow(/6 digits/);
  });

  it("filters to Chinese annual-report PDFs, dropping summaries, English versions, and cancellations", () => {
    expect(isChineseAnnualReportBody("贵州茅台：2023年年度报告")).toBe(true);
    expect(isChineseAnnualReportBody("贵州茅台：2023年年度报告摘要")).toBe(false);
    expect(isChineseAnnualReportBody("贵州茅台：2023 Annual Report (English)")).toBe(false);
    expect(isChineseAnnualReportBody("关于取消2023年年度报告的公告")).toBe(false);
    expect(isChineseAnnualReportBody("董事会决议公告")).toBe(false);
  });

  it("parses announcements, strips <em> highlight, and selects bodies under the limit", () => {
    const payload = parseCninfoAnnouncementsPayload(
      cninfoPayload([
        { announcementId: "1", announcementTitle: "<em>贵州茅台</em>：2023年年度报告", adjunctUrl: "finalpage/2024-04-02/1219712345.PDF", secName: "<em>贵州茅台</em>", announcementTime: 1712000000000 },
        { announcementId: "2", announcementTitle: "贵州茅台：2023年年度报告摘要", adjunctUrl: "finalpage/2024-04-02/1219712346.PDF" },
        { announcementId: "3", announcementTitle: "贵州茅台：2022年年度报告", adjunctUrl: "finalpage/2023-04-02/1219700001.PDF" }
      ])
    );
    expect(payload.announcements[0]?.announcementTitle).toBe("贵州茅台：2023年年度报告");
    expect(payload.announcements[0]?.secName).toBe("贵州茅台");

    const selected = selectCninfoAnnualReports(payload.announcements, { stockCode: "600519", limit: 1 });
    expect(selected).toHaveLength(1);
    expect(selected[0]?.announcementTitle).toBe("贵州茅台：2023年年度报告");
    expect(cninfoPdfUrl(selected[0]!.adjunctUrl)).toBe("http://static.cninfo.com.cn/finalpage/2024-04-02/1219712345.PDF");
  });

  it("maps stock code to the real orgId from the cninfo stock list (tightening the heuristic)", () => {
    expect(buildCninfoStockListUrl("sse")).toBe("http://www.cninfo.com.cn/new/data/sse_stock.json");
    expect(buildCninfoStockListUrl("szse")).toBe("http://www.cninfo.com.cn/new/data/szse_stock.json");
    const stockList = parseCninfoStockList(
      new Uint8Array(
        Buffer.from(
          JSON.stringify({
            stockList: [
              { code: "600519", orgId: "9900008243", zwjc: "贵州茅台" },
              { code: "300750", orgId: "9900023756", zwjc: "宁德时代" }
            ]
          })
        )
      )
    );
    expect(findCninfoOrgId(stockList, "600519")).toBe("9900008243");
    expect(findCninfoOrgId(stockList, "300750")).toBe("9900023756");
    // 清单查不到 → undefined，让调用方退回约定式构造。
    expect(findCninfoOrgId(stockList, "000001")).toBeUndefined();
  });

  it("treats an empty (null announcements) result as a valid empty set", () => {
    const payload = parseCninfoAnnouncementsPayload(new Uint8Array(Buffer.from(JSON.stringify({ announcements: null, totalRecordNum: 0 }))));
    expect(payload.announcements).toEqual([]);
    expect(selectCninfoAnnualReports(payload.announcements, { stockCode: "600519" })).toEqual([]);
  });
});

function cninfoPayload(announcements: Record<string, unknown>[]): Uint8Array {
  return new Uint8Array(Buffer.from(JSON.stringify({ announcements, totalRecordNum: announcements.length })));
}
