import { type RawDocument } from "@supplystrata/core";
import type { DatabaseStore } from "@supplystrata/db/write";
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
import { documentObservationStoreOption } from "./document-observation-context.js";
import {
  buildHkexNewsTitleSearchUrl,
  decodeHkexNewsHtml,
  extractHkexNewsAnnouncementEntries,
  hkexNewsTitleSearchTaskMetadata,
  normalizeHkexNewsTitleSearch,
  validateHkexNewsTitleSearchInput,
  type HkexNewsAnnouncementEntry,
  type HkexNewsTitleSearchInput
} from "./hkex-news-title-search.js";
import { runSourceAdapterCheck, type SourceCheckSummary } from "./source-check-runner.js";

export { buildHkexNewsTitleSearchUrl, extractHkexNewsAnnouncementEntries };
export type { HkexNewsAnnouncementEntry, HkexNewsTitleSearchInput };

const hkexNewsAdapterBase: SourceAdapter<HkexNewsTitleSearchInput, Uint8Array> = {
  id: "hkex-news",
  tier: "P1",
  description: "HKEXnews title-search announcement metadata monitor",
  tos_url: "https://www.hkexnews.hk/",
  rate_limit: { requests: 1, per_seconds: 2 },
  async *plan(input: HkexNewsTitleSearchInput) {
    validateHkexNewsTitleSearchInput(input);
    yield {
      task_id: `hkex-news-${input.stockCode}-${input.fromDate}-${input.toDate}`,
      url: buildHkexNewsTitleSearchUrl(input),
      params: {
        ...(input.limit === undefined ? {} : { limit: input.limit })
      },
      expected_format: "html",
      hint: {
        entity_id: input.entityId,
        // HKEX C4 只监控公告目录元数据；PDF 正文下载和关系抽取必须由后续明确 parser 接管。
        document_type: "company_registry",
        period: input.toDate
      }
    };
  },
  async fetch(task, ctx): Promise<RawDocument<Uint8Array>> {
    const body = await fetchBytesWithTimeout(task.url, {
      userAgent: ctx.userAgent,
      timeoutMs: 12_000,
      sourceLabel: "HKEXnews",
      headers: { Accept: "text/html,application/xhtml+xml" }
    });
    const html = decodeHkexNewsHtml(body);
    const metadata = hkexNewsTitleSearchTaskMetadata(task, html);
    const stockCode = stringMetadataValue(metadata["stock_code"]);
    const toDate = stringMetadataValue(metadata["to_date"]);
    if (stockCode === undefined || toDate === undefined) {
      throw new Error(`HKEXnews task metadata is missing required routing keys for ${task.task_id}`);
    }
    return persistRawDocumentSnapshot({
      ctx,
      sourceAdapterId: "hkex-news",
      url: task.url,
      body,
      metadata,
      storageKeyForSha256: (sha256) => `official-disclosure/hkex-news/${stockCode}/${toDate}/${sha256}.html`
    });
  },
  async normalize(raw) {
    return normalizeHkexNewsTitleSearch(raw);
  }
};

export const hkexNewsAdapter = createRateLimitedSourceAdapter(hkexNewsAdapterBase);

export const hkexNewsTitleSearchSourceCheckConnector: SourceCheckConnector<DatabaseStore, SourceCheckSummary> = {
  source_adapter_id: "hkex-news",
  target_kind: "title-search",
  config_schema: hkexNewsConfigSchema(),
  run(store, target, context) {
    return runSourceAdapterCheck(store, {
      adapter: hkexNewsAdapter,
      adapterInput: hkexNewsTitleSearchInputFromConfig(target.target_config),
      context: createHkexNewsAdapterContext(context.adapter_context_input),
      options: {
        checkTargetId: target.check_target_id,
        failureCausedBy: "source-check.hkex-news",
        checkedAt: context.checked_at,
        ...documentObservationStoreOption(context),
        ...(context.logger === undefined ? {} : { logger: context.logger })
      }
    });
  }
};

export function createHkexNewsAdapterContext(input: CreateAdapterContextInput): AdapterContext {
  return createAdapterContext(input);
}

export function hkexNewsTitleSearchInputFromConfig(config: Record<string, unknown>): HkexNewsTitleSearchInput {
  const label = "HKEXnews source check target";
  const limit = optionalConfigPositiveInteger(config, "limit", label);
  return {
    entityId: requireConfigString(config, "entity_id", label),
    stockCode: requireHkexStockCode(config, label),
    fromDate: requireIsoDate(requireConfigString(config, "from_date", label), `${label} from_date`),
    toDate: requireIsoDate(requireConfigString(config, "to_date", label), `${label} to_date`),
    ...(limit === undefined ? {} : { limit })
  };
}

function hkexNewsConfigSchema(): SourceCheckConfigSchema {
  return {
    fields: [
      { key: "stock_code", type: "string", required: true, description: "HKEX numeric stock code, e.g. 700 or 00700." },
      { key: "entity_id", type: "string", required: true, description: "Primary SupplyStrata entity id for the filer." },
      { key: "from_date", type: "string", required: true, description: "Announcement search start date in YYYY-MM-DD format." },
      { key: "to_date", type: "string", required: true, description: "Announcement search end date in YYYY-MM-DD format." },
      { key: "limit", type: "positive_integer", required: false, description: "Maximum announcement metadata rows to keep." }
    ]
  };
}

function requireHkexStockCode(config: Record<string, unknown>, label: string): string {
  const stockCode = requireConfigString(config, "stock_code", label);
  if (!/^\d{1,5}$/.test(stockCode)) throw new Error(`${label} stock_code must be a numeric HKEX code`);
  return stockCode;
}

function requireIsoDate(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must use YYYY-MM-DD format`);
  return value;
}

function stringMetadataValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
