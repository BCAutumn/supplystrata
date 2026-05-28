import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize, resolve } from "node:path";
import { createId, type FetchTask, type NormalizedDocument, type RawDocument } from "@supplystrata/core";
import { validateRateLimit, type AdapterContext, type SourceAdapter, type SourceRateLimit, type SourceSnapshotStore } from "@supplystrata/source-adapter-spec";

export type { AdapterContext, SourceAdapter, SourceRateLimit, SourceSnapshotLookupInput, SourceSnapshotStore } from "@supplystrata/source-adapter-spec";

export interface CreateAdapterContextInput {
  userAgent: string;
  objectStoreBase: string;
  now: () => Date;
  credentials?: AdapterContext["credentials"];
  snapshotStore?: SourceSnapshotStore;
}

export interface FetchBytesOptions {
  userAgent: string;
  timeoutMs: number;
  sourceLabel: string;
  headers?: Record<string, string>;
  attempts?: number;
  retryDelayMs?: number;
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
  readonly snapshotStore?: SourceSnapshotStore;
  plan(input: TFetchInput, ctx: AdapterContext): AsyncIterable<FetchTask> | Iterable<FetchTask>;
  normalize(raw: RawDocument<Uint8Array>, ctx: AdapterContext): Promise<NormalizedDocument>;
}

export interface PersistRawDocumentSnapshotInput {
  readonly ctx: AdapterContext;
  readonly sourceAdapterId: string;
  readonly url: string;
  readonly body: Uint8Array;
  readonly metadata: Record<string, unknown>;
  storageKeyForSha256(sha256: string): string;
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
      const snapshotStore = snapshotStoreFor(definition, ctx);
      const snapshot = await fetchOrLoadCachedSnapshot({
        url: task.url,
        userAgent: ctx.userAgent,
        partition: year,
        extension: "html",
        storagePrefix: definition.storagePrefix,
        sourceLabel: definition.sourceLabel,
        timeoutMs: definition.timeoutMs ?? 12_000,
        snapshotStore
      });
      const sha256 = createHash("sha256").update(snapshot.bytes).digest("hex");
      const storageKey = `${definition.storagePrefix}/${year}/${sha256}.html`;
      await snapshotStore.put(storageKey, snapshot.bytes);
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

export function createFsSnapshotStore(baseDir: string): SourceSnapshotStore {
  const root = resolve(baseDir);
  return {
    async put(key, body) {
      const path = safeSnapshotPath(root, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    },
    async readLatest(input) {
      const dir = safeSnapshotPath(root, join(input.storagePrefix, input.partition));
      try {
        const files = (await readdir(dir)).filter((file) => file.endsWith(`.${input.extension}`)).sort();
        const latest = files.at(-1);
        return latest === undefined ? undefined : new Uint8Array(await readFile(join(dir, latest)));
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") return undefined;
        throw error;
      }
    }
  };
}

export function createAdapterContext(input: CreateAdapterContextInput): AdapterContext {
  return {
    userAgent: input.userAgent,
    now: input.now,
    snapshotStore: input.snapshotStore ?? createFsSnapshotStore(input.objectStoreBase),
    ...(input.credentials === undefined ? {} : { credentials: input.credentials })
  };
}

export function requireSnapshotStore(ctx: AdapterContext, sourceAdapterId: string): SourceSnapshotStore {
  if (ctx.snapshotStore !== undefined) return ctx.snapshotStore;
  throw new Error(`${sourceAdapterId} requires AdapterContext.snapshotStore for raw document persistence`);
}

export function requireAdapterCredential(ctx: AdapterContext, key: string, sourceLabel: string): string {
  const value = ctx.credentials?.[key];
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) throw new Error(`${sourceLabel} requires AdapterContext.credentials.${key}`);
  return trimmed;
}

export function credentialBasicAuthorizationHeader(ctx: AdapterContext, key: string, sourceLabel: string): { Authorization: string } {
  const credential = requireAdapterCredential(ctx, key, sourceLabel);
  // Companies House 这类 Basic auth API 需要把 key 放在用户名位置，密码为空；这里集中处理，避免 adapter 各自拼 base64。
  return { Authorization: `Basic ${Buffer.from(`${credential}:`).toString("base64")}` };
}

export function credentialAuthorizationHeader(ctx: AdapterContext, key: string, sourceLabel: string, scheme: "Bearer" | "Token"): { Authorization: string } {
  return { Authorization: `${scheme} ${requireAdapterCredential(ctx, key, sourceLabel)}` };
}

export function credentialNamedHeader(ctx: AdapterContext, key: string, sourceLabel: string, headerName: string): Record<string, string> {
  return { [headerName]: requireAdapterCredential(ctx, key, sourceLabel) };
}

export function credentialQueryParamUrl(publicUrl: string, ctx: AdapterContext, key: string, sourceLabel: string, paramName: string): string {
  return urlWithCredentialQueryParam(publicUrl, requireAdapterCredential(ctx, key, sourceLabel), paramName, sourceLabel);
}

export function urlWithCredentialQueryParam(publicUrl: string, credential: string, paramName: string, sourceLabel: string): string {
  const trimmedCredential = credential.trim();
  if (trimmedCredential.length === 0) throw new Error(`${sourceLabel} credential query param ${paramName} must not be empty`);
  const url = new URL(publicUrl);
  url.searchParams.set(paramName, trimmedCredential);
  return url.toString();
}

export async function persistRawDocumentSnapshot(input: PersistRawDocumentSnapshotInput): Promise<RawDocument<Uint8Array>> {
  const sha256 = createHash("sha256").update(input.body).digest("hex");
  const storageKey = input.storageKeyForSha256(sha256);
  await requireSnapshotStore(input.ctx, input.sourceAdapterId).put(storageKey, input.body);
  return {
    doc_id: createId("DOC"),
    source_adapter_id: input.sourceAdapterId,
    url: input.url,
    fetched_at: input.ctx.now().toISOString(),
    bytes_sha256: sha256,
    storage_key: storageKey,
    body: input.body,
    metadata: input.metadata
  };
}

// 统一处理公开网页/API 抓取的超时与状态码错误，避免各 adapter 自己散落网络细节。
export async function fetchBytesWithTimeout(url: string, options: FetchBytesOptions): Promise<Uint8Array> {
  const attempts = normalizedAttempts(options.attempts);
  const retryDelayMs = options.retryDelayMs ?? 0;
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": options.userAgent, ...options.headers },
        signal: AbortSignal.timeout(options.timeoutMs)
      });
      if (!response.ok) {
        const statusError = new FetchStatusError(`${options.sourceLabel} fetch failed: ${response.status} ${response.statusText}`, response.status);
        if (!isRetryableFetchError(statusError) || attempt === attempts) throw statusError;
        lastError = statusError;
      } else {
        return new Uint8Array(await response.arrayBuffer());
      }
    } catch (error) {
      const normalized = normalizeFetchError(error, options);
      if (!isRetryableFetchError(error) || attempt === attempts) throw normalized;
      lastError = normalized;
    }
    if (retryDelayMs > 0) await defaultSleepMs(retryDelayMs);
  }
  throw lastError ?? new Error(`${options.sourceLabel} fetch failed`);
}

class FetchStatusError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function normalizedAttempts(value: number | undefined): number {
  if (value === undefined) return 1;
  if (!Number.isInteger(value) || value < 1) throw new Error(`fetch attempts must be a positive integer: ${value}`);
  return value;
}

function normalizeFetchError(error: unknown, options: FetchBytesOptions): Error {
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return new Error(`${options.sourceLabel} fetch timed out after ${options.timeoutMs}ms`);
  }
  if (error instanceof FetchStatusError) return error;
  if (error instanceof Error) {
    const code = nodeErrorCode(error.cause);
    const codeSuffix = code === undefined ? "" : ` (${code})`;
    return new Error(`${options.sourceLabel} fetch failed: ${error.message}${codeSuffix}`);
  }
  if (typeof error === "string") return new Error(`${options.sourceLabel} fetch failed: ${error}`);
  return new Error(`${options.sourceLabel} fetch failed: unknown error`);
}

function isRetryableFetchError(error: unknown): boolean {
  if (error instanceof FetchStatusError) return error.status === 429 || error.status >= 500;
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") return true;
    const code = nodeErrorCode(error.cause);
    if (code !== undefined) return ["ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ETIMEDOUT"].includes(code);
    return error.message === "fetch failed";
  }
  return false;
}

function nodeErrorCode(value: unknown): string | undefined {
  if (typeof value === "object" && value !== null && "code" in value) {
    const code = (value as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

function defaultSleepMs(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export interface CachedSourceSnapshotInput {
  url: string;
  userAgent: string;
  partition: string;
  extension: string;
  storagePrefix: string;
  sourceLabel: string;
  timeoutMs: number;
  snapshotStore: SourceSnapshotStore;
  headers?: Record<string, string>;
}

export interface CachedSourceSnapshotResult {
  bytes: Uint8Array;
  source_fetch_status: "live" | "fallback";
  source_fetch_error?: string;
}

export async function fetchOrLoadCachedSnapshot(input: CachedSourceSnapshotInput): Promise<CachedSourceSnapshotResult> {
  try {
    return {
      bytes: await fetchBytesWithTimeout(input.url, {
        userAgent: input.userAgent,
        timeoutMs: input.timeoutMs,
        sourceLabel: input.sourceLabel,
        ...(input.headers === undefined ? {} : { headers: input.headers })
      }),
      source_fetch_status: "live"
    };
  } catch (error) {
    const cached = await input.snapshotStore.readLatest({ storagePrefix: input.storagePrefix, partition: input.partition, extension: input.extension });
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function safeSnapshotPath(root: string, key: string): string {
  const normalized = normalize(key);
  if (normalized.startsWith("..") || normalized.includes("/../")) {
    throw new Error(`Unsafe source snapshot key: ${key}`);
  }
  return join(root, normalized);
}

function snapshotStoreFor<TFetchInput>(definition: HtmlSnapshotAdapterDefinition<TFetchInput>, ctx: AdapterContext): SourceSnapshotStore {
  return ctx.snapshotStore ?? definition.snapshotStore ?? requireSnapshotStore(ctx, definition.id);
}

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
}
