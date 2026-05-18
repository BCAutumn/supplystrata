import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadEnv } from "@supplystrata/config";
import { createId, type FetchTask, type NormalizedDocument, type RawDocument } from "@supplystrata/core";
import { FsObjectStore } from "@supplystrata/object-store";
import { validateRateLimit, type AdapterContext, type SourceAdapter, type SourceRateLimit } from "@supplystrata/source-adapter-spec";

export type { AdapterContext, SourceAdapter, SourceRateLimit } from "@supplystrata/source-adapter-spec";

export interface FetchBytesOptions {
  userAgent: string;
  timeoutMs: number;
  sourceLabel: string;
  headers?: Record<string, string>;
}

export interface HtmlSnapshotAdapterDefinition<TFetchInput> {
  readonly id: string;
  readonly tier: SourceAdapter<TFetchInput, Uint8Array>["tier"];
  readonly description: string;
  readonly tos_url: string;
  readonly rate_limit: SourceRateLimit;
  readonly sourceLabel: string;
  readonly storagePrefix: string;
  readonly timeoutMs?: number;
  plan(input: TFetchInput, ctx: AdapterContext): AsyncIterable<FetchTask> | Iterable<FetchTask>;
  normalize(raw: RawDocument<Uint8Array>, ctx: AdapterContext): Promise<NormalizedDocument>;
}

interface RateLimitState {
  nextAvailableAtMs: number;
  tail: Promise<void>;
}

export interface SourceRateLimiterOptions {
  nowMs?: () => number;
  sleepMs?: (milliseconds: number) => Promise<void>;
}

export class SourceRateLimiter {
  private readonly states = new Map<string, RateLimitState>();
  private readonly nowMs: () => number;
  private readonly sleepMs: (milliseconds: number) => Promise<void>;

  constructor(options: SourceRateLimiterOptions = {}) {
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.sleepMs = options.sleepMs ?? defaultSleepMs;
  }

  async acquire(sourceAdapterId: string, rateLimit: SourceRateLimit): Promise<void> {
    validateRateLimit(sourceAdapterId, rateLimit);
    const intervalMs = (rateLimit.per_seconds * 1000) / rateLimit.requests;
    const state = this.stateFor(sourceAdapterId);

    const queued = state.tail.then(async () => {
      const waitMs = Math.max(0, state.nextAvailableAtMs - this.nowMs());
      if (waitMs > 0) await this.sleepMs(waitMs);
      const acquiredAtMs = Math.max(this.nowMs(), state.nextAvailableAtMs);
      state.nextAvailableAtMs = acquiredAtMs + intervalMs;
    });

    state.tail = queued.catch(() => undefined);
    await queued;
  }

  private stateFor(sourceAdapterId: string): RateLimitState {
    const existing = this.states.get(sourceAdapterId);
    if (existing !== undefined) return existing;
    const created = { nextAvailableAtMs: 0, tail: Promise.resolve() };
    this.states.set(sourceAdapterId, created);
    return created;
  }
}

export function createRateLimitedSourceAdapter<TFetchInput, TRawDoc>(
  adapter: SourceAdapter<TFetchInput, TRawDoc>,
  limiter: SourceRateLimiter = new SourceRateLimiter()
): SourceAdapter<TFetchInput, TRawDoc> {
  return {
    ...adapter,
    async *plan(input, ctx) {
      // plan 也可能访问远端发现接口，例如 SEC submissions API，因此同样走统一限速。
      await limiter.acquire(adapter.id, adapter.rate_limit);
      yield* adapter.plan(input, ctx);
    },
    async fetch(task, ctx) {
      await limiter.acquire(adapter.id, adapter.rate_limit);
      return adapter.fetch(task, ctx);
    }
  };
}

export function defineHtmlSnapshotAdapter<TFetchInput>(definition: HtmlSnapshotAdapterDefinition<TFetchInput>): SourceAdapter<TFetchInput, Uint8Array> {
  const adapter: SourceAdapter<TFetchInput, Uint8Array> = {
    id: definition.id,
    tier: definition.tier,
    description: definition.description,
    tos_url: definition.tos_url,
    rate_limit: definition.rate_limit,
    async *plan(input, ctx) {
      yield* definition.plan(input, ctx);
    },
    async fetch(task, ctx) {
      const period = task.hint?.period ?? "unknown";
      const year = period.slice(0, 4) || "unknown";
      const snapshot = await fetchOrLoadCachedSnapshot({
        url: task.url,
        userAgent: ctx.userAgent,
        year,
        storagePrefix: definition.storagePrefix,
        sourceLabel: definition.sourceLabel,
        timeoutMs: definition.timeoutMs ?? 12_000
      });
      const sha256 = createHash("sha256").update(snapshot.bytes).digest("hex");
      const storageKey = `${definition.storagePrefix}/${year}/${sha256}.html`;
      await new FsObjectStore().put(storageKey, snapshot.bytes);
      return {
        doc_id: createId("DOC"),
        source_adapter_id: definition.id,
        url: task.url,
        fetched_at: ctx.now().toISOString(),
        bytes_sha256: sha256,
        storage_key: storageKey,
        body: snapshot.bytes,
        metadata: {
          task_id: task.task_id,
          document_type: task.hint?.document_type ?? "annual_report",
          primary_entity_id: task.hint?.entity_id,
          source_date: task.hint?.period,
          source_fetch_status: snapshot.source_fetch_status,
          ...(snapshot.source_fetch_error === undefined ? {} : { source_fetch_error: snapshot.source_fetch_error })
        }
      };
    },
    normalize(raw, ctx) {
      return definition.normalize(raw, ctx);
    }
  };
  return createRateLimitedSourceAdapter(adapter);
}

// 统一处理公开网页/API 抓取的超时与状态码错误，避免各 adapter 自己散落网络细节。
export async function fetchBytesWithTimeout(url: string, options: FetchBytesOptions): Promise<Uint8Array> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": options.userAgent, ...options.headers },
      signal: AbortSignal.timeout(options.timeoutMs)
    });
    if (!response.ok) throw new Error(`${options.sourceLabel} fetch failed: ${response.status} ${response.statusText}`);
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new Error(`${options.sourceLabel} fetch timed out after ${options.timeoutMs}ms`);
    }
    throw error;
  }
}

function defaultSleepMs(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

interface CachedSnapshotInput {
  url: string;
  userAgent: string;
  year: string;
  storagePrefix: string;
  sourceLabel: string;
  timeoutMs: number;
}

interface CachedSnapshotResult {
  bytes: Uint8Array;
  source_fetch_status: "live" | "fallback";
  source_fetch_error?: string;
}

async function fetchOrLoadCachedSnapshot(input: CachedSnapshotInput): Promise<CachedSnapshotResult> {
  try {
    return {
      bytes: await fetchBytesWithTimeout(input.url, {
        userAgent: input.userAgent,
        timeoutMs: input.timeoutMs,
        sourceLabel: input.sourceLabel
      }),
      source_fetch_status: "live"
    };
  } catch (error) {
    const cached = await readLatestCachedSnapshot(input.storagePrefix, input.year);
    if (cached !== undefined) {
      return {
        bytes: cached,
        source_fetch_status: "fallback",
        source_fetch_error: messageFromUnknown(error)
      };
    }
    throw error;
  }
}

async function readLatestCachedSnapshot(storagePrefix: string, year: string): Promise<Uint8Array | undefined> {
  const dir = join(loadEnv().OBJECT_STORE_FS_BASE, storagePrefix, year);
  try {
    const files = (await readdir(dir)).filter((file) => file.endsWith(".html")).sort();
    const latest = files.at(-1);
    return latest === undefined ? undefined : new Uint8Array(await readFile(join(dir, latest)));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
}
