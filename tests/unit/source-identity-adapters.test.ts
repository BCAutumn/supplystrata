import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FetchTask } from "@supplystrata/core";
import type { AdapterContext, SourceSnapshotStore } from "@supplystrata/source-adapter-runtime";
import { gleifLeiAdapter } from "@supplystrata/sources-gleif";
import { openFigiAdapter } from "@supplystrata/sources-openfigi";
import { wikidataAdapter } from "@supplystrata/sources-wikidata";

describe("identity source adapters", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("declares conservative rate limits for GLEIF, OpenFIGI, and Wikidata", () => {
    expect(gleifLeiAdapter.rate_limit).toEqual({ requests: 5, per_seconds: 1 });
    expect(openFigiAdapter.rate_limit).toEqual({ requests: 25, per_seconds: 60 });
    expect(wikidataAdapter.rate_limit).toEqual({ requests: 1, per_seconds: 1 });
  });

  it("persists GLEIF raw snapshots into the audit cache", async () => {
    vi.stubGlobal("fetch", async () => jsonResponse({ data: [] }));
    const writes: { key: string; body: Uint8Array }[] = [];
    const task = await firstTask(gleifLeiAdapter.plan({ query: "LVMH", limit: 1 }, adapterContext(writes)));

    const raw = await gleifLeiAdapter.fetch(task, adapterContext(writes));

    expect(raw.source_adapter_id).toBe("gleif");
    expect(raw.storage_key).toMatch(/^entity-resolution\/gleif\/[a-f0-9]{64}\.json$/);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.key).toBe(raw.storage_key);
    expect(Buffer.from(writes[0]?.body ?? new Uint8Array()).toString("utf8")).toBe('{"data":[]}');
  });

  it("persists OpenFIGI raw snapshots and sends a POST request body", async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(init ?? {});
      return jsonResponse({ data: [] });
    });
    const writes: { key: string; body: Uint8Array }[] = [];
    const ctx = adapterContext(writes);
    const task = await firstTask(openFigiAdapter.plan({ query: "Samsung Electronics", exchangeCode: "kr", limit: 1 }, ctx));

    const raw = await openFigiAdapter.fetch(task, ctx);

    expect(raw.source_adapter_id).toBe("openfigi");
    expect(raw.storage_key).toMatch(/^entity-resolution\/openfigi\/[a-f0-9]{64}\.json$/);
    expect(writes).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toBe('{"query":"Samsung Electronics","exchCode":"KR"}');
  });

  it("surfaces GLEIF rate-limit responses as fetch errors", async () => {
    vi.stubGlobal("fetch", async () => new Response("too many", { status: 429, statusText: "Too Many Requests" }));
    const ctx = adapterContext([]);
    const task = await firstTask(gleifLeiAdapter.plan({ query: "TSMC", limit: 1 }, ctx));

    await expect(gleifLeiAdapter.fetch(task, ctx)).rejects.toThrow("429 Too Many Requests");
  });

  it("persists Wikidata SPARQL raw snapshots with query metadata", async () => {
    vi.stubGlobal("fetch", async () => jsonResponse({ results: { bindings: [] } }));
    const writes: { key: string; body: Uint8Array }[] = [];
    const ctx = adapterContext(writes);
    const task = await firstTask(wikidataAdapter.plan({ query: "AstraZeneca", limit: 1 }, ctx));

    const raw = await wikidataAdapter.fetch(task, ctx);

    expect(raw.source_adapter_id).toBe("wikidata");
    expect(raw.storage_key).toMatch(/^entity-resolution\/wikidata\/[a-f0-9]{64}\.json$/);
    expect(raw.metadata["wikidata_request_kind"]).toBe("search");
    expect(raw.metadata["query"]).toBe("AstraZeneca");
    expect(writes).toHaveLength(1);
  });
});

async function firstTask(tasks: AsyncIterable<FetchTask>): Promise<FetchTask> {
  for await (const task of tasks) return task;
  throw new Error("adapter produced no task");
}

function adapterContext(writes: { key: string; body: Uint8Array }[]): AdapterContext {
  return {
    userAgent: "SupplyStrata test contact@example.com",
    now: () => new Date("2026-05-28T00:00:00.000Z"),
    snapshotStore: snapshotStore(writes)
  };
}

function snapshotStore(writes: { key: string; body: Uint8Array }[]): SourceSnapshotStore {
  return {
    async put(key, body) {
      writes.push({ key, body });
    },
    async readLatest() {
      return undefined;
    }
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
