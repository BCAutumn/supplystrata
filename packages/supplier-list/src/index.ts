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

export function extractFixedWidthSupplierListCandidates(text: string, config: SupplierListParseConfig): SupplierListCandidate[] {
  const candidates: SupplierListCandidate[] = [];
  let currentSupplier: string | undefined;
  let logicalLine = 0;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\s+$/g, "");
    if (shouldSkipLine(line, config)) continue;
    const columns = line.trim().split(/\s{2,}/).map((item) => item.trim()).filter((item) => item.length > 0);
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

function parseCandidateColumns(columns: string[], startsWithText: boolean, currentSupplier: string | undefined): { supplier: string; location: string; country: string } | undefined {
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
    config.ignoredExactLines.includes(trimmed) ||
    config.ignoredLinePrefixes.some((prefix) => trimmed.startsWith(prefix))
  );
}
