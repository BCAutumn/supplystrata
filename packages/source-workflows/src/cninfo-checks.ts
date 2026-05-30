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
import {
  optionalConfigPositiveInteger,
  requireConfigString,
  type SourceCheckConfigSchema,
  type SourceCheckConnector
} from "@supplystrata/source-connectors";
import type { DatabaseStore } from "@supplystrata/db/write";
import { documentObservationStoreOption } from "./document-observation-context.js";
import {
  buildCninfoQueryBody,
  buildCninfoQueryUrl,
  buildCninfoStockListUrl,
  cninfoAnnouncementTask,
  cninfoAnnouncementTaskMetadata,
  cninfoExchangeFromStockCode,
  findCninfoOrgId,
  normalizeCninfoAnnualReport,
  parseCninfoAnnouncementsPayload,
  parseCninfoStockList,
  selectCninfoAnnualReports,
  validateCninfoInput,
  type CninfoCompanyFilingsInput,
  type CninfoExchange
} from "./cninfo-announcements.js";
import { runSourceAdapterCheck, type SourceCheckSummary } from "./source-check-runner.js";

export type { CninfoCompanyFilingsInput, CninfoExchange } from "./cninfo-announcements.js";

// 巨潮（cninfo）中文年报正文适配器：plan 用 POST hisAnnouncement/query 发现年度报告公告，逐篇 yield PDF 下载任务；
// fetch 下载 PDF；normalize 走 pdftotext → 中文 annual_report 正文文档，进入与 SEC/EDINET 同一套抽取（zh profile 产边）。
const cninfoAdapterBase: SourceAdapter<CninfoCompanyFilingsInput, Uint8Array> = {
  id: "cninfo",
  tier: "P1",
  description: "China cninfo (巨潮) annual report (年度报告) body fetcher",
  tos_url: "http://www.cninfo.com.cn/",
  rate_limit: { requests: 1, per_seconds: 2 },
  async *plan(input, ctx) {
    validateCninfoInput(input);
    const resolvedInput = await resolveCninfoOrgId(input, ctx);
    const listBytes = await fetchBytesWithTimeout(buildCninfoQueryUrl(), {
      userAgent: ctx.userAgent,
      timeoutMs: 15_000,
      sourceLabel: "cninfo",
      method: "POST",
      body: buildCninfoQueryBody(resolvedInput),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Accept: "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest"
      }
    });
    const payload = parseCninfoAnnouncementsPayload(listBytes);
    // 某公司在该时间窗内没有年度报告时，计划为空属正常（不产文档、不报错）。
    for (const announcement of selectCninfoAnnualReports(payload.announcements, input)) {
      yield cninfoAnnouncementTask(announcement, input);
    }
  },
  async fetch(task, ctx): Promise<RawDocument<Uint8Array>> {
    const body = await fetchBytesWithTimeout(task.url, {
      userAgent: ctx.userAgent,
      timeoutMs: 60_000,
      sourceLabel: "cninfo annual report",
      headers: { Accept: "application/pdf,application/octet-stream,*/*", Referer: "http://www.cninfo.com.cn/" }
    });
    const stockCode = stringParam(task.params, "stock_code") ?? "unknown";
    const year = (task.hint?.period ?? "unknown").slice(0, 4);
    return persistRawDocumentSnapshot({
      ctx,
      sourceAdapterId: "cninfo",
      url: task.url,
      body,
      metadata: cninfoAnnouncementTaskMetadata(task),
      storageKeyForSha256: (sha256) => `official-disclosure/cninfo/${stockCode}/${year}/${sha256}.pdf`
    });
  },
  async normalize(raw) {
    return normalizeCninfoAnnualReport(raw);
  }
};

export const cninfoAdapter = createRateLimitedSourceAdapter(cninfoAdapterBase);

export const cninfoCompanyFilingsSourceCheckConnector: SourceCheckConnector<DatabaseStore, SourceCheckSummary> = {
  source_adapter_id: "cninfo",
  target_kind: "company-filings",
  config_schema: cninfoConfigSchema(),
  run(store, target, context) {
    return runSourceAdapterCheck(store, {
      adapter: cninfoAdapter,
      adapterInput: cninfoCompanyFilingsInputFromConfig(target.target_config),
      context: createCninfoAdapterContext(context.adapter_context_input),
      options: {
        checkTargetId: target.check_target_id,
        failureCausedBy: "source-check.cninfo",
        checkedAt: context.checked_at,
        ...documentObservationStoreOption(context),
        ...(context.logger === undefined ? {} : { logger: context.logger })
      }
    });
  }
};

export function createCninfoAdapterContext(input: CreateAdapterContextInput): AdapterContext {
  return createAdapterContext(input);
}

// 在发起公告查询前确定 orgId：优先用配置里提供的真实 orgId；否则拉取巨潮上市公司清单按 code 精确映射；
// 清单不可达或查不到时退回 buildCninfoQueryBody 内的约定式构造（gssh/gssz+0+code），保证降级而不报错。
async function resolveCninfoOrgId(input: CninfoCompanyFilingsInput, ctx: AdapterContext): Promise<CninfoCompanyFilingsInput> {
  if (input.orgId !== undefined && input.orgId.trim().length > 0) return input;
  const exchange: CninfoExchange = input.exchange ?? cninfoExchangeFromStockCode(input.stockCode);
  try {
    const listBytes = await fetchBytesWithTimeout(buildCninfoStockListUrl(exchange), {
      userAgent: ctx.userAgent,
      timeoutMs: 15_000,
      sourceLabel: "cninfo stock list",
      headers: { Accept: "application/json, text/plain, */*", Referer: "http://www.cninfo.com.cn/" }
    });
    const orgId = findCninfoOrgId(parseCninfoStockList(listBytes), input.stockCode);
    if (orgId !== undefined) return { ...input, exchange, orgId };
  } catch {
    // 清单不可达（如网络受限）→ 静默退回约定式 orgId，由"查询为空属正常"兜底。
  }
  return { ...input, exchange };
}

export function cninfoCompanyFilingsInputFromConfig(config: Record<string, unknown>): CninfoCompanyFilingsInput {
  const label = "cninfo company-filings target";
  const exchange = optionalCninfoExchange(config, label);
  const orgId = optionalConfigString(config, "org_id", label);
  const entityId = optionalConfigString(config, "entity_id", label);
  const componentId = optionalConfigString(config, "component_id", label);
  const scopeKind = optionalScopeKind(config, label);
  const scopeId = optionalConfigString(config, "scope_id", label);
  const seDate = optionalConfigString(config, "se_date", label);
  const limit = optionalConfigPositiveInteger(config, "limit", label);
  return {
    stockCode: requireConfigString(config, "stock_code", label),
    ...(exchange === undefined ? {} : { exchange }),
    ...(orgId === undefined ? {} : { orgId }),
    ...(entityId === undefined ? {} : { entityId }),
    ...(componentId === undefined ? {} : { componentId }),
    ...(scopeKind === undefined ? {} : { scopeKind }),
    ...(scopeId === undefined ? {} : { scopeId }),
    ...(seDate === undefined ? {} : { seDate }),
    ...(limit === undefined ? {} : { limit })
  };
}

function cninfoConfigSchema(): SourceCheckConfigSchema {
  return {
    fields: [
      { key: "stock_code", type: "string", required: true, description: "6-digit Shanghai/Shenzhen securities code, e.g. 600519 or 000001." },
      { key: "exchange", type: "string", required: false, description: "Exchange override.", allowed_values: ["sse", "szse"] },
      { key: "org_id", type: "string", required: false, description: "cninfo internal orgId (e.g. gssz0000001); derived from code when omitted." },
      { key: "entity_id", type: "string", required: false, description: "Primary SupplyStrata entity id for company-specific targets." },
      { key: "component_id", type: "string", required: false, description: "Component target id used by readiness and coverage." },
      { key: "scope_kind", type: "string", required: false, description: "Research scope kind.", allowed_values: ["company", "component"] },
      { key: "scope_id", type: "string", required: false, description: "Research scope id that requested this cninfo target." },
      { key: "se_date", type: "string", required: false, description: "Announcement date range YYYY-MM-DD~YYYY-MM-DD." },
      { key: "limit", type: "positive_integer", required: false, description: "Max number of annual-report PDFs to fetch." }
    ]
  };
}

function optionalCninfoExchange(config: Record<string, unknown>, label: string): CninfoExchange | undefined {
  const value = optionalConfigString(config, "exchange", label);
  if (value === undefined) return undefined;
  if (value !== "sse" && value !== "szse") throw new Error(`${label} exchange must be sse or szse`);
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
  return value.trim();
}

function stringParam(params: Record<string, unknown> | undefined, key: string): string | undefined {
  if (params === undefined) return undefined;
  const value = params[key];
  return typeof value === "string" ? value : undefined;
}
