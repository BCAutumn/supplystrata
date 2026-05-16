import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createId, fetchBytesWithTimeout, loadEnv } from "@supplystrata/core";
import { FsObjectStore } from "@supplystrata/object-store";
import type { AdapterContext, SourceAdapter } from "@supplystrata/source-adapter-spec";

export interface SamsungIrInput {
  year: number;
  entityId: "ENT-SAMSUNG-ELECTRONICS";
}

export const samsungIrAdapter: SourceAdapter<SamsungIrInput, Uint8Array> = {
  id: "samsung-ir",
  tier: "P0",
  description: "Samsung Electronics official investor relations / newsroom disclosures",
  tos_url: "https://www.samsung.com/global/ir/",
  rate_limit: { requests: 1, per_seconds: 3 },
  async *plan(input) {
    yield {
      task_id: `samsung-ir-fy-results-${input.year}`,
      url: officialDisclosureUrl(input.year),
      expected_format: "html",
      hint: { entity_id: input.entityId, document_type: "annual_report", period: `${input.year}-12-31` }
    };
  },
  async fetch(task, ctx) {
    const year = task.hint?.period?.slice(0, 4) ?? "unknown";
    const bytes = await fetchOrLoadCached(task.url, ctx.userAgent, year);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const storageKey = `company-ir/samsung/${year}/${sha256}.html`;
    await new FsObjectStore(loadEnv().OBJECT_STORE_FS_BASE).put(storageKey, bytes);
    return {
      doc_id: createId("DOC"),
      source_adapter_id: "samsung-ir",
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
    return {
      doc_id: raw.doc_id,
      source_adapter_id: raw.source_adapter_id,
      document_type: "annual_report",
      language: "en",
      fetched_at: raw.fetched_at,
      source_url: raw.url,
      storage_key: raw.storage_key,
      bytes_sha256: raw.bytes_sha256,
      text: "",
      chunks: [],
      metadata: raw.metadata
    };
  }
};

export function officialDisclosureUrl(year: number): string {
  if (year !== 2025) return "https://news.samsung.com/global/";
  return "https://news.samsung.com/global/samsung-electronics-announces-fourth-quarter-and-fy-2025-results";
}

export function createSamsungIrAdapterContext(): AdapterContext {
  return { userAgent: loadEnv().SEC_USER_AGENT, now: () => new Date() };
}

async function fetchOrLoadCached(url: string, userAgent: string, year: string): Promise<Uint8Array> {
  try {
    return await fetchBytesWithTimeout(url, { userAgent, timeoutMs: 12_000, sourceLabel: "Samsung disclosure" });
  } catch (error) {
    const cached = await readLatestCached(year);
    if (cached !== undefined) return cached;
    throw error;
  }
}

async function readLatestCached(year: string): Promise<Uint8Array | undefined> {
  const dir = join(loadEnv().OBJECT_STORE_FS_BASE, "company-ir", "samsung", year);
  try {
    const files = (await readdir(dir)).filter((file) => file.endsWith(".html")).sort();
    const latest = files.at(-1);
    return latest === undefined ? undefined : new Uint8Array(await readFile(join(dir, latest)));
  } catch {
    return undefined;
  }
}
