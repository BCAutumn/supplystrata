import { describe, expect, it } from "vitest";
import type pg from "pg";
import { dbTxClientBrand, type DbClient, type DbTxClient } from "@supplystrata/db";
import {
  classifyDocumentChange,
  listDueSourceChecks,
  listSourceHealthRows,
  parseSourcePolicyConfig,
  recordDocumentObservation,
  recordSourceDegraded,
  recordSourceFailure
} from "@supplystrata/source-monitor";

describe("source monitor", () => {
  it("classifies first seen, unchanged, and changed documents", () => {
    expect(classifyDocumentChange(null, "sha-a")).toBe("DOCUMENT_NEW");
    expect(classifyDocumentChange("sha-a", "sha-a")).toBe("DOCUMENT_UNCHANGED");
    expect(classifyDocumentChange("sha-a", "sha-b")).toBe("DOCUMENT_CHANGED");
  });

  it("parses external source monitoring policies", () => {
    const config = parseSourcePolicyConfig(
      JSON.stringify({
        schema_version: "1.0.0",
        policies: [
          {
            source_adapter_id: "sec-edgar",
            enabled: true,
            check_cadence_minutes: 720,
            jitter_minutes: 60,
            priority: 10,
            notes: "twice daily"
          }
        ],
        check_targets: [
          {
            check_target_id: "sec-edgar:nvidia",
            source_adapter_id: "sec-edgar",
            target_kind: "sec-company-filings",
            enabled: true,
            priority: 10,
            subject_entity_id: "ENT-NVIDIA",
            target_config: {
              cik: "0001045810",
              entity_id: "ENT-NVIDIA",
              form_types: ["10-K", "10-Q", "8-K"],
              limit: 3
            },
            notes: "NVIDIA official filing monitor"
          }
        ]
      })
    );

    expect(config.policies[0]).toEqual({
      source_adapter_id: "sec-edgar",
      enabled: true,
      check_cadence_minutes: 720,
      jitter_minutes: 60,
      priority: 10,
      notes: "twice daily"
    });
    expect(config.check_targets[0]).toEqual({
      check_target_id: "sec-edgar:nvidia",
      source_adapter_id: "sec-edgar",
      target_kind: "sec-company-filings",
      enabled: true,
      priority: 10,
      subject_entity_id: "ENT-NVIDIA",
      target_config: {
        cik: "0001045810",
        entity_id: "ENT-NVIDIA",
        form_types: ["10-K", "10-Q", "8-K"],
        limit: 3
      },
      notes: "NVIDIA official filing monitor"
    });
  });

  it("keeps health and due-list queries read-only", async () => {
    const recorder = recordingClient();

    await listSourceHealthRows(recorder.client);
    await listDueSourceChecks(recorder.client, { now: "2026-05-17T00:00:00.000Z", limit: 5 });

    expect(recorder.sql).toHaveLength(2);
    expect(recorder.sql.every((sql) => sql.trimStart().startsWith("SELECT"))).toBe(true);
  });

  it("records source failures as source change events and increments health", async () => {
    const client = new SourceMonitorDbClient({ failureCount: 1 });

    const result = await recordSourceFailure(client, {
      source_adapter_id: "sec-edgar",
      error_message: "HTTP 503",
      failed_at: "2026-05-17T00:00:00.000Z",
      task_id: "TASK-1",
      url: "https://www.sec.gov/Archives/example"
    });

    expect(result.event_id).toMatch(/^SEV-/);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO source_change_events") && call.sql.includes("SOURCE_FAILED"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("failure_count = failure_count + 1"))).toBe(true);
  });

  it("records recovery when a successful document observation follows failures", async () => {
    const client = new SourceMonitorDbClient({ failureCount: 2, lastErrorMessage: "HTTP 503" });

    const result = await recordDocumentObservation(client, {
      source_adapter_id: "sec-edgar",
      source_url: "https://www.sec.gov/Archives/example",
      doc_id: "DOC-TEST",
      bytes_sha256: "sha-new",
      storage_key: "sec/example.html",
      observed_at: "2026-05-17T01:00:00.000Z"
    });

    expect(result.change_type).toBe("DOCUMENT_NEW");
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO source_change_events") && call.params.includes("DOCUMENT_NEW"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO source_change_events") && call.sql.includes("SOURCE_RECOVERED"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("failure_count = 0"))).toBe(true);
  });

  it("records cached fallback as degraded instead of success", async () => {
    const client = new SourceMonitorDbClient({ failureCount: 0 });

    const result = await recordSourceDegraded(client, {
      source_adapter_id: "tsmc-ir",
      error_message: "TSMC IR fetch timed out after 12000ms",
      degraded_at: "2026-05-17T02:00:00.000Z",
      task_id: "TASK-CACHED",
      url: "https://investor.tsmc.com/example"
    });

    expect(result.event_id).toMatch(/^SEV-/);
    expect(client.calls.some((call) => call.sql.includes("SOURCE_DEGRADED"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("last_failure_at = $2"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("last_success_at = $2"))).toBe(false);
  });
});

interface QueryCall {
  sql: string;
  params: readonly unknown[];
}

class SourceMonitorDbClient implements DbTxClient {
  readonly [dbTxClientBrand] = true;
  readonly calls: QueryCall[] = [];
  readonly #failureCount: number;
  readonly #lastErrorMessage: string | null;

  constructor(input: { failureCount: number; lastErrorMessage?: string }) {
    this.#failureCount = input.failureCount;
    this.#lastErrorMessage = input.lastErrorMessage ?? null;
  }

  async query<T extends pg.QueryResultRow>(statement: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql: statement, params });
    return {
      command: statement.trimStart().startsWith("SELECT") ? "SELECT" : "MOCK",
      rowCount: 0,
      oid: 0,
      fields: [],
      rows: rowsForStatement<T>(statement, this.#failureCount, this.#lastErrorMessage)
    };
  }
}

function rowsForStatement<T extends pg.QueryResultRow>(statement: string, failureCount: number, lastErrorMessage: string | null): T[] {
  if (statement.includes("FROM source_health")) {
    return [
      {
        failure_count: failureCount,
        last_failure_at: failureCount > 0 ? new Date("2026-05-17T00:00:00.000Z") : null,
        last_error_message: lastErrorMessage
      }
    ] as unknown as T[];
  }
  if (statement.includes("FROM source_items")) return [];
  return [];
}

function recordingClient(): { client: DbClient; sql: string[] } {
  const sql: string[] = [];
  return {
    sql,
    client: {
      async query<T extends pg.QueryResultRow>(statement: string): Promise<pg.QueryResult<T>> {
        sql.push(statement);
        return {
          command: "SELECT",
          rowCount: 0,
          oid: 0,
          fields: [],
          rows: []
        };
      }
    }
  };
}
