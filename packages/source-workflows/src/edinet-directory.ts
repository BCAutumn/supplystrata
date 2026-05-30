import { type SourceSnapshotStore } from "@supplystrata/source-adapter-runtime";
import { findCompanyDirectoryCandidates, normalizeCompanyDirectoryQuery, type CompanyDirectoryMatchInput } from "./company-directory-match.js";
import { loadOrFetchDirectorySnapshot } from "./directory-snapshot.js";

const EDINET_CODE_LIST_URL = "https://disclosure.edinet-fsa.go.jp/E01EW/BLMainEdinet.php?cmd=edinetCodeDownload";

export interface EdinetDirectoryRecord {
  edinetCode: string;
  secCode?: string;
  filerName: string;
  names: readonly string[];
}

export interface EdinetDirectoryLookupInput extends CompanyDirectoryMatchInput {
  secCode?: string;
}

export interface EdinetDirectoryLookupResult {
  query: string;
  source_url: string;
  candidates: EdinetDirectoryRecord[];
}

export async function lookupEdinetCompanyDirectory(
  input: EdinetDirectoryLookupInput,
  context: { userAgent: string; now: string; snapshotStore?: SourceSnapshotStore }
): Promise<EdinetDirectoryLookupResult> {
  const bytes = await loadOrFetchDirectorySnapshot({
    url: EDINET_CODE_LIST_URL,
    userAgent: context.userAgent,
    sourceLabel: "EDINET code list",
    storagePrefix: "entity-directory/edinet",
    extension: "csv",
    now: context.now,
    ...(context.snapshotStore === undefined ? {} : { snapshotStore: context.snapshotStore })
  });
  const records = parseEdinetCodeCsv(new TextDecoder("utf8").decode(bytes));
  return {
    query: input.query,
    source_url: EDINET_CODE_LIST_URL,
    candidates: findEdinetDirectoryCandidates(records, input)
  };
}

export function parseEdinetCodeCsv(text: string): EdinetDirectoryRecord[] {
  const records: EdinetDirectoryRecord[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const columns = splitCsvLine(trimmed);
    if (columns.length < 3) continue;
    const edinetCode = columns[0]?.trim();
    const secCode = normalizeSecCode(columns[2]?.trim());
    const filerName = columns[6]?.trim() ?? columns[1]?.trim() ?? "";
    if (edinetCode === undefined || edinetCode.length === 0 || filerName.length === 0) continue;
    records.push({
      edinetCode,
      ...(secCode === undefined ? {} : { secCode }),
      filerName,
      names: [filerName]
    });
  }
  return records;
}

export function findEdinetDirectoryCandidates(
  records: readonly EdinetDirectoryRecord[],
  input: EdinetDirectoryLookupInput
): EdinetDirectoryRecord[] {
  if (input.secCode !== undefined) {
    const normalizedSecCode = normalizeSecCode(input.secCode);
    if (normalizedSecCode !== undefined) {
      const secMatches = records.filter((record) => record.secCode === normalizedSecCode);
      if (secMatches.length > 0) return secMatches.slice(0, input.limit ?? 5);
    }
  }
  return findCompanyDirectoryCandidates(
    records.map((record) => ({
      ...record,
      ...(record.secCode === undefined ? {} : { stockCode: record.secCode })
    })),
    {
      query: normalizeCompanyDirectoryQuery(input.query),
      ...(input.secCode === undefined ? {} : { stockCode: input.secCode }),
      ...(input.limit === undefined ? {} : { limit: input.limit })
    }
  );
}

export function edinetDirectoryIdentifiers(record: EdinetDirectoryRecord): Record<string, string> {
  return {
    edinet_code: record.edinetCode,
    ...(record.secCode === undefined ? {} : { jp_sec_code: record.secCode, securities_code: record.secCode })
  };
}

function splitCsvLine(line: string): string[] {
  const columns: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      columns.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  columns.push(current);
  return columns;
}

function normalizeSecCode(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === "-") return undefined;
  return trimmed.replace(/^0+/, "") || "0";
}
