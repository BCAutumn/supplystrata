import { type SourceSnapshotStore } from "@supplystrata/source-adapter-runtime";
import { findCompanyDirectoryCandidates, normalizeCompanyDirectoryQuery, type CompanyDirectoryMatchInput } from "./company-directory-match.js";
import { loadOrFetchDirectorySnapshot } from "./directory-snapshot.js";

const TWSE_ISIN_LIST_URL = "https://isin.twse.com.tw/isin/C_public.jsp?strMode=2";

export interface TwseDirectoryRecord {
  stockCode: string;
  companyName: string;
  names: readonly string[];
}

export interface TwseDirectoryLookupInput extends CompanyDirectoryMatchInput {
  stockCode?: string;
}

export interface TwseDirectoryLookupResult {
  query: string;
  source_url: string;
  candidates: TwseDirectoryRecord[];
}

export async function lookupTwseCompanyDirectory(
  input: TwseDirectoryLookupInput,
  context: { userAgent: string; now: string; snapshotStore?: SourceSnapshotStore }
): Promise<TwseDirectoryLookupResult> {
  const bytes = await loadOrFetchDirectorySnapshot({
    url: TWSE_ISIN_LIST_URL,
    userAgent: context.userAgent,
    sourceLabel: "TWSE ISIN list",
    storagePrefix: "entity-directory/twse",
    extension: "html",
    now: context.now,
    ...(context.snapshotStore === undefined ? {} : { snapshotStore: context.snapshotStore })
  });
  const records = parseTwseIsinListHtml(new TextDecoder("utf8").decode(bytes));
  return {
    query: input.query,
    source_url: TWSE_ISIN_LIST_URL,
    candidates: findTwseDirectoryCandidates(records, input)
  };
}

export function parseTwseIsinListHtml(html: string): TwseDirectoryRecord[] {
  const records: TwseDirectoryRecord[] = [];
  const rowPattern = /<tr[^>]*>\s*<td[^>]*>\s*(\d{4,6})\s*<\/td>\s*<td[^>]*>\s*([\s\S]*?)<\/td>/gi;
  for (const match of html.matchAll(rowPattern)) {
    const stockCode = match[1]?.trim();
    const companyName = stripHtml(match[2] ?? "").trim();
    if (stockCode === undefined || stockCode.length === 0 || companyName.length === 0) continue;
    records.push({
      stockCode,
      companyName,
      names: [companyName]
    });
  }
  return records;
}

export function findTwseDirectoryCandidates(
  records: readonly TwseDirectoryRecord[],
  input: TwseDirectoryLookupInput
): TwseDirectoryRecord[] {
  return findCompanyDirectoryCandidates(records, {
    query: normalizeCompanyDirectoryQuery(input.query),
    ...(input.stockCode === undefined ? {} : { stockCode: input.stockCode }),
    ...(input.limit === undefined ? {} : { limit: input.limit })
  });
}

export function twseDirectoryIdentifiers(record: TwseDirectoryRecord): Record<string, string> {
  return {
    twse_stock_code: record.stockCode,
    stock_code: record.stockCode
  };
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}
