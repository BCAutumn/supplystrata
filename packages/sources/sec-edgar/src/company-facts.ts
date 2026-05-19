import type { FetchTask, NormalizedDocument, ObservationType, RawDocument } from "@supplystrata/core";
import {
  createRateLimitedSourceAdapter,
  fetchBytesWithTimeout,
  persistRawDocumentSnapshot,
  type AdapterContext,
  type SourceAdapter
} from "@supplystrata/source-adapter-runtime";
import { normalizeTextDocument } from "@supplystrata/source-normalizers";
import { normalizeCik } from "./cik.js";

export interface SecCompanyFactsInput {
  cik: string;
  entityId: string;
  metrics?: readonly SecCompanyFactMetricName[];
  maxPeriods?: number;
}

export interface SecCompanyFactObservationDraft {
  observation_type: ObservationType;
  metric_name: SecCompanyFactMetricName;
  metric_value: string;
  metric_unit: string;
  time_window_start?: string;
  time_window_end: string;
  baseline_value?: string;
  change_value?: string;
  change_percent?: number;
  confidence: number;
  provenance: Record<string, unknown>;
  attrs: Record<string, unknown>;
}

interface SecCompanyFactMetricDefinition {
  metric_name: SecCompanyFactMetricName;
  tags: readonly string[];
}

interface ParsedCompanyFact {
  metric_name: SecCompanyFactMetricName;
  taxonomy: string;
  tag: string;
  unit: string;
  value: string;
  start?: string;
  end: string;
  filed: string;
  form: string;
  accession: string;
  fiscal_year?: number;
  fiscal_period?: string;
  frame?: string;
}

export const SEC_COMPANY_FACT_METRIC_NAMES = [
  "inventory",
  "cost_of_revenue",
  "capital_expenditures",
  "accounts_payable",
  "purchase_obligations",
  "revenue",
  "segment_revenue"
] as const;

export type SecCompanyFactMetricName = (typeof SEC_COMPANY_FACT_METRIC_NAMES)[number];

export const SEC_COMPANY_FACT_METRIC_DEFINITIONS: readonly SecCompanyFactMetricDefinition[] = [
  {
    metric_name: "inventory",
    tags: ["InventoryNet", "InventoryFinishedGoodsNet", "InventoryRawMaterialsAndSupplies"]
  },
  {
    metric_name: "cost_of_revenue",
    tags: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization"]
  },
  {
    metric_name: "capital_expenditures",
    tags: ["PaymentsToAcquirePropertyPlantAndEquipment"]
  },
  {
    metric_name: "accounts_payable",
    tags: ["AccountsPayableCurrent"]
  },
  {
    metric_name: "purchase_obligations",
    tags: [
      "UnrecordedUnconditionalPurchaseObligationBalanceOnFirstAnniversary",
      "UnrecordedUnconditionalPurchaseObligationBalanceOnSecondAnniversary",
      "UnrecordedUnconditionalPurchaseObligationBalanceOnThirdAnniversary",
      "UnrecordedUnconditionalPurchaseObligationBalanceOnFourthAnniversary",
      "UnrecordedUnconditionalPurchaseObligationBalanceOnFifthAnniversary",
      "UnrecordedUnconditionalPurchaseObligationDueAfterFiveYears"
    ]
  },
  {
    metric_name: "revenue",
    tags: ["Revenues", "SalesRevenueNet"]
  },
  {
    metric_name: "segment_revenue",
    tags: []
  }
];

const DEFAULT_MAX_PERIODS = 12;
const COMPANY_FACTS_PARSER_VERSION = "sec-companyfacts-json-v1";

const secCompanyFactsAdapterBase: SourceAdapter<SecCompanyFactsInput, Uint8Array> = {
  id: "sec-edgar",
  tier: "P0",
  description: "SEC EDGAR company facts API",
  tos_url: "https://www.sec.gov/os/accessing-edgar-data",
  rate_limit: { requests: 5, per_seconds: 1 },
  async *plan(input) {
    const cik10 = normalizeCik(input.cik);
    yield companyFactsTask(cik10, input.entityId);
  },
  async fetch(task, ctx) {
    const bytes = await fetchBytesWithTimeout(task.url, { userAgent: ctx.userAgent, timeoutMs: 12_000, sourceLabel: "SEC company facts" });
    return persistRawDocumentSnapshot({
      ctx,
      sourceAdapterId: "sec-edgar",
      url: task.url,
      body: bytes,
      metadata: {
        task_id: task.task_id,
        document_type: "company_facts",
        primary_entity_id: task.hint?.entity_id,
        source_date: task.hint?.period
      },
      storageKeyForSha256: (sha256) => `sec-edgar/companyfacts/${task.hint?.entity_id ?? "unknown"}/${sha256}.json`
    });
  },
  async normalize(raw) {
    return normalizeSecCompanyFactsDocument(raw);
  }
};

export const secCompanyFactsAdapter = createRateLimitedSourceAdapter(secCompanyFactsAdapterBase);

export function companyFactsTask(cik10: string, entityId: string): FetchTask {
  return {
    task_id: `sec-companyfacts-${cik10}`,
    url: `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik10}.json`,
    expected_format: "json",
    hint: { entity_id: entityId, document_type: "company_facts", period: new Date().toISOString().slice(0, 10) }
  };
}

export function parseSecCompanyFactObservations(
  body: Uint8Array,
  input: { metrics?: readonly SecCompanyFactMetricName[]; maxPeriods?: number } = {}
): SecCompanyFactObservationDraft[] {
  const payload = parseJsonRecord(body, "SEC company facts payload");
  const facts = recordField(payload, "facts", "SEC company facts payload");
  const cik = numberOrStringField(payload, "cik");
  const entityName = stringField(payload, "entityName");
  const definitions = metricDefinitions(input.metrics);
  const maxPeriods = input.maxPeriods ?? DEFAULT_MAX_PERIODS;
  if (!Number.isInteger(maxPeriods) || maxPeriods < 1) throw new Error(`SEC company facts maxPeriods must be a positive integer: ${maxPeriods}`);

  const observations: SecCompanyFactObservationDraft[] = [];
  for (const definition of definitions) {
    const factsForMetric = companyFactsForMetric(facts, definition);
    const comparableFacts = factsWithPreviousPeriodBaseline(selectObservationFacts(factsForMetric, maxPeriods + 1)).slice(0, maxPeriods);
    for (const fact of comparableFacts) {
      observations.push({
        observation_type: "FINANCIAL_METRIC_OBSERVATION",
        metric_name: definition.metric_name,
        metric_value: fact.value,
        metric_unit: fact.unit,
        ...(fact.start === undefined ? {} : { time_window_start: fact.start }),
        time_window_end: fact.end,
        ...(fact.baseline_value === undefined ? {} : { baseline_value: fact.baseline_value }),
        ...(fact.change_value === undefined ? {} : { change_value: fact.change_value }),
        ...(fact.change_percent === undefined ? {} : { change_percent: fact.change_percent }),
        confidence: 0.9,
        provenance: {
          cik,
          entity_name: entityName,
          taxonomy: fact.taxonomy,
          xbrl_tag: fact.tag,
          accession: fact.accession,
          form: fact.form,
          filed: fact.filed,
          fiscal_year: fact.fiscal_year,
          fiscal_period: fact.fiscal_period,
          frame: fact.frame,
          official_structured_source: true,
          no_company_edge: true
        },
        attrs: {
          semantic_layer: "observation",
          observation_policy: "sec_companyfacts_financial_metric_cannot_create_company_edge",
          parser_version: COMPANY_FACTS_PARSER_VERSION
        }
      });
    }
  }
  return observations;
}

export async function normalizeSecCompanyFactsDocument(raw: RawDocument<Uint8Array>): Promise<NormalizedDocument> {
  const observations = parseSecCompanyFactObservations(raw.body);
  const text = companyFactsSummaryText(raw, observations);
  const primaryEntityId = stringMetadata(raw, "primary_entity_id");
  const sourceDate = stringMetadata(raw, "source_date");
  return normalizeTextDocument({
    raw,
    documentType: "company_facts",
    text,
    parserVersion: COMPANY_FACTS_PARSER_VERSION,
    ...(primaryEntityId === undefined ? {} : { primaryEntityId }),
    ...(sourceDate === undefined ? {} : { sourceDate }),
    extraMetadata: { observations: observations.length }
  });
}

function companyFactsForMetric(facts: Record<string, unknown>, definition: SecCompanyFactMetricDefinition): ParsedCompanyFact[] {
  const output: ParsedCompanyFact[] = [];
  for (const [taxonomy, taxonomyValue] of Object.entries(facts)) {
    if (!isRecord(taxonomyValue)) continue;
    for (const tag of definition.tags) {
      const concept = taxonomyValue[tag];
      if (!isRecord(concept)) continue;
      const units = concept["units"];
      if (!isRecord(units)) continue;
      for (const [unit, unitFacts] of Object.entries(units)) {
        if (!Array.isArray(unitFacts)) continue;
        for (const factValue of unitFacts) {
          const fact = parsedCompanyFact(factValue, { metricName: definition.metric_name, taxonomy, tag, unit });
          if (fact !== undefined) output.push(fact);
        }
      }
    }
  }
  return output;
}

function parsedCompanyFact(
  value: unknown,
  input: { metricName: SecCompanyFactMetricName; taxonomy: string; tag: string; unit: string }
): ParsedCompanyFact | undefined {
  if (!isRecord(value)) return undefined;
  const rawValue = value["val"];
  const end = stringField(value, "end");
  const filed = stringField(value, "filed");
  const form = stringField(value, "form");
  const accession = stringField(value, "accn");
  if (
    (typeof rawValue !== "number" && typeof rawValue !== "string") ||
    end === undefined ||
    filed === undefined ||
    form === undefined ||
    accession === undefined
  ) {
    return undefined;
  }
  if (form !== "10-K" && form !== "10-Q" && form !== "20-F") return undefined;
  const output: ParsedCompanyFact = {
    metric_name: input.metricName,
    taxonomy: input.taxonomy,
    tag: input.tag,
    unit: input.unit,
    value: String(rawValue),
    end,
    filed,
    form,
    accession
  };
  const start = stringField(value, "start");
  if (start !== undefined) output.start = start;
  const fiscalYear = numberField(value, "fy");
  if (fiscalYear !== undefined) output.fiscal_year = fiscalYear;
  const fiscalPeriod = stringField(value, "fp");
  if (fiscalPeriod !== undefined) output.fiscal_period = fiscalPeriod;
  const frame = stringField(value, "frame");
  if (frame !== undefined) output.frame = frame;
  return output;
}

function selectObservationFacts(facts: readonly ParsedCompanyFact[], maxPeriods: number): ParsedCompanyFact[] {
  const byPeriod = new Map<string, ParsedCompanyFact>();
  for (const fact of [...facts].sort(compareCompanyFacts)) {
    const key = `${fact.metric_name}:${fact.unit}:${fact.start ?? ""}:${fact.end}`;
    if (!byPeriod.has(key)) byPeriod.set(key, fact);
  }
  return [...byPeriod.values()].slice(0, maxPeriods);
}

function factsWithPreviousPeriodBaseline(facts: readonly ParsedCompanyFact[]): Array<
  ParsedCompanyFact & {
    baseline_value?: string;
    change_value?: string;
    change_percent?: number;
  }
> {
  const byMetricUnit = new Map<string, ParsedCompanyFact[]>();
  for (const fact of facts) {
    const key = `${fact.metric_name}:${fact.unit}`;
    const group = byMetricUnit.get(key) ?? [];
    group.push(fact);
    byMetricUnit.set(key, group);
  }

  const output: Array<ParsedCompanyFact & { baseline_value?: string; change_value?: string; change_percent?: number }> = [];
  for (const group of byMetricUnit.values()) {
    const sorted = [...group].sort(compareCompanyFacts);
    for (const [index, fact] of sorted.entries()) {
      const previous = sorted[index + 1];
      output.push({ ...fact, ...periodChangeFields(fact, previous) });
    }
  }
  return output.sort(compareCompanyFacts);
}

function periodChangeFields(
  fact: ParsedCompanyFact,
  previous: ParsedCompanyFact | undefined
): {
  baseline_value?: string;
  change_value?: string;
  change_percent?: number;
} {
  if (previous === undefined) return {};
  const currentValue = Number.parseFloat(fact.value);
  const previousValue = Number.parseFloat(previous.value);
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue) || previousValue === 0) return {};
  const changeValue = currentValue - previousValue;
  return {
    baseline_value: previous.value,
    change_value: roundSix(changeValue).toString(),
    change_percent: roundSix((changeValue / Math.abs(previousValue)) * 100)
  };
}

function compareCompanyFacts(left: ParsedCompanyFact, right: ParsedCompanyFact): number {
  return (
    right.end.localeCompare(left.end) ||
    right.filed.localeCompare(left.filed) ||
    formRank(right.form) - formRank(left.form) ||
    left.tag.localeCompare(right.tag) ||
    left.accession.localeCompare(right.accession)
  );
}

function formRank(form: string): number {
  if (form === "10-K" || form === "20-F") return 2;
  if (form === "10-Q") return 1;
  return 0;
}

function metricDefinitions(metrics: readonly SecCompanyFactMetricName[] | undefined): readonly SecCompanyFactMetricDefinition[] {
  if (metrics === undefined || metrics.length === 0) return SEC_COMPANY_FACT_METRIC_DEFINITIONS;
  const requested = new Set(metrics);
  return SEC_COMPANY_FACT_METRIC_DEFINITIONS.filter((definition) => requested.has(definition.metric_name));
}

function companyFactsSummaryText(raw: RawDocument<Uint8Array>, observations: readonly SecCompanyFactObservationDraft[]): string {
  const lines = [`SEC company facts: ${raw.url}`, `observations: ${observations.length}`];
  for (const observation of observations) {
    const changeText =
      observation.baseline_value === undefined || observation.change_percent === undefined
        ? ""
        : `; change ${observation.change_percent}% vs baseline ${observation.baseline_value}`;
    lines.push(
      `${observation.metric_name}: ${observation.metric_value} ${observation.metric_unit} (${observation.time_window_start ?? observation.time_window_end} to ${observation.time_window_end}${changeText})`
    );
  }
  return lines.join("\n");
}

function parseJsonRecord(body: Uint8Array, label: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
  if (!isRecord(parsed)) throw new Error(`${label} must be a JSON object`);
  return parsed;
}

function recordField(source: Record<string, unknown>, key: string, label: string): Record<string, unknown> {
  const value = source[key];
  if (!isRecord(value)) throw new Error(`${label} missing object field: ${key}`);
  return value;
}

function numberOrStringField(source: Record<string, unknown>, key: string): string | number | undefined {
  const value = source[key];
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function stringField(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function roundSix(value: number): number {
  return Number(value.toFixed(6));
}

function stringMetadata(raw: RawDocument<Uint8Array>, key: string): string | undefined {
  const value = raw.metadata[key];
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
