import { type RawDocument } from "@supplystrata/core";
import {
  createAdapterContext,
  createRateLimitedSourceAdapter,
  fetchBytesWithTimeout,
  persistRawDocumentSnapshot,
  requireAdapterCredential,
  type AdapterContext,
  type CreateAdapterContextInput,
  type SourceAdapter
} from "@supplystrata/source-adapter-runtime";
import {
  optionalConfigPositiveInteger,
  requireConfigString,
  requireConfigStringArray,
  type SourceCheckConfigSchema,
  type SourceCheckConnector
} from "@supplystrata/source-connectors";
import type { DatabaseStore } from "@supplystrata/db/write";
import {
  DART_CORP_CLASSES,
  DART_DISCLOSURE_TYPES,
  DART_FINAL_REPORT_FLAGS,
  assertDartKrResponseStatus,
  buildDartKrDisclosureListUrl,
  dartKrDisclosureListTaskMetadata,
  dedupeDisclosureTypes,
  extractDartKrDisclosureEntries,
  isDartCorpClass,
  isDartDisclosureType,
  isDartFinalReportsOnly,
  normalizeDartKrDisclosureListDocument,
  parseDartKrDisclosureListPayload,
  validateDartKrCompanyFilingsInput,
  type DartKrCompanyFilingsInput,
  type DartKrCorpClass,
  type DartKrDisclosureEntry,
  type DartKrDisclosureType,
  type DartKrFinalReportsOnly
} from "./dart-kr-disclosure-list.js";
import { documentObservationStoreOption } from "./document-observation-context.js";
import { runSourceAdapterCheck, type SourceCheckSummary } from "./source-check-runner.js";
import { OPENDART_CREDENTIALS } from "./source-check-credentials.js";

export { buildDartKrDisclosureListUrl, extractDartKrDisclosureEntries };
export type { DartKrCompanyFilingsInput, DartKrCorpClass, DartKrDisclosureEntry, DartKrDisclosureType, DartKrFinalReportsOnly };

const dartKrAdapterBase: SourceAdapter<DartKrCompanyFilingsInput, Uint8Array> = {
  id: "dart-kr",
  tier: "P1",
  description: "OpenDART official disclosure list monitor for Korean listed companies",
  tos_url: "https://opendart.fss.or.kr/",
  rate_limit: { requests: 2, per_seconds: 1 },
  async *plan(input: DartKrCompanyFilingsInput, ctx: AdapterContext) {
    validateDartKrCompanyFilingsInput(input);
    const apiKey = requireAdapterCredential(ctx, "OPENDART_API_KEY", "OpenDART");
    for (const disclosureType of dedupeDisclosureTypes(input.disclosureTypes)) {
      yield {
        task_id: `dart-kr-${input.corpCode}-${input.year}-${disclosureType}`,
        url: buildDartKrDisclosureListUrl(input, disclosureType, apiKey),
        expected_format: "json",
        hint: {
          entity_id: input.entityId,
          // 这里抓的是监管披露目录元数据，不是正文解析结果；先按 company_registry 落地，避免误触发关系抽取。
          document_type: "company_registry",
          period: `${input.year}-12-31`
        }
      };
    }
  },
  async fetch(task, ctx): Promise<RawDocument<Uint8Array>> {
    const body = await fetchBytesWithTimeout(task.url, {
      userAgent: ctx.userAgent,
      timeoutMs: 12_000,
      sourceLabel: "OpenDART",
      headers: { Accept: "application/json" }
    });
    const payload = parseDartKrDisclosureListPayload(body);
    assertDartKrResponseStatus(payload, task.url);
    const metadata = dartKrDisclosureListTaskMetadata(task, payload);
    const corpCode = stringMetadataValue(metadata["corp_code"]);
    const year = stringMetadataValue(metadata["source_year"]);
    const disclosureType = stringMetadataValue(metadata["disclosure_type"]);
    if (corpCode === undefined || year === undefined || disclosureType === undefined) {
      throw new Error(`OpenDART task metadata is missing required routing keys for ${task.task_id}`);
    }
    return persistRawDocumentSnapshot({
      ctx,
      sourceAdapterId: "dart-kr",
      url: task.url,
      body,
      metadata,
      storageKeyForSha256: (sha256) => `official-disclosure/dart-kr/${corpCode}/${year}/${disclosureType}/${sha256}.json`
    });
  },
  async normalize(raw) {
    return normalizeDartKrDisclosureListDocument(raw);
  }
};

export const dartKrAdapter = createRateLimitedSourceAdapter(dartKrAdapterBase);

export const dartKrCompanyFilingsSourceCheckConnector: SourceCheckConnector<DatabaseStore, SourceCheckSummary> = {
  source_adapter_id: "dart-kr",
  target_kind: "company-filings",
  config_schema: dartKrConfigSchema(),
  credential_requirements: OPENDART_CREDENTIALS,
  run(store, target, context) {
    return runSourceAdapterCheck(store, {
      adapter: dartKrAdapter,
      adapterInput: dartKrCompanyFilingsInputFromConfig(target.target_config),
      context: createDartKrAdapterContext(context.adapter_context_input),
      options: {
        checkTargetId: target.check_target_id,
        failureCausedBy: "source-check.dart-kr",
        checkedAt: context.checked_at,
        ...documentObservationStoreOption(context),
        ...(context.logger === undefined ? {} : { logger: context.logger })
      }
    });
  }
};

export function createDartKrAdapterContext(input: CreateAdapterContextInput): AdapterContext {
  return createAdapterContext(input);
}

export function dartKrCompanyFilingsInputFromConfig(config: Record<string, unknown>): DartKrCompanyFilingsInput {
  const label = "OpenDART source check target";
  const year = optionalConfigPositiveInteger(config, "year", label);
  if (year === undefined || year < 2000 || year > 2100) throw new Error(`${label} year must be a supported disclosure year`);
  const corpClass = optionalDartCorpClass(config, label);
  const finalReportsOnly = optionalDartFinalReportsOnly(config, label);
  const limit = optionalConfigPositiveInteger(config, "limit", label);
  return {
    entityId: requireConfigString(config, "entity_id", label),
    corpCode: requireDartCorpCode(config, label),
    year,
    disclosureTypes: requireDartDisclosureTypes(config, label),
    ...(corpClass === undefined ? {} : { corpClass }),
    ...(finalReportsOnly === undefined ? {} : { finalReportsOnly }),
    ...(limit === undefined ? {} : { limit })
  };
}

function dartKrConfigSchema(): SourceCheckConfigSchema {
  return {
    fields: [
      { key: "corp_code", type: "string", required: true, description: "OpenDART corporation code (8 digits)." },
      { key: "entity_id", type: "string", required: true, description: "Primary SupplyStrata entity id for the filer." },
      {
        key: "disclosure_types",
        type: "string_array",
        required: true,
        description: "OpenDART disclosure type groups to monitor.",
        allowed_values: DART_DISCLOSURE_TYPES
      },
      { key: "year", type: "positive_integer", required: true, description: "Disclosure year to monitor." },
      { key: "corp_cls", type: "string", required: false, description: "Optional DART corporation class filter.", allowed_values: DART_CORP_CLASSES },
      {
        key: "final_reports_only",
        type: "string",
        required: false,
        description: "Whether to include only final reports (Y/N).",
        allowed_values: DART_FINAL_REPORT_FLAGS
      },
      { key: "limit", type: "positive_integer", required: false, description: "Maximum disclosures to keep per disclosure type (1-100)." }
    ]
  };
}

function requireDartCorpCode(config: Record<string, unknown>, label: string): string {
  const corpCode = requireConfigString(config, "corp_code", label);
  if (!/^\d{8}$/.test(corpCode)) throw new Error(`${label} corp_code must be 8 digits`);
  return corpCode;
}

function requireDartDisclosureTypes(config: Record<string, unknown>, label: string): DartKrDisclosureType[] {
  const types: DartKrDisclosureType[] = [];
  for (const item of requireConfigStringArray(config, "disclosure_types", label)) {
    if (!isDartDisclosureType(item)) throw new Error(`Unsupported OpenDART disclosure type: ${item}`);
    types.push(item);
  }
  return dedupeDisclosureTypes(types);
}

function optionalDartCorpClass(config: Record<string, unknown>, label: string): DartKrCorpClass | undefined {
  const value = config["corp_cls"];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !isDartCorpClass(value)) throw new Error(`${label} corp_cls must be one of: ${DART_CORP_CLASSES.join(", ")}`);
  return value;
}

function optionalDartFinalReportsOnly(config: Record<string, unknown>, label: string): DartKrFinalReportsOnly | undefined {
  const value = config["final_reports_only"];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !isDartFinalReportsOnly(value)) {
    throw new Error(`${label} final_reports_only must be one of: ${DART_FINAL_REPORT_FLAGS.join(", ")}`);
  }
  return value;
}

function stringMetadataValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
