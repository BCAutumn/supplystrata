import { urlWithCredentialQueryParam, type SourceSnapshotStore } from "@supplystrata/source-adapter-runtime";
import { findCompanyDirectoryCandidates, normalizeCompanyDirectoryQuery, type CompanyDirectoryMatchInput } from "./company-directory-match.js";
import { loadOrFetchDirectorySnapshot } from "./directory-snapshot.js";
import { extractFirstZipEntry } from "./zip-utils.js";

const OPENDART_CORP_CODE_URL = "https://opendart.fss.or.kr/api/corpCode.xml";

export interface DartKrDirectoryRecord {
  corpCode: string;
  corpName: string;
  corpEngName?: string;
  stockCode?: string;
  names: readonly string[];
}

export interface DartKrDirectoryLookupInput extends CompanyDirectoryMatchInput {
  stockCode?: string;
}

export interface DartKrDirectoryLookupResult {
  query: string;
  source_url: string;
  candidates: DartKrDirectoryRecord[];
}

export async function lookupDartKrCompanyDirectory(
  input: DartKrDirectoryLookupInput,
  context: { apiKey: string; userAgent: string; now: string; snapshotStore?: SourceSnapshotStore }
): Promise<DartKrDirectoryLookupResult> {
  const sourceUrl = urlWithCredentialQueryParam(OPENDART_CORP_CODE_URL, context.apiKey, "crtfc_key", "OpenDART");
  const bytes = await loadOrFetchDirectorySnapshot({
    url: sourceUrl,
    userAgent: context.userAgent,
    sourceLabel: "OpenDART corpCode",
    storagePrefix: "entity-directory/dart-kr",
    extension: "zip",
    now: context.now,
    ...(context.snapshotStore === undefined ? {} : { snapshotStore: context.snapshotStore })
  });
  const records = parseOpenDartCorpCodePayload(bytes);
  return {
    query: input.query,
    source_url: sourceUrl,
    candidates: findDartKrDirectoryCandidates(records, input)
  };
}

export function parseOpenDartCorpCodePayload(bytes: Uint8Array): DartKrDirectoryRecord[] {
  const xmlBytes = extractFirstZipEntry(bytes);
  const xml = new TextDecoder("utf8").decode(xmlBytes);
  return parseOpenDartCorpCodeXml(xml);
}

export function parseOpenDartCorpCodeXml(xml: string): DartKrDirectoryRecord[] {
  const records: DartKrDirectoryRecord[] = [];
  const listPattern = /<list>([\s\S]*?)<\/list>/g;
  for (const match of xml.matchAll(listPattern)) {
    const block = match[1];
    if (block === undefined) continue;
    const corpCode = readXmlTag(block, "corp_code");
    const corpName = readXmlTag(block, "corp_name");
    if (corpCode === undefined || corpName === undefined) continue;
    const corpEngName = readXmlTag(block, "corp_eng_name");
    const stockCode = normalizeListedStockCode(readXmlTag(block, "stock_code"));
    const names = [corpName, ...(corpEngName === undefined ? [] : [corpEngName])];
    records.push({
      corpCode,
      corpName,
      ...(corpEngName === undefined ? {} : { corpEngName }),
      ...(stockCode === undefined ? {} : { stockCode }),
      names
    });
  }
  return records;
}

export function findDartKrDirectoryCandidates(
  records: readonly DartKrDirectoryRecord[],
  input: DartKrDirectoryLookupInput
): DartKrDirectoryRecord[] {
  return findCompanyDirectoryCandidates(records, {
    query: normalizeCompanyDirectoryQuery(input.query),
    ...(input.stockCode === undefined ? {} : { stockCode: input.stockCode }),
    ...(input.limit === undefined ? {} : { limit: input.limit })
  });
}

export function dartKrDirectoryIdentifiers(record: DartKrDirectoryRecord): Record<string, string> {
  return {
    opendart_corp_code: record.corpCode,
    dart_corp_code: record.corpCode,
    corp_code: record.corpCode,
    ...(record.stockCode === undefined ? {} : { kr_stock_code: record.stockCode, stock_code: record.stockCode })
  };
}

function readXmlTag(block: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`).exec(block);
  const value = match?.[1]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function normalizeListedStockCode(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.padStart(6, "0");
}
