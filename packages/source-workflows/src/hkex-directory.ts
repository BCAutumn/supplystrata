import { type SourceSnapshotStore } from "@supplystrata/source-adapter-runtime";
import { findCompanyDirectoryCandidates, normalizeCompanyDirectoryQuery, type CompanyDirectoryMatchInput } from "./company-directory-match.js";
import { loadOrFetchDirectorySnapshot } from "./directory-snapshot.js";

const HKEX_SECURITIES_LIST_URL = "https://www.hkex.com.hk/eng/services/trading/securities/securitieslists/ListOfSecurities.csv";

export interface HkexDirectoryRecord {
  stockCode: string;
  companyName: string;
  names: readonly string[];
}

export interface HkexDirectoryLookupInput extends CompanyDirectoryMatchInput {
  stockCode?: string;
}

export interface HkexDirectoryLookupResult {
  query: string;
  source_url: string;
  candidates: HkexDirectoryRecord[];
}

export async function lookupHkexCompanyDirectory(
  input: HkexDirectoryLookupInput,
  context: { userAgent: string; now: string; snapshotStore?: SourceSnapshotStore }
): Promise<HkexDirectoryLookupResult> {
  const bytes = await loadOrFetchDirectorySnapshot({
    url: HKEX_SECURITIES_LIST_URL,
    userAgent: context.userAgent,
    sourceLabel: "HKEX securities list",
    storagePrefix: "entity-directory/hkex",
    extension: "csv",
    now: context.now,
    ...(context.snapshotStore === undefined ? {} : { snapshotStore: context.snapshotStore })
  });
  const records = parseHkexSecuritiesCsv(new TextDecoder("utf8").decode(bytes));
  return {
    query: input.query,
    source_url: HKEX_SECURITIES_LIST_URL,
    candidates: findHkexDirectoryCandidates(records, input)
  };
}

export function parseHkexSecuritiesCsv(text: string): HkexDirectoryRecord[] {
  const records: HkexDirectoryRecord[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const columns = trimmed.split(",").map((column) => column.trim().replace(/^"|"$/g, ""));
    if (columns.length < 2) continue;
    const stockCode = normalizeHkexStockCode(columns[0]);
    const companyName = columns[1]?.trim() ?? "";
    if (stockCode === undefined || companyName.length === 0) continue;
    records.push({
      stockCode,
      companyName,
      names: [companyName]
    });
  }
  return records;
}

export function findHkexDirectoryCandidates(
  records: readonly HkexDirectoryRecord[],
  input: HkexDirectoryLookupInput
): HkexDirectoryRecord[] {
  return findCompanyDirectoryCandidates(records, {
    query: normalizeCompanyDirectoryQuery(input.query),
    ...(input.stockCode === undefined ? {} : { stockCode: input.stockCode }),
    ...(input.limit === undefined ? {} : { limit: input.limit })
  });
}

export function hkexDirectoryIdentifiers(record: HkexDirectoryRecord): Record<string, string> {
  return {
    hkex_stock_code: record.stockCode,
    stock_code: record.stockCode
  };
}

function normalizeHkexStockCode(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 0) return undefined;
  return digits.padStart(5, "0");
}
