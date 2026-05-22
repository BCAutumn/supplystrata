import { afterEach, describe, expect, it, vi } from "vitest";
import {
  credentialAuthorizationHeader,
  credentialBasicAuthorizationHeader,
  credentialNamedHeader,
  credentialQueryParamUrl,
  createRateLimitedSourceAdapter,
  defineHtmlSnapshotAdapter,
  requireAdapterCredential,
  SourceRateLimiter,
  urlWithCredentialQueryParam,
  type AdapterContext,
  type SourceAdapter,
  type SourceSnapshotStore
} from "@supplystrata/source-adapter-runtime";

describe("source adapter rate limiter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

    await Promise.all([adapter.fetch(task, adapterContext()), adapter.fetch(task, adapterContext())]);

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
    await adapter.fetch(
      {
        task_id: "task-1",
        url: "https://example.com/a",
        expected_format: "html"
      },
      adapterContext()
    );

    expect(waits).toEqual([2000]);
    expect(calls).toEqual(["plan:a", "fetch:task-1"]);
  });

  it("requires explicit snapshot storage for HTML snapshot adapters", async () => {
    const adapter = defineHtmlSnapshotAdapter<{ id: string }>({
      id: "html-source",
      tier: "P0",
      description: "HTML source",
      tos_url: "https://example.com/tos",
      rate_limit: { requests: 1, per_seconds: 1 },
      sourceLabel: "HTML source",
      storagePrefix: "html-source",
      async *plan() {
        yield { task_id: "task-1", url: "https://example.com/a.html", expected_format: "html", hint: { period: "2026-01-01" } };
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
          text: "html",
          chunks: [],
          metadata: {}
        };
      }
    });

    await expect(adapter.fetch({ task_id: "task-1", url: "https://example.com/a.html", expected_format: "html" }, adapterContext())).rejects.toThrow(
      "requires AdapterContext.snapshotStore"
    );
  });

  it("writes HTML snapshots through the injected snapshot store", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response("<html><body>ok</body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html" }
        })
    );
    const writes: { key: string; body: Uint8Array }[] = [];
    const snapshotStore: SourceSnapshotStore = {
      async put(key, body) {
        writes.push({ key, body });
      },
      async readLatest() {
        return undefined;
      }
    };
    const adapter = defineHtmlSnapshotAdapter<{ id: string }>({
      id: "html-source",
      tier: "P0",
      description: "HTML source",
      tos_url: "https://example.com/tos",
      rate_limit: { requests: 10, per_seconds: 1 },
      sourceLabel: "HTML source",
      storagePrefix: "html-source",
      async *plan() {
        yield { task_id: "task-1", url: "https://example.com/a.html", expected_format: "html", hint: { period: "2026-01-01" } };
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
          text: "html",
          chunks: [],
          metadata: {}
        };
      }
    });

    const raw = await adapter.fetch(
      { task_id: "task-1", url: "https://example.com/a.html", expected_format: "html", hint: { period: "2026-01-01" } },
      { ...adapterContext(), snapshotStore }
    );

    expect(raw.storage_key).toMatch(/^html-source\/2026\/[a-f0-9]{64}\.html$/);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.key).toBe(raw.storage_key);
    expect(new TextDecoder().decode(writes[0]?.body)).toContain("<body>ok</body>");
  });

  it("builds credential transport values from explicit adapter context", () => {
    const ctx = adapterContext({
      COMPANIES_HOUSE_API_KEY: " house-key ",
      OSH_API_TOKEN: "osh-token",
      OPEN_CORPORATES_API_TOKEN: "oc-token",
      CENSUS_API_KEY: " census-key "
    });

    expect(requireAdapterCredential(ctx, "COMPANIES_HOUSE_API_KEY", "Companies House")).toBe("house-key");
    expect(credentialBasicAuthorizationHeader(ctx, "COMPANIES_HOUSE_API_KEY", "Companies House")).toEqual({
      Authorization: "Basic aG91c2Uta2V5Og=="
    });
    expect(credentialAuthorizationHeader(ctx, "OSH_API_TOKEN", "Open Supply Hub", "Token")).toEqual({ Authorization: "Token osh-token" });
    expect(credentialNamedHeader(ctx, "OPEN_CORPORATES_API_TOKEN", "OpenCorporates", "X-API-TOKEN")).toEqual({
      "X-API-TOKEN": "oc-token"
    });
    expect(credentialQueryParamUrl("https://api.example.test/search?q=abc", ctx, "CENSUS_API_KEY", "Census", "key")).toBe(
      "https://api.example.test/search?q=abc&key=census-key"
    );
    expect(urlWithCredentialQueryParam("https://api.example.test/search?q=abc", " raw-key ", "Subscription-Key", "EDINET")).toBe(
      "https://api.example.test/search?q=abc&Subscription-Key=raw-key"
    );
  });

  it("rejects missing credential values before building transport fields", () => {
    expect(() => requireAdapterCredential(adapterContext(), "MISSING_KEY", "Test source")).toThrow(
      "Test source requires AdapterContext.credentials.MISSING_KEY"
    );
    expect(() => urlWithCredentialQueryParam("https://api.example.test/search", " ", "key", "Test source")).toThrow(
      "Test source credential query param key must not be empty"
    );
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

function adapterContext(credentials?: AdapterContext["credentials"]): AdapterContext {
  return {
    userAgent: "SupplyStrata test contact@example.com",
    now: () => new Date("2026-05-17T00:00:00.000Z"),
    ...(credentials === undefined ? {} : { credentials })
  };
}
