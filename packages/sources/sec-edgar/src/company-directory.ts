import { normalizeAlias } from "@supplystrata/core";
import { fetchBytesWithTimeout } from "@supplystrata/source-adapter-runtime";
import { normalizeCik } from "./cik.js";

const SEC_COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";

export interface SecCompanyDirectoryRecord {
  cik: string;
  ticker: string;
  title: string;
  display_name: string;
  entity_id: string;
  source_url: string;
}

export interface SecCompanyDirectoryLookupInput {
  query: string;
  limit?: number;
}

export interface SecCompanyDirectoryLookupResult {
  query: string;
  source_url: string;
  candidates: SecCompanyDirectoryRecord[];
}

export async function lookupSecCompanyDirectory(
  input: SecCompanyDirectoryLookupInput,
  context: { userAgent: string }
): Promise<SecCompanyDirectoryLookupResult> {
  const bytes = await fetchBytesWithTimeout(SEC_COMPANY_TICKERS_URL, {
    userAgent: context.userAgent,
    timeoutMs: 12_000,
    sourceLabel: "SEC company tickers"
  });
  const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
  return {
    query: input.query,
    source_url: SEC_COMPANY_TICKERS_URL,
    candidates: findSecCompanyDirectoryCandidates(parseSecCompanyDirectoryPayload(payload), input)
  };
}

export function parseSecCompanyDirectoryPayload(value: unknown, sourceUrl: string = SEC_COMPANY_TICKERS_URL): SecCompanyDirectoryRecord[] {
  if (!isRecord(value)) throw new Error("SEC company tickers payload must be an object");
  const records: SecCompanyDirectoryRecord[] = [];
  for (const entry of Object.values(value)) {
    if (!isRecord(entry)) continue;
    const cikValue = entry["cik_str"];
    const tickerValue = entry["ticker"];
    const titleValue = entry["title"];
    if ((typeof cikValue !== "string" && typeof cikValue !== "number") || typeof tickerValue !== "string" || typeof titleValue !== "string") continue;
    const ticker = tickerValue.trim().toUpperCase();
    const title = cleanCompanyTitle(titleValue);
    if (ticker.length === 0 || title.length === 0) continue;
    const displayName = displayNameFromSecTitle(title);
    records.push({
      cik: normalizeCik(String(cikValue)),
      ticker,
      title,
      display_name: displayName,
      entity_id: entityIdFromSecCompany({ ticker, displayName }),
      source_url: sourceUrl
    });
  }
  return records.sort((a, b) => a.ticker.localeCompare(b.ticker));
}

export function findSecCompanyDirectoryCandidates(
  records: readonly SecCompanyDirectoryRecord[],
  input: SecCompanyDirectoryLookupInput
): SecCompanyDirectoryRecord[] {
  const query = normalizeCompanyDirectoryQuery(input.query);
  if (query.length === 0) return [];
  const limit = input.limit ?? 5;
  if (!Number.isInteger(limit) || limit < 1) throw new Error("SEC company directory lookup limit must be a positive integer");

  const normalized = normalizeAlias(query);
  const tickerMatches = records.filter((record) => normalizeAlias(record.ticker) === normalized);
  if (tickerMatches.length > 0) return tickerMatches.slice(0, limit);

  const exactTitleMatches = records.filter(
    (record) =>
      normalizeAlias(record.title) === normalized || normalizeAlias(record.display_name) === normalized || normalizeAlias(record.entity_id) === normalized
  );
  if (exactTitleMatches.length > 0) return exactTitleMatches.slice(0, limit);

  if (normalized.length < 4) return [];
  return records
    .filter((record) => normalizeAlias(record.title).includes(normalized) || normalizeAlias(record.display_name).includes(normalized))
    .slice(0, limit);
}

export function normalizeCompanyDirectoryQuery(query: string): string {
  const trimmed = query.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!trimmed.toUpperCase().startsWith("ENT-")) return trimmed;
  return trimmed.slice(4).replace(/-/g, " ").trim();
}

function displayNameFromSecTitle(title: string): string {
  const withoutPunctuationNoise = title.replace(/[,()]/g, " ").replace(/\s+/g, " ").trim();
  const withoutSuffix = withoutPunctuationNoise.replace(/\b(INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO|LIMITED|LTD|PLC|N\.V|NV|S\.A|SA|AG)\.?$/i, "").trim();
  const display = withoutSuffix.length === 0 ? withoutPunctuationNoise : withoutSuffix;
  return display
    .split(/\s+/)
    .map((word) => (word === word.toUpperCase() && word.length > 3 ? `${word.slice(0, 1)}${word.slice(1).toLowerCase()}` : word))
    .join(" ");
}

function entityIdFromSecCompany(input: { ticker: string; displayName: string }): string {
  const readable = input.displayName
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 72);
  return `ENT-${readable.length === 0 ? input.ticker : readable}`;
}

function cleanCompanyTitle(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
