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
import { documentObservationStoreOption } from "./document-observation-context.js";
import {
  assertEdinetResponseStatus,
  buildEdinetDocumentsListUrl,
  edinetDocumentListTaskMetadata,
  extractEdinetDocumentEntries,
  isEdinetDocumentListType,
  normalizeEdinetDocumentList,
  parseEdinetDocumentListPayload,
  validateEdinetDailyFilingsInput,
  type EdinetDailyFilingsInput,
  type EdinetDocumentEntry,
  type EdinetDocumentListType
} from "./edinet-document-list.js";
import { runSourceAdapterCheck, type SourceCheckSummary } from "./source-check-runner.js";
import { EDINET_CREDENTIALS } from "./source-check-credentials.js";

export { buildEdinetDocumentsListUrl, extractEdinetDocumentEntries };
export type { EdinetDailyFilingsInput, EdinetDocumentEntry, EdinetDocumentListType };

const edinetAdapterBase: SourceAdapter<EdinetDailyFilingsInput, Uint8Array> = {
  id: "edinet",
  tier: "P1",
  description: "Japan EDINET official daily disclosure list monitor",
  tos_url: "https://disclosure2.edinet-fsa.go.jp/",
  rate_limit: { requests: 2, per_seconds: 1 },
  async *plan(input: EdinetDailyFilingsInput, ctx: AdapterContext) {
    validateEdinetDailyFilingsInput(input);
    const apiKey = requireAdapterCredential(ctx, "EDINET_API_KEY", "EDINET");
    yield {
      task_id: `edinet-daily-filings-${input.date}`,
      url: buildEdinetDocumentsListUrl(input, apiKey),
      expected_format: "json",
      params: {
        ...(input.entityId === undefined ? {} : { entity_id: input.entityId }),
        ...(input.componentId === undefined ? {} : { component_id: input.componentId }),
        ...(input.scopeKind === undefined ? {} : { scope_kind: input.scopeKind }),
        ...(input.scopeId === undefined ? {} : { scope_id: input.scopeId }),
        ...(input.edinetCodes === undefined ? {} : { edinet_codes: [...input.edinetCodes] }),
        ...(input.secCodes === undefined ? {} : { sec_codes: [...input.secCodes] }),
        ...(input.docTypeCodes === undefined ? {} : { doc_type_codes: [...input.docTypeCodes] })
      },
      hint: {
        ...(input.entityId === undefined ? {} : { entity_id: input.entityId }),
        // EDINET 第一版只抓官方提交目录。正文 ZIP/PDF 解析后续再接，避免目录项直接触发关系抽取。
        document_type: "company_registry",
        period: input.date
      }
    };
  },
  async fetch(task, ctx): Promise<RawDocument<Uint8Array>> {
    const body = await fetchBytesWithTimeout(task.url, {
      userAgent: ctx.userAgent,
      timeoutMs: 12_000,
      sourceLabel: "EDINET",
      headers: { Accept: "application/json" }
    });
    const payload = parseEdinetDocumentListPayload(body);
    assertEdinetResponseStatus(payload, task.url);
    const date = new URL(task.url).searchParams.get("date") ?? undefined;
    if (date === undefined) throw new Error(`EDINET task URL is missing date for ${task.task_id}`);
    return persistRawDocumentSnapshot({
      ctx,
      sourceAdapterId: "edinet",
      url: task.url,
      body,
      metadata: edinetDocumentListTaskMetadata(task, payload),
      storageKeyForSha256: (sha256) => `official-disclosure/edinet/${date}/${sha256}.json`
    });
  },
  async normalize(raw) {
    return normalizeEdinetDocumentList(raw);
  }
};

export const edinetAdapter = createRateLimitedSourceAdapter(edinetAdapterBase);

export const edinetDailyFilingsSourceCheckConnector: SourceCheckConnector<DatabaseStore, SourceCheckSummary> = {
  source_adapter_id: "edinet",
  target_kind: "daily-filings",
  config_schema: edinetConfigSchema(),
  credential_requirements: EDINET_CREDENTIALS,
  run(store, target, context) {
    return runSourceAdapterCheck(store, {
      adapter: edinetAdapter,
      adapterInput: edinetDailyFilingsInputFromConfig(target.target_config),
      context: createEdinetAdapterContext(context.adapter_context_input),
      options: {
        checkTargetId: target.check_target_id,
        failureCausedBy: "source-check.edinet",
        checkedAt: context.checked_at,
        ...documentObservationStoreOption(context),
        ...(context.logger === undefined ? {} : { logger: context.logger })
      }
    });
  }
};

export function createEdinetAdapterContext(input: CreateAdapterContextInput): AdapterContext {
  return createAdapterContext(input);
}

export function edinetDailyFilingsInputFromConfig(config: Record<string, unknown>): EdinetDailyFilingsInput {
  const label = "EDINET source check target";
  const listType = optionalEdinetDocumentListType(config, label);
  const entityId = optionalConfigString(config, "entity_id", label);
  const componentId = optionalConfigString(config, "component_id", label);
  const scopeKind = optionalScopeKind(config, label);
  const scopeId = optionalConfigString(config, "scope_id", label);
  const edinetCodes = optionalStringArray(config, "edinet_codes", label);
  const secCodes = optionalStringArray(config, "sec_codes", label);
  const docTypeCodes = optionalStringArray(config, "doc_type_codes", label);
  return {
    date: requireIsoDate(requireConfigString(config, "date", label), `${label} date`),
    ...(listType === undefined ? {} : { listType }),
    ...(entityId === undefined ? {} : { entityId }),
    ...(componentId === undefined ? {} : { componentId }),
    ...(scopeKind === undefined ? {} : { scopeKind }),
    ...(scopeId === undefined ? {} : { scopeId }),
    ...(edinetCodes === undefined ? {} : { edinetCodes }),
    ...(secCodes === undefined ? {} : { secCodes }),
    ...(docTypeCodes === undefined ? {} : { docTypeCodes })
  };
}

function edinetConfigSchema(): SourceCheckConfigSchema {
  return {
    fields: [
      { key: "date", type: "string", required: true, description: "EDINET filing date in YYYY-MM-DD format." },
      { key: "type", type: "positive_integer", required: false, description: "EDINET documents list type. Supported values: 1 or 2." },
      { key: "entity_id", type: "string", required: false, description: "Primary SupplyStrata entity id for company-specific EDINET targets." },
      { key: "component_id", type: "string", required: false, description: "Component target id used by readiness and source-target coverage." },
      {
        key: "scope_kind",
        type: "string",
        required: false,
        description: "Research scope kind that requested this EDINET list.",
        allowed_values: ["company", "component"]
      },
      { key: "scope_id", type: "string", required: false, description: "Research scope id that requested this EDINET list." },
      { key: "edinet_codes", type: "string_array", required: false, description: "Optional EDINET filer codes to keep from the daily list." },
      { key: "sec_codes", type: "string_array", required: false, description: "Optional Japanese securities codes to keep from the daily list." },
      { key: "doc_type_codes", type: "string_array", required: false, description: "Optional EDINET document type codes to keep from the daily list." }
    ]
  };
}

function optionalEdinetDocumentListType(config: Record<string, unknown>, label: string): EdinetDocumentListType | undefined {
  const value = optionalConfigPositiveInteger(config, "type", label);
  if (value === undefined) return undefined;
  if (!isEdinetDocumentListType(value)) throw new Error(`${label} type must be 1 or 2`);
  return value;
}

function optionalScopeKind(config: Record<string, unknown>, label: string): "company" | "component" | undefined {
  const value = config["scope_kind"];
  if (value === undefined) return undefined;
  if (value !== "company" && value !== "component") throw new Error(`${label} scope_kind must be company or component`);
  return value;
}

function optionalConfigString(config: Record<string, unknown>, key: string, label: string): string | undefined {
  const value = config[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} ${key} must be a non-empty string`);
  return value;
}

function optionalStringArray(config: Record<string, unknown>, key: string, label: string): string[] | undefined {
  if (config[key] === undefined) return undefined;
  return [...new Set(requireConfigStringArray(config, key, label))];
}

function requireIsoDate(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must use YYYY-MM-DD format`);
  return value;
}
