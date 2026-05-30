import { normalizeAlias } from "@supplystrata/core";

export interface CompanyDirectoryMatchInput {
  query: string;
  stockCode?: string;
  limit?: number;
}

export interface CompanyDirectoryRecord {
  names: readonly string[];
  stockCode?: string;
}

export function normalizeCompanyDirectoryQuery(query: string): string {
  const trimmed = query.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!trimmed.toUpperCase().startsWith("ENT-")) return trimmed;
  return trimmed.slice(4).replace(/-/g, " ").trim();
}

export function findCompanyDirectoryCandidates<T extends CompanyDirectoryRecord>(
  records: readonly T[],
  input: CompanyDirectoryMatchInput
): T[] {
  const query = normalizeCompanyDirectoryQuery(input.query);
  const limit = input.limit ?? 5;
  if (query.length === 0 || !Number.isInteger(limit) || limit < 1) return [];

  const normalizedQuery = normalizeAlias(query);
  const normalizedStock = normalizeStockCode(input.stockCode);
  if (normalizedStock !== undefined) {
    const stockMatches = records.filter((record) => normalizeStockCode(record.stockCode) === normalizedStock);
    if (stockMatches.length > 0) return stockMatches.slice(0, limit);
  }

  const exactNameMatches = records.filter((record) =>
    record.names.some((name) => {
      const normalizedName = normalizeAlias(name);
      return normalizedName === normalizedQuery || normalizeAlias(stripCorporateSuffix(name)) === normalizedQuery;
    })
  );
  if (exactNameMatches.length > 0) return exactNameMatches.slice(0, limit);

  if (normalizedQuery.length < 4) return [];
  return records
    .filter((record) =>
      record.names.some((name) => {
        const normalizedName = normalizeAlias(name);
        return normalizedName.includes(normalizedQuery) || normalizedQuery.includes(normalizeAlias(stripCorporateSuffix(name)));
      })
    )
    .slice(0, limit);
}

function normalizeStockCode(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.replace(/^0+/, "") || "0";
}

function stripCorporateSuffix(name: string): string {
  return name
    .replace(/[,()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(
      /\b(incorporated|inc|corporation|corp|company|co|limited|ltd|plc|co\.?\s*ltd\.?|holdings|group|electronic|electronics)\.?$/i,
      ""
    )
    .trim();
}
