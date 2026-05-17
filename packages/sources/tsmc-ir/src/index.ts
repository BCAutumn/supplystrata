import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createId, fetchBytesWithTimeout, loadEnv, type FetchTask } from "@supplystrata/core";
import { FsObjectStore } from "@supplystrata/object-store";
import { createRateLimitedSourceAdapter, type AdapterContext, type SourceAdapter } from "@supplystrata/source-adapter-spec";
import { normalizeHtmlDocument } from "@supplystrata/source-normalizers";

export interface TsmcIrInput {
  year: number;
  entityId: "ENT-TSMC";
}

const tsmcIrAdapterBase: SourceAdapter<TsmcIrInput, Uint8Array> = {
  id: "tsmc-ir",
  tier: "P0",
  description: "TSMC official investor relations annual report website",
  tos_url: "https://investor.tsmc.com/english/annual-reports",
  rate_limit: { requests: 1, per_seconds: 1 },
  async *plan(input) {
    yield {
      task_id: `tsmc-ir-annual-report-${input.year}`,
      url: annualReportUrl(input.year),
      expected_format: "html",
      hint: { entity_id: input.entityId, document_type: "annual_report", period: `${input.year}-12-31` }
    };
  },
  async fetch(task, ctx) {
    const year = task.hint?.period?.slice(0, 4) ?? "unknown";
    const bytes = await fetchOrLoadCachedAnnualReport(task.url, ctx.userAgent, year);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const storageKey = `company-ir/tsmc/${year}/${sha256}.html`;
    await new FsObjectStore(loadEnv().OBJECT_STORE_FS_BASE).put(storageKey, bytes);
    return {
      doc_id: createId("DOC"),
      source_adapter_id: "tsmc-ir",
      url: task.url,
      fetched_at: ctx.now().toISOString(),
      bytes_sha256: sha256,
      storage_key: storageKey,
      body: bytes,
      metadata: {
        task_id: task.task_id,
        document_type: task.hint?.document_type ?? "annual_report",
        primary_entity_id: task.hint?.entity_id,
        source_date: task.hint?.period
      }
    };
  },
  async normalize(raw) {
    return normalizeHtmlDocument({ raw, documentType: "annual_report" });
  }
};

export const tsmcIrAdapter = createRateLimitedSourceAdapter(tsmcIrAdapterBase);

export function annualReportUrl(year: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error(`Invalid TSMC annual report year: ${year}`);
  return `https://investor.tsmc.com/static/annualReports/${year}/english/index.html`;
}

export function createTsmcIrAdapterContext(): AdapterContext {
  return { userAgent: loadEnv().SEC_USER_AGENT, now: () => new Date() };
}

async function fetchOrLoadCachedAnnualReport(url: string, userAgent: string, year: string): Promise<Uint8Array> {
  try {
    return await fetchBytesWithTimeout(url, { userAgent, timeoutMs: 12_000, sourceLabel: "TSMC IR" });
  } catch (error) {
    const cached = await readLatestCachedAnnualReport(year);
    if (cached !== undefined) return cached;
    throw error;
  }
}

async function readLatestCachedAnnualReport(year: string): Promise<Uint8Array | undefined> {
  const dir = join(loadEnv().OBJECT_STORE_FS_BASE, "company-ir", "tsmc", year);
  try {
    const files = (await readdir(dir)).filter((file) => file.endsWith(".html")).sort();
    const latest = files.at(-1);
    if (latest === undefined) return undefined;
    return new Uint8Array(await readFile(join(dir, latest)));
  } catch {
    return undefined;
  }
}
