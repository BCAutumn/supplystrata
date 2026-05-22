import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { type FetchTask, type NormalizedDocument, type RawDocument } from "@supplystrata/core";
import {
  createAdapterContext as createRuntimeAdapterContext,
  createRateLimitedSourceAdapter,
  fetchBytesWithTimeout,
  persistRawDocumentSnapshot,
  type AdapterContext,
  type CreateAdapterContextInput,
  type SourceAdapter
} from "@supplystrata/source-adapter-runtime";
import { normalizeTextDocument } from "@supplystrata/source-normalizers";

export interface WorldBankPinkInput {
  commodity: string;
  period: string;
  materialId?: string;
  componentId?: string;
  scopeId?: string;
}

export interface WorldBankPinkRow {
  commodity: string;
  commodity_code: string;
  period: string;
  price: string;
  unit: string;
  metric_name: string;
}

export interface WorldBankPinkLinks {
  monthlyUrl: string;
  annualUrl?: string;
}

const WORLD_BANK_COMMODITY_MARKETS_URL = "https://www.worldbank.org/en/research/commodity-markets";

const COMMODITY_CODE_BY_ALIAS = new Map<string, string>([
  ["aluminum", "ALUMINUM"],
  ["aluminium", "ALUMINUM"],
  ["copper", "COPPER"],
  ["nickel", "NICKEL"],
  ["tin", "Tin"],
  ["zinc", "Zinc"]
]);

const worldBankPinkAdapterBase: SourceAdapter<WorldBankPinkInput, Uint8Array> = {
  id: "worldbank-pink",
  tier: "P1",
  description: "World Bank Pink Sheet monthly commodity prices for material-level observations",
  tos_url: "https://www.worldbank.org/en/about/legal/terms-and-conditions",
  rate_limit: { requests: 1, per_seconds: 1 },
  async *plan(input, ctx) {
    validateWorldBankPinkInput(input);
    const links = await discoverWorldBankPinkSheetLinksFromOfficialPage(ctx);
    yield {
      task_id: `worldbank-pink-${normalizeCommodity(input.commodity)}-${input.period}-${stableInputId(input)}`,
      url: links.monthlyUrl,
      expected_format: "excel",
      params: {
        commodity: normalizeCommodity(input.commodity),
        period: input.period,
        material_id: input.materialId,
        component_id: input.componentId,
        scope_id: input.scopeId
      },
      hint: { document_type: "trade_dataset", period: monthEndDate(input.period) }
    };
  },
  async fetch(task, ctx) {
    const bytes = await fetchBytesWithTimeout(task.url, {
      userAgent: ctx.userAgent,
      timeoutMs: 20_000,
      sourceLabel: "World Bank Pink Sheet",
      headers: {
        Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,*/*"
      }
    });
    const commodity = requiredTaskParam(task, "commodity");
    const period = requiredTaskParam(task, "period");
    return persistRawDocumentSnapshot({
      ctx,
      sourceAdapterId: "worldbank-pink",
      url: task.url,
      body: bytes,
      metadata: {
        task_id: task.task_id,
        document_type: "trade_dataset",
        source_date: monthEndDate(period),
        commodity,
        period,
        material_id: optionalTaskParam(task, "material_id"),
        component_id: optionalTaskParam(task, "component_id"),
        scope_id: optionalTaskParam(task, "scope_id")
      },
      storageKeyForSha256: (sha256) => `commodity/worldbank-pink/monthly/${period}/${sha256}.xlsx`
    });
  },
  async normalize(raw) {
    return normalizeWorldBankPinkDocument(raw);
  }
};

export const worldBankPinkAdapter = createRateLimitedSourceAdapter(worldBankPinkAdapterBase);

export function createWorldBankPinkAdapterContext(input: CreateAdapterContextInput): AdapterContext {
  return createRuntimeAdapterContext(input);
}

export async function discoverWorldBankPinkSheetLinksFromOfficialPage(ctx: AdapterContext): Promise<WorldBankPinkLinks> {
  const html = Buffer.from(
    await fetchBytesWithTimeout(WORLD_BANK_COMMODITY_MARKETS_URL, {
      userAgent: ctx.userAgent,
      timeoutMs: 12_000,
      sourceLabel: "World Bank commodity markets page",
      headers: { Accept: "text/html" }
    })
  ).toString("utf8");
  return discoverWorldBankPinkSheetLinks(html);
}

export function discoverWorldBankPinkSheetLinks(html: string): WorldBankPinkLinks {
  const links = [...html.matchAll(/https?:\/\/[^"']+?CMO-Historical-Data-(Monthly|Annual)\.xlsx/giu)].map((match) => ({
    kind: match[1]?.toLowerCase(),
    url: match[0].replaceAll("&amp;", "&")
  }));
  const monthlyUrl = links.find((link) => link.kind === "monthly")?.url;
  const annualUrl = links.find((link) => link.kind === "annual")?.url;
  if (monthlyUrl === undefined) throw new Error("World Bank commodity markets page did not expose the monthly Pink Sheet XLSX link");
  return { monthlyUrl, ...(annualUrl === undefined ? {} : { annualUrl }) };
}

export function parseWorldBankPinkRows(bytes: Uint8Array, input: WorldBankPinkInput): WorldBankPinkRow[] {
  validateWorldBankPinkInput(input);
  const workbook = XLSX.read(bytes, { type: "array", cellDates: false });
  const sheet = workbook.Sheets["Monthly Prices"];
  if (sheet === undefined) throw new Error("World Bank Pink Sheet workbook is missing the Monthly Prices sheet");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, raw: true });
  const commodityCode = commodityCodeFor(input.commodity);
  const codeRowIndex = findHeaderRowIndex(rows, commodityCode);
  const columnIndex = rows[codeRowIndex]?.findIndex((cell) => stringCell(cell) === commodityCode) ?? -1;
  if (columnIndex < 0) throw new Error(`World Bank Pink Sheet is missing commodity column: ${commodityCode}`);
  const unit = stringCell(rows[codeRowIndex - 1]?.[columnIndex]) ?? "index";
  const label = stringCell(rows[codeRowIndex - 2]?.[columnIndex]) ?? input.commodity;
  const row = rows.slice(codeRowIndex + 1).find((item) => stringCell(item[0]) === periodToPinkSheetKey(input.period));
  if (row === undefined) throw new Error(`World Bank Pink Sheet has no row for period: ${input.period}`);
  const value = numericCell(row[columnIndex], `${commodityCode} ${input.period}`);
  return [
    {
      commodity: normalizeCommodity(label.length === 0 ? input.commodity : label),
      commodity_code: commodityCode,
      period: input.period,
      price: value,
      unit,
      metric_name: `worldbank_pink.${commodityCode.toLowerCase()}.price_usd`
    }
  ];
}

function normalizeWorldBankPinkDocument(raw: RawDocument<Uint8Array>): NormalizedDocument {
  const input = inputFromRawMetadata(raw.metadata);
  const rows = parseWorldBankPinkRows(raw.body, input);
  const sourceDate = stringMetadata(raw.metadata, "source_date");
  return normalizeTextDocument({
    raw,
    documentType: "trade_dataset",
    parserVersion: "worldbank-pink-xlsx-v1",
    text: rows.map(formatWorldBankPinkRow).join("\n"),
    extraMetadata: { row_count: rows.length, commodity: input.commodity, period: input.period },
    ...(sourceDate === undefined ? {} : { sourceDate })
  });
}

function formatWorldBankPinkRow(row: WorldBankPinkRow): string {
  return [
    `commodity: ${row.commodity}`,
    `commodity_code: ${row.commodity_code}`,
    `period: ${row.period}`,
    `metric_name: ${row.metric_name}`,
    `price: ${row.price}`,
    `unit: ${row.unit}`
  ].join("\n");
}

function inputFromRawMetadata(metadata: Record<string, unknown>): WorldBankPinkInput {
  return {
    commodity: requiredMetadata(metadata, "commodity"),
    period: requiredMetadata(metadata, "period"),
    ...(stringMetadata(metadata, "material_id") === undefined ? {} : { materialId: requiredMetadata(metadata, "material_id") }),
    ...(stringMetadata(metadata, "component_id") === undefined ? {} : { componentId: requiredMetadata(metadata, "component_id") }),
    ...(stringMetadata(metadata, "scope_id") === undefined ? {} : { scopeId: requiredMetadata(metadata, "scope_id") })
  };
}

function findHeaderRowIndex(rows: readonly unknown[][], commodityCode: string): number {
  const rowIndex = rows.findIndex((row) => row.some((cell) => stringCell(cell) === commodityCode));
  if (rowIndex < 2) throw new Error(`World Bank Pink Sheet header rows are not in the expected layout for ${commodityCode}`);
  return rowIndex;
}

function commodityCodeFor(commodity: string): string {
  const normalized = normalizeCommodity(commodity);
  const code = COMMODITY_CODE_BY_ALIAS.get(normalized);
  if (code === undefined) throw new Error(`Unsupported World Bank Pink Sheet commodity: ${commodity}`);
  return code;
}

function validateWorldBankPinkInput(input: WorldBankPinkInput): void {
  commodityCodeFor(input.commodity);
  validateMonth(input.period);
}

function normalizeCommodity(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) throw new Error("World Bank Pink Sheet commodity must not be empty");
  return trimmed;
}

function stringCell(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numericCell(value: unknown, label: string): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/u.test(value.trim())) return value.trim();
  throw new Error(`World Bank Pink Sheet ${label} value must be numeric`);
}

function requiredTaskParam(task: FetchTask, key: string): string {
  const value = task.params?.[key];
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`World Bank Pink task missing ${key}`);
  return value.trim();
}

function optionalTaskParam(task: FetchTask, key: string): string | undefined {
  const value = task.params?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function requiredMetadata(metadata: Record<string, unknown>, key: string): string {
  const value = stringMetadata(metadata, key);
  if (value === undefined) throw new Error(`World Bank Pink raw metadata missing ${key}`);
  return value;
}

function stringMetadata(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function periodToPinkSheetKey(period: string): string {
  validateMonth(period);
  return `${period.slice(0, 4)}M${period.slice(5, 7)}`;
}

function validateMonth(value: string): void {
  const match = value.match(/^(\d{4})-(\d{2})$/u);
  if (match === null) throw new Error(`World Bank Pink Sheet period must be YYYY-MM: ${value}`);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error(`World Bank Pink Sheet month is outside 01-12: ${value}`);
}

function monthEndDate(month: string): string {
  validateMonth(month);
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText);
  return new Date(Date.UTC(year, monthIndex, 0)).toISOString().slice(0, 10);
}

function stableInputId(input: WorldBankPinkInput): string {
  return createHash("sha256")
    .update(`${normalizeCommodity(input.commodity)}|${input.period}|${input.materialId ?? ""}|${input.componentId ?? ""}|${input.scopeId ?? ""}`)
    .digest("hex")
    .slice(0, 16);
}
