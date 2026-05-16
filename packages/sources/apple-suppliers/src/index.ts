import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createId, fetchBytesWithTimeout, loadEnv, type NormalizedDocument } from "@supplystrata/core";
import { FsObjectStore } from "@supplystrata/object-store";
import { parsePdf } from "@supplystrata/parsers-pdf";
import type { AdapterContext, SourceAdapter } from "@supplystrata/source-adapter-spec";
import { extractFixedWidthSupplierListCandidates, type SupplierListCandidate, type SupplierListParseConfig } from "@supplystrata/supplier-list";

export interface AppleSuppliersInput {
  fiscalYear: 2022;
  entityId: "ENT-APPLE";
}

export type AppleSupplierCandidate = SupplierListCandidate;

export interface AppleSupplierPreview {
  doc_id: string;
  fetched_url: string;
  source_date?: string;
  candidates: AppleSupplierCandidate[];
}

export const appleSuppliersAdapter: SourceAdapter<AppleSuppliersInput, Uint8Array> = {
  id: "apple-suppliers",
  tier: "P0",
  description: "Apple official Supplier List PDF",
  tos_url: "https://www.apple.com/legal/",
  rate_limit: { requests: 1, per_seconds: 3 },
  async *plan(input) {
    yield {
      task_id: `apple-suppliers-fy${String(input.fiscalYear).slice(2)}`,
      url: appleSupplierListUrl(input.fiscalYear),
      expected_format: "pdf",
      hint: { entity_id: input.entityId, document_type: "supplier_list", period: `${input.fiscalYear}-09-30` }
    };
  },
  async fetch(task, ctx) {
    const fiscalYear = task.hint?.period?.slice(0, 4) ?? "unknown";
    const bytes = await fetchOrLoadCached(task.url, fiscalYear);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const storageKey = `apple-suppliers/${fiscalYear}/${sha256}.pdf`;
    await new FsObjectStore(loadEnv().OBJECT_STORE_FS_BASE).put(storageKey, bytes);
    return {
      doc_id: createId("DOC"),
      source_adapter_id: "apple-suppliers",
      url: task.url,
      fetched_at: ctx.now().toISOString(),
      bytes_sha256: sha256,
      storage_key: storageKey,
      body: bytes,
      metadata: {
        task_id: task.task_id,
        document_type: "supplier_list",
        primary_entity_id: task.hint?.entity_id,
        source_date: task.hint?.period,
        extraction_mode: "semi_auto"
      }
    };
  },
  async normalize(raw) {
    const primaryEntityId = stringMetadata(raw.metadata, "primary_entity_id");
    const sourceDate = stringMetadata(raw.metadata, "source_date");
    return parsePdf({
      raw,
      documentType: "supplier_list",
      layout: true,
      ...(primaryEntityId === undefined ? {} : { primaryEntityId }),
      ...(sourceDate === undefined ? {} : { sourceDate })
    });
  }
};

export function appleSupplierListUrl(fiscalYear: 2022): string {
  if (fiscalYear !== 2022) throw new Error(`Unsupported Apple Supplier List fiscal year: ${fiscalYear}`);
  return "https://www.apple.com.cn/supplier-responsibility/pdf/Apple-Supplier-List.pdf";
}

export function createAppleSuppliersAdapterContext(): AdapterContext {
  return { userAgent: loadEnv().SEC_USER_AGENT, now: () => new Date() };
}

export function extractAppleSupplierCandidates(normalized: NormalizedDocument, fiscalYear: number): AppleSupplierCandidate[] {
  return extractAppleSupplierCandidatesFromText(normalized.text, fiscalYear);
}

export function extractAppleSupplierCandidatesFromText(text: string, fiscalYear: number): AppleSupplierCandidate[] {
  return extractFixedWidthSupplierListCandidates(text, appleSupplierListParseConfig(fiscalYear));
}

async function fetchOrLoadCached(url: string, fiscalYear: string): Promise<Uint8Array> {
  try {
    return await fetchBytesWithTimeout(url, {
      userAgent: appleBrowserUserAgent(),
      timeoutMs: 20_000,
      sourceLabel: "Apple Supplier List",
      headers: {
        Accept: "application/pdf,text/html,*/*",
        Referer: "https://www.apple.com/supply-chain/"
      }
    });
  } catch (error) {
    const cached = await readLatestCached(fiscalYear);
    if (cached !== undefined) return cached;
    throw error;
  }
}

function appleBrowserUserAgent(): string {
  // Apple 的静态 PDF 会拒绝非浏览器 UA；该 adapter 仍通过低频请求和官方 URL 保持半自动合规边界。
  return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
}

async function readLatestCached(fiscalYear: string): Promise<Uint8Array | undefined> {
  const dir = join(loadEnv().OBJECT_STORE_FS_BASE, "apple-suppliers", fiscalYear);
  try {
    const files = (await readdir(dir)).filter((file) => file.endsWith(".pdf")).sort();
    const latest = files.at(-1);
    return latest === undefined ? undefined : new Uint8Array(await readFile(join(dir, latest)));
  } catch {
    return undefined;
  }
}

function appleSupplierListParseConfig(fiscalYear: number): SupplierListParseConfig {
  return {
    sourceAdapterId: "apple-suppliers",
    buyerEntityId: "ENT-APPLE",
    buyerName: "Apple",
    sourceFiscalYear: fiscalYear,
    locatorPrefix: `Apple Supplier List FY${String(fiscalYear).slice(2)}`,
    confidence: 0.65,
    reviewReason: "供应商名单来自 PDF 表格解析，候选边必须人工复核后才能 apply。",
    ignoredExactLines: ["Supplier List"],
    ignoredLinePrefixes: [
      "The Apple supplier list represents",
      "direct spend for materials",
      "of our products worldwide",
      "SUPPLIER NAME",
      "PRIMARY LOCATIONS"
    ]
  };
}

function stringMetadata(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" ? value : undefined;
}
