import { type RawDocument } from "@supplystrata/core";
import {
  createAdapterContext,
  createRateLimitedSourceAdapter,
  fetchBytesWithTimeout,
  persistRawDocumentSnapshot,
  type AdapterContext,
  type CreateAdapterContextInput,
  type SourceAdapter
} from "@supplystrata/source-adapter-runtime";
import { optionalConfigPositiveInteger, requireConfigString, type SourceCheckConfigSchema, type SourceCheckConnector } from "@supplystrata/source-connectors";
import type { DatabaseStore } from "@supplystrata/db/write";
import { documentObservationStoreOption } from "./document-observation-context.js";
import { runSourceAdapterCheck, type SourceCheckSummary } from "./source-check-runner.js";
import {
  TWSE_MOPS_DOCUMENT_KINDS,
  assertTwseMopsResponse,
  buildTwseMopsElectronicDocumentsUrl,
  decodeTwseMopsHtml,
  extractTwseMopsElectronicDocumentEntries,
  isTwseMopsDocumentKind,
  normalizeTwseMopsElectronicDocuments,
  twseMopsElectronicDocumentsTaskMetadata,
  validateTwseMopsElectronicDocumentsInput,
  type TwseMopsDocumentKind,
  type TwseMopsElectronicDocumentEntry,
  type TwseMopsElectronicDocumentsInput
} from "./twse-mops-electronic-documents.js";

export { buildTwseMopsElectronicDocumentsUrl, extractTwseMopsElectronicDocumentEntries };
export type { TwseMopsDocumentKind, TwseMopsElectronicDocumentEntry, TwseMopsElectronicDocumentsInput };

const twseMopsAdapterBase: SourceAdapter<TwseMopsElectronicDocumentsInput, Uint8Array> = {
  id: "twse-mops",
  tier: "P1",
  description: "Taiwan MOPS official electronic documents directory monitor",
  tos_url: "https://mops.twse.com.tw/",
  rate_limit: { requests: 1, per_seconds: 2 },
  async *plan(input: TwseMopsElectronicDocumentsInput) {
    validateTwseMopsElectronicDocumentsInput(input);
    yield {
      task_id: `twse-mops-${input.stockCode}-${input.year}-${input.documentKind ?? "F"}`,
      url: buildTwseMopsElectronicDocumentsUrl(input),
      params: {
        ...(input.limit === undefined ? {} : { limit: input.limit })
      },
      expected_format: "html",
      hint: {
        entity_id: input.entityId,
        // 第一版只抓 MOPS 電子文件查詢目錄，不下載 PDF、不進行關係抽取。
        document_type: "company_registry",
        period: `${input.year}-12-31`
      }
    };
  },
  async fetch(task, ctx): Promise<RawDocument<Uint8Array>> {
    const body = await fetchBytesWithTimeout(task.url, {
      userAgent: ctx.userAgent,
      timeoutMs: 12_000,
      sourceLabel: "TWSE MOPS",
      headers: { Accept: "text/html,application/xhtml+xml" }
    });
    const html = decodeTwseMopsHtml(body);
    assertTwseMopsResponse(html, task.url);
    const metadata = twseMopsElectronicDocumentsTaskMetadata(task, html);
    const stockCode = stringMetadataValue(metadata["stock_code"]);
    const year = stringMetadataValue(metadata["source_year"]);
    const documentKind = stringMetadataValue(metadata["document_kind"]);
    if (stockCode === undefined || year === undefined || documentKind === undefined) {
      throw new Error(`TWSE MOPS task metadata is missing required routing keys for ${task.task_id}`);
    }
    return persistRawDocumentSnapshot({
      ctx,
      sourceAdapterId: "twse-mops",
      url: task.url,
      body,
      metadata,
      storageKeyForSha256: (sha256) => `official-disclosure/twse-mops/${stockCode}/${year}/${documentKind}/${sha256}.html`
    });
  },
  async normalize(raw) {
    return normalizeTwseMopsElectronicDocuments(raw);
  }
};

export const twseMopsAdapter = createRateLimitedSourceAdapter(twseMopsAdapterBase);

export const twseMopsElectronicDocumentsSourceCheckConnector: SourceCheckConnector<DatabaseStore, SourceCheckSummary> = {
  source_adapter_id: "twse-mops",
  target_kind: "electronic-documents",
  config_schema: twseMopsConfigSchema(),
  run(store, target, context) {
    return runSourceAdapterCheck(store, {
      adapter: twseMopsAdapter,
      adapterInput: twseMopsElectronicDocumentsInputFromConfig(target.target_config),
      context: createTwseMopsAdapterContext(context.adapter_context_input),
      options: {
        checkTargetId: target.check_target_id,
        failureCausedBy: "source-check.twse-mops",
        checkedAt: context.checked_at,
        ...documentObservationStoreOption(context),
        ...(context.logger === undefined ? {} : { logger: context.logger })
      }
    });
  }
};

export function createTwseMopsAdapterContext(input: CreateAdapterContextInput): AdapterContext {
  return createAdapterContext(input);
}

export function twseMopsElectronicDocumentsInputFromConfig(config: Record<string, unknown>): TwseMopsElectronicDocumentsInput {
  const label = "TWSE MOPS source check target";
  const year = optionalConfigPositiveInteger(config, "year", label);
  if (year === undefined || year < 2000 || year > 2100) throw new Error(`${label} year must be a supported disclosure year`);
  const documentKind = optionalTwseMopsDocumentKind(config, label);
  const limit = optionalConfigPositiveInteger(config, "limit", label);
  return {
    entityId: requireConfigString(config, "entity_id", label),
    stockCode: requireTwseStockCode(config, label),
    year,
    ...(documentKind === undefined ? {} : { documentKind }),
    ...(limit === undefined ? {} : { limit })
  };
}

function twseMopsConfigSchema(): SourceCheckConfigSchema {
  return {
    fields: [
      { key: "stock_code", type: "string", required: true, description: "TWSE/MOPS company stock code, e.g. 2317." },
      { key: "entity_id", type: "string", required: true, description: "Primary SupplyStrata entity id for the filer." },
      { key: "year", type: "positive_integer", required: true, description: "Gregorian disclosure year; adapter converts it to Taiwan ROC year." },
      {
        key: "document_kind",
        type: "string",
        required: false,
        description: "MOPS electronic document kind. F is annual report/shareholder meeting materials.",
        allowed_values: TWSE_MOPS_DOCUMENT_KINDS
      },
      { key: "limit", type: "positive_integer", required: false, description: "Maximum directory rows to keep." }
    ]
  };
}

function requireTwseStockCode(config: Record<string, unknown>, label: string): string {
  const stockCode = requireConfigString(config, "stock_code", label);
  if (!/^\d{4,6}$/.test(stockCode)) throw new Error(`${label} stock_code must be a numeric TWSE/MOPS code`);
  return stockCode;
}

function optionalTwseMopsDocumentKind(config: Record<string, unknown>, label: string): TwseMopsDocumentKind | undefined {
  const value = config["document_kind"];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !isTwseMopsDocumentKind(value)) {
    throw new Error(`${label} document_kind must be one of: ${TWSE_MOPS_DOCUMENT_KINDS.join(", ")}`);
  }
  return value;
}

function stringMetadataValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
