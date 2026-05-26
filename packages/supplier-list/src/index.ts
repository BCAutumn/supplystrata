export interface SupplierListParseConfig {
  sourceAdapterId: string;
  buyerEntityId: string;
  buyerName: string;
  sourceFiscalYear: number;
  locatorPrefix: string;
  confidence: number;
  reviewReason: string;
  ignoredExactLines: readonly string[];
  ignoredLinePrefixes: readonly string[];
}

export interface SupplierListCandidate {
  buyer_entity_id: string;
  buyer_name: string;
  supplier_name: string;
  location_text: string;
  country_or_region: string;
  source_row_text: string;
  normalized_record_text: string;
  source_adapter_id: string;
  source_fiscal_year: number;
  source_locator: string;
  confidence: number;
  needs_review: true;
  review_reason: string;
  relation_hint: "BUYS_FROM";
  facility_relation_hint: "MANUFACTURES_AT";
}

export function normalizeSupplierListCitationText(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim();
}

// DQ 要求 active evidence 的 cite_text 足够长；短 facility 行需要带一点相邻原文上下文，但仍必须是 chunk 子串。
const MIN_SUPPLIER_LIST_CITATION_CHARS = 30;

export interface SupplierListCitationWindowInput {
  chunkText: string;
  supplierName: string;
  sourceRowText: string;
  locationText: string;
  countryOrRegion: string;
}

export function findSupplierListCitationWindow(input: SupplierListCitationWindowInput): string | undefined {
  const supplierSpan = findFlexibleSpan(input.chunkText, input.supplierName, 0);
  if (supplierSpan === undefined) return undefined;

  const rowText = normalizeSupplierListCitationText(input.sourceRowText);
  const locationAndCountry = normalizeSupplierListCitationText(`${input.locationText} ${input.countryOrRegion}`);
  const rowSpan = rowText.length > 0 ? findFlexibleSpan(input.chunkText, rowText, supplierSpan.start) : undefined;
  const contextSpan = rowSpan ?? findFlexibleSpan(input.chunkText, locationAndCountry, supplierSpan.end);
  if (contextSpan === undefined) return undefined;
  return expandSupplierListCitationWindow(input.chunkText, supplierSpan.start, contextSpan.end);
}

export function extractFixedWidthSupplierListCandidates(text: string, config: SupplierListParseConfig): SupplierListCandidate[] {
  const candidates: SupplierListCandidate[] = [];
  let currentSupplier: string | undefined;
  let logicalLine = 0;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\s+$/g, "");
    if (shouldSkipLine(line, config)) continue;
    const columns = line
      .trim()
      .split(/\s{2,}/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (columns.length < 2) continue;
    logicalLine += 1;

    const startsWithText = /^\S/.test(line);
    const parsed = parseCandidateColumns(columns, startsWithText, currentSupplier);
    if (parsed === undefined) continue;
    currentSupplier = parsed.supplier;
    const sourceRowText = line.trim();
    const normalizedRecordText = `${config.buyerName} | ${parsed.supplier} | ${parsed.location} | ${parsed.country}`;
    candidates.push({
      buyer_entity_id: config.buyerEntityId,
      buyer_name: config.buyerName,
      supplier_name: parsed.supplier,
      location_text: parsed.location,
      country_or_region: parsed.country,
      source_row_text: sourceRowText,
      normalized_record_text: normalizedRecordText,
      source_adapter_id: config.sourceAdapterId,
      source_fiscal_year: config.sourceFiscalYear,
      source_locator: `${config.locatorPrefix} line ${logicalLine}`,
      confidence: config.confidence,
      needs_review: true,
      review_reason: config.reviewReason,
      relation_hint: "BUYS_FROM",
      facility_relation_hint: "MANUFACTURES_AT"
    });
  }

  return candidates;
}

function findFlexibleSpan(text: string, phrase: string, startAt: number): { start: number; end: number } | undefined {
  const tokens = normalizeSupplierListCitationText(phrase)
    .split(" ")
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return undefined;
  const pattern = tokens.map(escapeRegExp).join("\\s+");
  const match = new RegExp(pattern).exec(text.slice(startAt));
  if (match?.index === undefined) return undefined;
  const start = startAt + match.index;
  return { start, end: start + match[0].length };
}

function expandSupplierListCitationWindow(chunkText: string, start: number, end: number): string {
  let expandedStart = start;
  let expandedEnd = end;
  while (normalizedCitationLength(chunkText, expandedStart, expandedEnd) < MIN_SUPPLIER_LIST_CITATION_CHARS && expandedEnd < chunkText.length) {
    expandedEnd += 1;
  }
  while (expandedEnd < chunkText.length && !/\s/.test(chunkText[expandedEnd] ?? "")) {
    expandedEnd += 1;
  }
  while (normalizedCitationLength(chunkText, expandedStart, expandedEnd) < MIN_SUPPLIER_LIST_CITATION_CHARS && expandedStart > 0) {
    expandedStart -= 1;
  }
  while (expandedStart > 0 && !/\s/.test(chunkText[expandedStart - 1] ?? "")) {
    expandedStart -= 1;
  }
  return chunkText.slice(expandedStart, expandedEnd).trim();
}

function normalizedCitationLength(chunkText: string, start: number, end: number): number {
  return normalizeSupplierListCitationText(chunkText.slice(start, end)).length;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseCandidateColumns(
  columns: string[],
  startsWithText: boolean,
  currentSupplier: string | undefined
): { supplier: string; location: string; country: string } | undefined {
  if (startsWithText) {
    const [supplier, location, country] = columns;
    if (supplier === undefined || location === undefined || country === undefined) return undefined;
    return { supplier, location, country };
  }
  if (currentSupplier === undefined) return undefined;
  const [location, country] = columns;
  if (location === undefined || country === undefined) return undefined;
  return { supplier: currentSupplier, location, country };
}

function shouldSkipLine(line: string, config: SupplierListParseConfig): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length === 0 ||
    /^\d+$/.test(trimmed) ||
    /^Supplier List\s+\d+$/.test(trimmed) ||
    config.ignoredExactLines.includes(trimmed) ||
    config.ignoredLinePrefixes.some((prefix) => trimmed.startsWith(prefix))
  );
}
