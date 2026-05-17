import type { FetchTask, NormalizedDocument, RawDocument } from "@supplystrata/core";

export interface SourceRateLimit {
  requests: number;
  per_seconds: number;
}

export interface AdapterContext {
  userAgent: string;
  now(): Date;
}

export interface SourceAdapter<TFetchInput, TRawDoc> {
  readonly id: string;
  readonly tier: "P0" | "P1" | "P2";
  readonly description: string;
  readonly tos_url: string;
  readonly rate_limit: SourceRateLimit;
  plan(input: TFetchInput, ctx: AdapterContext): AsyncIterable<FetchTask>;
  fetch(task: FetchTask, ctx: AdapterContext): Promise<RawDocument<TRawDoc>>;
  normalize(raw: RawDocument<TRawDoc>, ctx: AdapterContext): Promise<NormalizedDocument>;
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

export const defaultSourceRateLimiter = new SourceRateLimiter();

export function createRateLimitedSourceAdapter<TFetchInput, TRawDoc>(
  adapter: SourceAdapter<TFetchInput, TRawDoc>,
  limiter: SourceRateLimiter = defaultSourceRateLimiter
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

function validateRateLimit(sourceAdapterId: string, rateLimit: SourceRateLimit): void {
  if (!Number.isFinite(rateLimit.requests) || rateLimit.requests <= 0) {
    throw new Error(`Invalid rate_limit.requests for ${sourceAdapterId}: ${rateLimit.requests}`);
  }
  if (!Number.isFinite(rateLimit.per_seconds) || rateLimit.per_seconds <= 0) {
    throw new Error(`Invalid rate_limit.per_seconds for ${sourceAdapterId}: ${rateLimit.per_seconds}`);
  }
}

function defaultSleepMs(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
