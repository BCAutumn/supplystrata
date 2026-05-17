import { describe, expect, it } from "vitest";
import type pg from "pg";
import type { DbClient } from "@supplystrata/db";
import { classifyDocumentChange, listDueSourceChecks, listSourceHealthRows, parseSourcePolicyConfig } from "@supplystrata/source-monitor";

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
  });

  it("keeps health and due-list queries read-only", async () => {
    const recorder = recordingClient();

    await listSourceHealthRows(recorder.client);
    await listDueSourceChecks(recorder.client, { now: "2026-05-17T00:00:00.000Z", limit: 5 });

    expect(recorder.sql).toHaveLength(2);
    expect(recorder.sql.every((sql) => sql.trimStart().startsWith("SELECT"))).toBe(true);
  });
});

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
