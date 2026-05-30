import { describe, expect, it } from "vitest";
import { listChangeTimeline, type DbClient } from "@supplystrata/db/read";
import type pg from "pg";

interface QueryCall {
  sql: string;
  params: readonly unknown[];
}

class ChangeTimelineDbClient implements DbClient {
  readonly calls: QueryCall[] = [];

  async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    return {
      command: "MOCK",
      rowCount: 0,
      oid: 0,
      fields: [],
      rows: rowsForChanges<T>(sql)
    };
  }
}

describe("db changes timeline", () => {
  it("extracts evidence supersession and relation semantic diff fields", async () => {
    const client = new ChangeTimelineDbClient();

    const items = await listChangeTimeline(client, { since: "2026-05-01T00:00:00.000Z", limit: 10, attentionOnly: true });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      event_type: "SUPPLIER_RELATION_REMOVED",
      event_family: "semantic",
      source_adapter_id: "sec-edgar",
      source_item_id: "SRCITEM-1",
      doc_id: "DOC-OLD",
      previous_doc_id: "DOC-OLD",
      semantic_relation_kind: "supplier_relation",
      relation_subject_surface: "nvidia",
      relation_object_surface: "sk hynix",
      relation: "BUYS_FROM",
      component: "memory",
      relation_fingerprint: "fingerprint-old",
      requires_attention: true
    });
    expect(items[1]).toMatchObject({
      event_type: "EVIDENCE_SUPERSEDED",
      event_family: "graph",
      edge_id: "EDGE-1",
      evidence_id: "EV-NEW",
      superseded_evidence_ids: ["EV-OLD"],
      superseded_by_evidence_id: "EV-NEW",
      requires_attention: true
    });
    expect(client.calls.some((call) => call.sql.includes("FROM change_records"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("FROM source_change_events"))).toBe(true);
  });

  it("filters the timeline to events touching one entity when an entity scope is given", async () => {
    const client = new ChangeTimelineDbClient();

    const items = await listChangeTimeline(client, {
      since: "2026-05-01T00:00:00.000Z",
      limit: 10,
      scope: { kind: "entity", id: "ENT-NVIDIA" }
    });

    // 只保留 subject/object/scope 命中 ENT-NVIDIA 的事件（EVIDENCE_SUPERSEDED），过滤掉无实体关联的 source 事件。
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ event_type: "EVIDENCE_SUPERSEDED", subject_id: "ENT-NVIDIA" });
  });
});

function rowsForChanges<T extends pg.QueryResultRow>(sql: string): T[] {
  if (sql.includes("FROM source_change_events")) return [];
  if (!sql.includes("FROM change_records")) return [];
  return [
    {
      change_id: "CHG-REL-REMOVED",
      change_type: "SUPPLIER_RELATION_REMOVED",
      detected_at: new Date("2026-05-17T00:10:00.000Z"),
      scope_kind: "source",
      scope_id: "sec-edgar",
      before: {
        source_adapter_id: "sec-edgar",
        source_item_id: "SRCITEM-1",
        doc_id: "DOC-OLD",
        source_url: "https://www.sec.gov/old",
        relation: "BUYS_FROM",
        semantic_relation_kind: "supplier_relation",
        subject_surface: "nvidia",
        object_surface: "sk hynix",
        component: "memory",
        fingerprint: "fingerprint-old"
      },
      after: null,
      caused_by: "relation-semantic-changes",
      evidence_id: null,
      evidence_level: null,
      source_adapter_id: "sec-edgar",
      doc_id: null,
      edge_id: null,
      subject_id: null,
      subject_name: null,
      object_id: null,
      object_name: null,
      relation: null,
      component: null
    },
    {
      change_id: "CHG-EV-SUPERSEDED",
      change_type: "evidence_superseded",
      detected_at: new Date("2026-05-17T00:05:00.000Z"),
      scope_kind: "edge",
      scope_id: "EDGE-1",
      before: { superseded_evidence_ids: ["EV-OLD"] },
      after: { superseded_by: "EV-NEW" },
      caused_by: "review",
      evidence_id: "EV-NEW",
      evidence_level: 5,
      source_adapter_id: "sec-edgar",
      doc_id: "DOC-NEW",
      edge_id: "EDGE-1",
      subject_id: "ENT-NVIDIA",
      subject_name: "NVIDIA",
      object_id: "ENT-SKHYNIX",
      object_name: "SK Hynix",
      relation: "BUYS_FROM",
      component: "memory"
    }
  ] as unknown as T[];
}
