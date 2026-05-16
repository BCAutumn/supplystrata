import type { FetchTask, NormalizedDocument, RawDocument } from "@supplystrata/core";

export interface AdapterContext {
  userAgent: string;
  now(): Date;
}

export interface SourceAdapter<TFetchInput, TRawDoc> {
  readonly id: string;
  readonly tier: "P0" | "P1" | "P2";
  readonly description: string;
  readonly tos_url: string;
  readonly rate_limit: { requests: number; per_seconds: number };
  plan(input: TFetchInput, ctx: AdapterContext): AsyncIterable<FetchTask>;
  fetch(task: FetchTask, ctx: AdapterContext): Promise<RawDocument<TRawDoc>>;
  normalize(raw: RawDocument<TRawDoc>, ctx: AdapterContext): Promise<NormalizedDocument>;
}
