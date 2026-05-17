import { describe, expect, it } from "vitest";
import { createRateLimitedSourceAdapter, SourceRateLimiter, type AdapterContext, type SourceAdapter } from "@supplystrata/source-adapter-spec";

describe("source adapter rate limiter", () => {
  it("serializes concurrent fetches using adapter rate_limit", async () => {
    let nowMs = 0;
    const waits: number[] = [];
    const calls: string[] = [];
    const limiter = new SourceRateLimiter({
      nowMs: () => nowMs,
      sleepMs: async (milliseconds) => {
        waits.push(milliseconds);
        nowMs += milliseconds;
      }
    });
    const adapter = createRateLimitedSourceAdapter(fakeAdapter(calls), limiter);
    const task = {
      task_id: "task-1",
      url: "https://example.com/a",
      expected_format: "html" as const
    };

    await Promise.all([
      adapter.fetch(task, adapterContext()),
      adapter.fetch(task, adapterContext())
    ]);

    expect(waits).toEqual([2000]);
    expect(calls).toEqual(["fetch:task-1", "fetch:task-1"]);
  });

  it("applies the same limiter to plan and fetch", async () => {
    let nowMs = 0;
    const waits: number[] = [];
    const calls: string[] = [];
    const limiter = new SourceRateLimiter({
      nowMs: () => nowMs,
      sleepMs: async (milliseconds) => {
        waits.push(milliseconds);
        nowMs += milliseconds;
      }
    });
    const adapter = createRateLimitedSourceAdapter(fakeAdapter(calls), limiter);

    for await (const _task of adapter.plan({ id: "a" }, adapterContext())) {
      break;
    }
    await adapter.fetch({
      task_id: "task-1",
      url: "https://example.com/a",
      expected_format: "html"
    }, adapterContext());

    expect(waits).toEqual([2000]);
    expect(calls).toEqual(["plan:a", "fetch:task-1"]);
  });
});

function fakeAdapter(calls: string[]): SourceAdapter<{ id: string }, Uint8Array> {
  return {
    id: "fake-source",
    tier: "P0",
    description: "fake source",
    tos_url: "https://example.com/tos",
    rate_limit: { requests: 1, per_seconds: 2 },
    async *plan(input) {
      calls.push(`plan:${input.id}`);
      yield {
        task_id: `task-${input.id}`,
        url: `https://example.com/${input.id}`,
        expected_format: "html"
      };
    },
    async fetch(task, ctx) {
      calls.push(`fetch:${task.task_id}`);
      return {
        doc_id: `DOC-${task.task_id}`,
        source_adapter_id: "fake-source",
        url: task.url,
        fetched_at: ctx.now().toISOString(),
        bytes_sha256: "sha",
        storage_key: "fake/raw.html",
        body: new Uint8Array(),
        metadata: {}
      };
    },
    async normalize(raw) {
      return {
        doc_id: raw.doc_id,
        source_adapter_id: raw.source_adapter_id,
        document_type: "10-K",
        language: "en",
        fetched_at: raw.fetched_at,
        source_url: raw.url,
        storage_key: raw.storage_key,
        bytes_sha256: raw.bytes_sha256,
        text: "fake",
        chunks: [],
        metadata: {}
      };
    }
  };
}

function adapterContext(): AdapterContext {
  return {
    userAgent: "SupplyStrata test contact@example.com",
    now: () => new Date("2026-05-17T00:00:00.000Z")
  };
}
