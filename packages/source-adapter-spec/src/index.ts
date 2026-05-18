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

export function validateRateLimit(sourceAdapterId: string, rateLimit: SourceRateLimit): void {
  if (!Number.isFinite(rateLimit.requests) || rateLimit.requests <= 0) {
    throw new Error(`Invalid rate_limit.requests for ${sourceAdapterId}: ${rateLimit.requests}`);
  }
  if (!Number.isFinite(rateLimit.per_seconds) || rateLimit.per_seconds <= 0) {
    throw new Error(`Invalid rate_limit.per_seconds for ${sourceAdapterId}: ${rateLimit.per_seconds}`);
  }
}
