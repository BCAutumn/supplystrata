import type { SourceCheckTargetInput } from "@supplystrata/source-monitor";

export type OfficialDirectoryRouteStatus = "routable" | "missing_identifier" | "unsupported_country";

export interface CompanyOfficialDirectoryIdentity {
  entity_id: string;
  display_name: string;
  primary_country: string | null;
  identifiers: Record<string, unknown>;
}

export interface CountryOfficialDirectoryRoutingInput {
  identity: CompanyOfficialDirectoryIdentity;
  namespace: string;
  now: string;
  year?: number;
}

export interface OfficialDirectoryRoute {
  country: string;
  source_adapter_id: "sec-edgar" | "dart-kr" | "edinet" | "twse-mops" | "hkex-news" | "companies-house" | "gleif";
  status: OfficialDirectoryRouteStatus;
  reason: string;
  check_target_ids: string[];
}

export interface CountryOfficialDirectoryRoutingResult {
  country: string;
  routes: OfficialDirectoryRoute[];
  check_targets: SourceCheckTargetInput[];
}

export function routeCountryOfficialDirectoryTargets(input: CountryOfficialDirectoryRoutingInput): CountryOfficialDirectoryRoutingResult {
  const country = normalizeCountry(input.identity.primary_country);
  const year = input.year ?? new Date(input.now).getUTCFullYear();
  if (country === "US") return routeUnitedStates(input, country);
  if (country === "KR") return routeKorea(input, country, year);
  if (country === "JP") return routeJapan(input, country);
  if (country === "TW") return routeTaiwan(input, country, year);
  if (country === "HK") return routeHongKong(input, country);
  if (country === "GB") return unsupportedRegistryOnlyRoute("GB", "companies-house");
  if (EU_COUNTRIES.has(country)) return unsupportedRegistryOnlyRoute(country, "gleif");
  return {
    country,
    routes: [
      {
        country,
        source_adapter_id: "gleif",
        status: "unsupported_country",
        reason: `No official disclosure directory route is configured for country ${country}.`,
        check_target_ids: []
      }
    ],
    check_targets: []
  };
}

function routeUnitedStates(input: CountryOfficialDirectoryRoutingInput, country: string): CountryOfficialDirectoryRoutingResult {
  const cik = optionalIdentifier(input.identity.identifiers, ["cik"]);
  if (cik === undefined) return missingIdentifierRoute(country, "sec-edgar", "CIK is required for SEC EDGAR source targets.");
  const targets: SourceCheckTargetInput[] = [
    {
      check_target_id: routeTargetId(input.namespace, "sec-edgar", "sec-company-filings", input.identity.entity_id),
      source_adapter_id: "sec-edgar",
      target_kind: "sec-company-filings",
      subject_entity_id: input.identity.entity_id,
      enabled: true,
      priority: 10,
      next_check_at: input.now,
      target_config: {
        cik,
        entity_id: input.identity.entity_id,
        form_types: ["10-K", "20-F", "10-Q", "8-K"],
        limit: 3
      },
      notes: `Official SEC filings target for research run on ${input.identity.display_name}.`
    },
    {
      check_target_id: routeTargetId(input.namespace, "sec-edgar", "sec-company-facts", input.identity.entity_id),
      source_adapter_id: "sec-edgar",
      target_kind: "sec-company-facts",
      subject_entity_id: input.identity.entity_id,
      enabled: true,
      priority: 20,
      next_check_at: input.now,
      target_config: {
        cik,
        entity_id: input.identity.entity_id,
        max_periods: 8
      },
      notes: `Official SEC companyfacts target for research run on ${input.identity.display_name}.`
    }
  ];
  return routable(country, "sec-edgar", targets, "Routed to SEC EDGAR using CIK.");
}

function routeKorea(input: CountryOfficialDirectoryRoutingInput, country: string, year: number): CountryOfficialDirectoryRoutingResult {
  const corpCode = optionalIdentifier(input.identity.identifiers, ["opendart_corp_code", "dart_corp_code", "corp_code"]);
  if (corpCode === undefined) return missingIdentifierRoute(country, "dart-kr", "OpenDART corporation code is required for Korea DART source targets.");
  const targets: SourceCheckTargetInput[] = [
    {
      check_target_id: routeTargetId(input.namespace, "dart-kr", "company-filings", input.identity.entity_id),
      source_adapter_id: "dart-kr",
      target_kind: "company-filings",
      subject_entity_id: input.identity.entity_id,
      enabled: true,
      priority: 10,
      next_check_at: input.now,
      target_config: {
        corp_code: corpCode,
        entity_id: input.identity.entity_id,
        disclosure_types: ["A", "F"],
        year,
        final_reports_only: "Y",
        limit: 20
      },
      notes: `OpenDART disclosure-list target for research run on ${input.identity.display_name}.`
    }
  ];
  return routable(country, "dart-kr", targets, "Routed to Korea DART using OpenDART corporation code.");
}

function routeJapan(input: CountryOfficialDirectoryRoutingInput, country: string): CountryOfficialDirectoryRoutingResult {
  const edinetCode = optionalIdentifier(input.identity.identifiers, ["edinet_code"]);
  const secCode = optionalIdentifier(input.identity.identifiers, ["jp_sec_code", "securities_code"]);
  if (edinetCode === undefined && secCode === undefined) {
    return missingIdentifierRoute(country, "edinet", "EDINET code or Japanese securities code is required for EDINET source targets.");
  }
  const targetConfig = {
    date: input.now.slice(0, 10),
    entity_id: input.identity.entity_id,
    scope_kind: "company",
    scope_id: input.identity.entity_id,
    ...(edinetCode === undefined ? {} : { edinet_codes: [edinetCode] }),
    ...(secCode === undefined ? {} : { sec_codes: [secCode] })
  };
  const targets: SourceCheckTargetInput[] = [
    {
      check_target_id: routeTargetId(input.namespace, "edinet", "daily-filings", input.identity.entity_id),
      source_adapter_id: "edinet",
      target_kind: "daily-filings",
      subject_entity_id: input.identity.entity_id,
      enabled: true,
      priority: 10,
      next_check_at: input.now,
      target_config: targetConfig,
      notes: `EDINET daily filings target for research run on ${input.identity.display_name}.`
    }
  ];
  return routable(country, "edinet", targets, "Routed to Japan EDINET using EDINET/securities code.");
}

function routeTaiwan(input: CountryOfficialDirectoryRoutingInput, country: string, year: number): CountryOfficialDirectoryRoutingResult {
  const stockCode = optionalIdentifier(input.identity.identifiers, ["twse_stock_code", "stock_code", "ticker"]);
  if (stockCode === undefined) return missingIdentifierRoute(country, "twse-mops", "TWSE/MOPS stock code is required for Taiwan source targets.");
  const targets: SourceCheckTargetInput[] = [
    {
      check_target_id: routeTargetId(input.namespace, "twse-mops", "electronic-documents", input.identity.entity_id),
      source_adapter_id: "twse-mops",
      target_kind: "electronic-documents",
      subject_entity_id: input.identity.entity_id,
      enabled: true,
      priority: 10,
      next_check_at: input.now,
      target_config: {
        stock_code: stockCode,
        entity_id: input.identity.entity_id,
        year,
        document_kind: "F",
        limit: 20
      },
      notes: `TWSE MOPS electronic-documents target for research run on ${input.identity.display_name}.`
    }
  ];
  return routable(country, "twse-mops", targets, "Routed to Taiwan MOPS using TWSE stock code.");
}

function routeHongKong(input: CountryOfficialDirectoryRoutingInput, country: string): CountryOfficialDirectoryRoutingResult {
  const stockCode = optionalIdentifier(input.identity.identifiers, ["hkex_stock_code", "stock_code", "ticker"]);
  if (stockCode === undefined) return missingIdentifierRoute(country, "hkex-news", "HKEX stock code is required for HKEXnews source targets.");
  const targets: SourceCheckTargetInput[] = [
    {
      check_target_id: routeTargetId(input.namespace, "hkex-news", "title-search", input.identity.entity_id),
      source_adapter_id: "hkex-news",
      target_kind: "title-search",
      subject_entity_id: input.identity.entity_id,
      enabled: true,
      priority: 10,
      next_check_at: input.now,
      target_config: {
        stock_code: stockCode,
        entity_id: input.identity.entity_id,
        from_date: oneMonthBefore(input.now),
        to_date: input.now.slice(0, 10),
        limit: 50
      },
      notes: `HKEXnews title-search metadata target for research run on ${input.identity.display_name}.`
    }
  ];
  return routable(country, "hkex-news", targets, "Routed to HKEXnews title search using HKEX stock code.");
}

function routable(
  country: string,
  sourceAdapterId: OfficialDirectoryRoute["source_adapter_id"],
  targets: SourceCheckTargetInput[],
  reason: string
): CountryOfficialDirectoryRoutingResult {
  return {
    country,
    routes: [
      {
        country,
        source_adapter_id: sourceAdapterId,
        status: "routable",
        reason,
        check_target_ids: targets.map((target) => target.check_target_id)
      }
    ],
    check_targets: targets
  };
}

function missingIdentifierRoute(
  country: string,
  sourceAdapterId: OfficialDirectoryRoute["source_adapter_id"],
  reason: string
): CountryOfficialDirectoryRoutingResult {
  return {
    country,
    routes: [{ country, source_adapter_id: sourceAdapterId, status: "missing_identifier", reason, check_target_ids: [] }],
    check_targets: []
  };
}

function unsupportedRegistryOnlyRoute(country: string, sourceAdapterId: "companies-house" | "gleif"): CountryOfficialDirectoryRoutingResult {
  return {
    country,
    routes: [
      {
        country,
        source_adapter_id: sourceAdapterId,
        status: "unsupported_country",
        reason: `${sourceAdapterId} can identify the entity, but no official disclosure source-check target exists yet for ${country}.`,
        check_target_ids: []
      }
    ],
    check_targets: []
  };
}

function routeTargetId(namespace: string, sourceAdapterId: string, targetKind: string, entityId: string): string {
  return `research:${namespace}:${sourceAdapterId}:${targetKind}:${entityId.toLowerCase()}`;
}

function normalizeCountry(value: string | null): string {
  if (value === null || value.trim().length === 0) return "UNKNOWN";
  const country = value.trim().toUpperCase();
  if (country === "UK") return "GB";
  return country;
}

// Phase C 的路由只接受已确认的市场目录标识；不能从名称、LEI 或 ticker 猜测本地登记号。
function optionalIdentifier(identifiers: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = identifiers[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

function oneMonthBefore(now: string): string {
  const date = new Date(now);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 10);
}

const EU_COUNTRIES = new Set([
  "AT",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "HU",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK"
]);
