import { createHash } from "node:crypto";
import { loadEnv, requireEnvValue } from "@supplystrata/config";
import { createId, type FetchTask, type NormalizedDocument, type RawDocument } from "@supplystrata/core";
import {
  createFsSnapshotStore,
  createRateLimitedSourceAdapter,
  fetchBytesWithTimeout,
  requireSnapshotStore,
  type AdapterContext,
  type SourceAdapter
} from "@supplystrata/source-adapter-runtime";
import { normalizeTextDocument } from "@supplystrata/source-normalizers";

export const CENSUS_TRADE_DIRECTIONS = ["imports", "exports"] as const;

export type CensusTradeDirection = (typeof CENSUS_TRADE_DIRECTIONS)[number];

export interface CensusTradeInput {
  direction: CensusTradeDirection;
  time: string;
  commodityCode: string;
  countryCode?: string;
  componentId?: string;
  scopeId?: string;
}

export interface CensusTradeRow {
  direction: CensusTradeDirection;
  time: string;
  commodity_code: string;
  commodity_description?: string;
  country_code?: string;
  country_name?: string;
  value_usd: string;
  metric_name: string;
}

const censusTradeAdapterBase: SourceAdapter<CensusTradeInput, Uint8Array> = {
  id: "census-trade",
  tier: "P1",
  description: "U.S. Census International Trade API for HS-code trade flow observations",
  tos_url: "https://www.census.gov/data/developers/about/terms-of-service.html",
  rate_limit: { requests: 1, per_seconds: 1 },
  async *plan(input) {
    yield {
      task_id: `census-trade-${input.direction}-${input.time}-${stableInputId(input)}`,
      url: buildCensusTradeUrl(input),
      expected_format: "json",
      hint: { document_type: "trade_dataset", period: monthEndDate(input.time) }
    };
  },
  async fetch(task, ctx) {
    // API key 只在真实抓取 URL 上附加；task.url 作为 provenance 入库时保持无密钥。
    const key = requireEnvValue(loadEnv().CENSUS_API_KEY, "CENSUS_API_KEY");
    const bytes = await fetchBytesWithTimeout(censusFetchUrl(task.url, key), {
      userAgent: ctx.userAgent,
      timeoutMs: 15_000,
      sourceLabel: "U.S. Census International Trade",
      headers: { Accept: "application/json" }
    });
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const metadata = taskMetadataFromUrl(task.url);
    const storageKey = `trade/census/${metadata.direction}/hs/${metadata.time}/${sha256}.json`;
    await requireSnapshotStore(ctx, "census-trade").put(storageKey, bytes);
    return {
      doc_id: createId("DOC"),
      source_adapter_id: "census-trade",
      url: task.url,
      fetched_at: ctx.now().toISOString(),
      bytes_sha256: sha256,
      storage_key: storageKey,
      body: bytes,
      metadata: {
        task_id: task.task_id,
        document_type: "trade_dataset",
        source_date: monthEndDate(metadata.time),
        direction: metadata.direction,
        time: metadata.time,
        commodity_code: metadata.commodityCode,
        ...(metadata.countryCode === undefined ? {} : { country_code: metadata.countryCode })
      }
    };
  },
  async normalize(raw) {
    return normalizeCensusTradeDocument(raw);
  }
};

export const censusTradeAdapter = createRateLimitedSourceAdapter(censusTradeAdapterBase);

export function createCensusTradeAdapterContext(): AdapterContext {
  const env = loadEnv();
  return { userAgent: env.SEC_USER_AGENT, now: () => new Date(), snapshotStore: createFsSnapshotStore(env.OBJECT_STORE_FS_BASE) };
}

export function buildCensusTradeUrl(input: CensusTradeInput): string {
  validateCensusTradeInput(input);
  const url = new URL(`https://api.census.gov/data/timeseries/intltrade/${input.direction}/hs`);
  const variableSet = censusVariablesForDirection(input.direction);
  url.searchParams.set("get", variableSet.join(","));
  url.searchParams.set("time", input.time);
  url.searchParams.set(variableSet.commodityCodeVariable, input.commodityCode.trim());
  if (input.countryCode !== undefined && input.countryCode.trim().length > 0) {
    url.searchParams.set("CTY_CODE", input.countryCode.trim());
  }
  return url.toString();
}

export function censusFetchUrl(publicUrl: string, apiKey: string): string {
  const trimmedKey = apiKey.trim();
  if (trimmedKey.length === 0) throw new Error("Census API key must not be empty");
  const url = new URL(publicUrl);
  url.searchParams.set("key", trimmedKey);
  return url.toString();
}

export function parseCensusTradeRows(bytes: Uint8Array, direction: CensusTradeDirection): CensusTradeRow[] {
  const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("Census Trade response must be a non-empty table array");
  const headers = parseStringArray(parsed[0], "Census Trade header row");
  const index = headerIndex(headers);
  const variables = censusVariablesForDirection(direction);
  const rows: CensusTradeRow[] = [];

  for (let rowIndex = 1; rowIndex < parsed.length; rowIndex += 1) {
    const cells = parseStringArray(parsed[rowIndex], `Census Trade row ${rowIndex}`);
    const commodityDescription = optionalCell(cells, index, variables.commodityDescriptionVariable);
    const countryCode = optionalCell(cells, index, "CTY_CODE");
    const countryName = optionalCell(cells, index, "CTY_NAME");
    const row: CensusTradeRow = {
      direction,
      time: cell(cells, index, "time"),
      commodity_code: cell(cells, index, variables.commodityCodeVariable),
      value_usd: requireNumericCell(cells, index, variables.valueVariable),
      metric_name: variables.valueVariable
    };
    if (commodityDescription !== undefined) row.commodity_description = commodityDescription;
    if (countryCode !== undefined) row.country_code = countryCode;
    if (countryName !== undefined) row.country_name = countryName;
    rows.push(row);
  }

  return rows;
}

function normalizeCensusTradeDocument(raw: RawDocument<Uint8Array>): NormalizedDocument {
  const direction = directionFromMetadata(raw.metadata["direction"]);
  const rows = parseCensusTradeRows(raw.body, direction);
  const input = {
    raw,
    documentType: "trade_dataset",
    parserVersion: "census-trade-json-v1",
    text: rows.map(formatCensusTradeRow).join("\n"),
    extraMetadata: { row_count: rows.length }
  } satisfies Parameters<typeof normalizeTextDocument>[0];
  const sourceDate = stringMetadata(raw.metadata, "source_date");
  return normalizeTextDocument(sourceDate === undefined ? input : { ...input, sourceDate });
}

function formatCensusTradeRow(row: CensusTradeRow): string {
  return [
    `direction: ${row.direction}`,
    `time: ${row.time}`,
    `commodity_code: ${row.commodity_code}`,
    row.commodity_description === undefined ? undefined : `commodity_description: ${row.commodity_description}`,
    row.country_code === undefined ? undefined : `country_code: ${row.country_code}`,
    row.country_name === undefined ? undefined : `country_name: ${row.country_name}`,
    `metric_name: ${row.metric_name}`,
    `value_usd: ${row.value_usd}`
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function validateCensusTradeInput(input: CensusTradeInput): void {
  if (!isCensusTradeDirection(input.direction)) throw new Error(`Unsupported Census Trade direction: ${input.direction}`);
  validateMonth(input.time);
  const commodity = input.commodityCode.trim();
  if (!/^\d{2,10}$/.test(commodity)) throw new Error(`Census Trade commodityCode must be a 2-10 digit HS code: ${input.commodityCode}`);
  if (input.countryCode !== undefined && input.countryCode.trim().length > 0 && !/^\d{4}$/.test(input.countryCode.trim())) {
    throw new Error(`Census Trade countryCode must be a 4 digit Census country code: ${input.countryCode}`);
  }
}

function censusVariablesForDirection(direction: CensusTradeDirection): {
  commodityCodeVariable: "I_COMMODITY" | "E_COMMODITY";
  commodityDescriptionVariable: "I_COMMODITY_LDESC" | "E_COMMODITY_LDESC";
  valueVariable: "GEN_VAL_MO" | "ALL_VAL_MO";
  join(separator: string): string;
} {
  if (direction === "imports") {
    return {
      commodityCodeVariable: "I_COMMODITY",
      commodityDescriptionVariable: "I_COMMODITY_LDESC",
      valueVariable: "GEN_VAL_MO",
      join(separator) {
        return ["time", "I_COMMODITY", "I_COMMODITY_LDESC", "CTY_CODE", "CTY_NAME", "GEN_VAL_MO"].join(separator);
      }
    };
  }
  return {
    commodityCodeVariable: "E_COMMODITY",
    commodityDescriptionVariable: "E_COMMODITY_LDESC",
    valueVariable: "ALL_VAL_MO",
    join(separator) {
      return ["time", "E_COMMODITY", "E_COMMODITY_LDESC", "CTY_CODE", "CTY_NAME", "ALL_VAL_MO"].join(separator);
    }
  };
}

export function isCensusTradeDirection(value: string): value is CensusTradeDirection {
  return value === "imports" || value === "exports";
}

function taskMetadataFromUrl(publicUrl: string): { direction: CensusTradeDirection; time: string; commodityCode: string; countryCode?: string } {
  const url = new URL(publicUrl);
  const match = url.pathname.match(/\/intltrade\/(imports|exports)\/hs$/u);
  if (match === null) throw new Error(`Unsupported Census Trade URL path: ${url.pathname}`);
  const direction = directionFromMetadata(match[1]);
  const variables = censusVariablesForDirection(direction);
  const time = requireSearchParam(url, "time");
  return {
    direction,
    time,
    commodityCode: requireSearchParam(url, variables.commodityCodeVariable),
    ...(url.searchParams.get("CTY_CODE") === null ? {} : { countryCode: requireSearchParam(url, "CTY_CODE") })
  };
}

function stableInputId(input: CensusTradeInput): string {
  return createHash("sha256")
    .update(`${input.direction}|${input.time}|${input.commodityCode}|${input.countryCode ?? ""}|${input.componentId ?? ""}|${input.scopeId ?? ""}`)
    .digest("hex")
    .slice(0, 16);
}

function parseStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => {
    if (typeof item !== "string") throw new Error(`${label}[${index}] must be a string`);
    return item;
  });
}

function headerIndex(headers: readonly string[]): Map<string, number> {
  return new Map(headers.map((header, index) => [header, index]));
}

function cell(cells: readonly string[], index: Map<string, number>, header: string): string {
  const value = optionalCell(cells, index, header);
  if (value === undefined) throw new Error(`Census Trade response missing required column: ${header}`);
  return value;
}

function optionalCell(cells: readonly string[], index: Map<string, number>, header: string): string | undefined {
  const cellIndex = index.get(header);
  if (cellIndex === undefined) return undefined;
  const value = cells[cellIndex];
  return value === undefined || value.trim().length === 0 ? undefined : value.trim();
}

function requireNumericCell(cells: readonly string[], index: Map<string, number>, header: string): string {
  const value = cell(cells, index, header);
  if (!/^-?\d+(\.\d+)?$/u.test(value)) throw new Error(`Census Trade ${header} must be numeric: ${value}`);
  return value;
}

function directionFromMetadata(value: unknown): CensusTradeDirection {
  if (value !== "imports" && value !== "exports") throw new Error(`Unsupported Census Trade direction metadata: ${String(value)}`);
  return value;
}

function validateMonth(value: string): void {
  const match = value.match(/^(\d{4})-(\d{2})$/u);
  if (match === null) throw new Error(`Census Trade time must be YYYY-MM: ${value}`);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error(`Census Trade month is outside 01-12: ${value}`);
}

function monthEndDate(month: string): string {
  validateMonth(month);
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText);
  return new Date(Date.UTC(year, monthIndex, 0)).toISOString().slice(0, 10);
}

function requireSearchParam(url: URL, key: string): string {
  const value = url.searchParams.get(key);
  if (value === null || value.trim().length === 0) throw new Error(`Census Trade URL missing ${key}`);
  return value.trim();
}

function stringMetadata(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" ? value : undefined;
}
