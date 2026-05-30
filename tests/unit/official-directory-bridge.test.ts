import type pg from "pg";
import { envSchema } from "@supplystrata/config";
import { dbTxClientBrand, type DbTxClient } from "@supplystrata/db/write";
import type { SourceSnapshotStore } from "@supplystrata/source-adapter-runtime";
import { describe, expect, it } from "vitest";
import {
  bridgeOfficialDirectoryIdentifiers,
  findDartKrDirectoryCandidates,
  findTwseDirectoryCandidates,
  loadOrFetchDirectorySnapshot,
  readMostRecentDirectorySnapshot,
  mergeOfficialDirectoryIdentifiers,
  parseOpenDartCorpCodeXml,
  parseTwseIsinListHtml,
  routeCountryOfficialDirectoryTargets
} from "@supplystrata/source-workflows";

const env = envSchema.parse({ OPENDART_API_KEY: "test-opendart-key" });
const now = "2026-05-28T00:00:00.000Z";

describe("official directory bridge", () => {
  it("bridges a unique OpenDART corp_code into identifiers before country routing", async () => {
    const identity = {
      entity_id: "ENT-SAMSUNG",
      display_name: "Samsung Electronics Co., Ltd.",
      primary_country: "KR",
      identifiers: { lei: "988400K1R0A5KSIXZL66" }
    };
    const bridged = await bridgeOfficialDirectoryIdentifiers(
      {
        identity,
        company_query: "Samsung Electronics",
        env,
        now
      },
      {
        lookupDartKrCompanyDirectory: async () => ({
          query: "Samsung Electronics",
          source_url: "fixture://opendart/corpCode.xml",
          candidates: findDartKrDirectoryCandidates(openDartFixtureRecords(), { query: "Samsung Electronics", limit: 5 })
        })
      }
    );

    expect(bridged).toMatchObject({
      status: "enriched",
      source_adapter_id: "dart-kr",
      identifiers: {
        opendart_corp_code: "00126380",
        dart_corp_code: "00126380",
        kr_stock_code: "005930"
      }
    });

    const routed = routeCountryOfficialDirectoryTargets({
      identity: { ...identity, identifiers: { ...identity.identifiers, ...bridged.identifiers } },
      namespace: "bridge-test",
      now
    });
    expect(routed.routes[0]).toMatchObject({ status: "routable", source_adapter_id: "dart-kr" });
    expect(routed.check_targets[0]?.target_config).toMatchObject({ corp_code: "00126380" });
  });

  it("bridges a unique TWSE stock code into identifiers before country routing", async () => {
    const identity = {
      entity_id: "ENT-TSMC",
      display_name: "Taiwan Semiconductor Manufacturing Company Limited",
      primary_country: "TW",
      identifiers: { lei: "549300KB6NK5M402S147" }
    };
    const bridged = await bridgeOfficialDirectoryIdentifiers(
      {
        identity,
        company_query: "TSMC",
        env,
        now
      },
      {
        lookupTwseCompanyDirectory: async () => ({
          query: "TSMC",
          source_url: "fixture://twse/isin",
          candidates: findTwseDirectoryCandidates(twseFixtureRecords(), { query: "2330", stockCode: "2330", limit: 5 })
        })
      }
    );

    expect(bridged).toMatchObject({
      status: "enriched",
      source_adapter_id: "twse-mops",
      identifiers: {
        twse_stock_code: "2330",
        stock_code: "2330"
      }
    });

    const routed = routeCountryOfficialDirectoryTargets({
      identity: { ...identity, identifiers: { ...identity.identifiers, ...bridged.identifiers } },
      namespace: "bridge-test",
      now
    });
    expect(routed.routes[0]).toMatchObject({ status: "routable", source_adapter_id: "twse-mops" });
  });

  it("returns ambiguous when the official directory lookup is not unique", async () => {
    const result = await bridgeOfficialDirectoryIdentifiers(
      {
        identity: {
          entity_id: "ENT-SAMSUNG",
          display_name: "Samsung",
          primary_country: "KR",
          identifiers: {}
        },
        company_query: "Samsung",
        env,
        now
      },
      {
        lookupDartKrCompanyDirectory: async () => ({
          query: "Samsung",
          source_url: "fixture://opendart/corpCode.xml",
          candidates: openDartFixtureRecords().slice(0, 2)
        })
      }
    );

    expect(result).toMatchObject({
      status: "ambiguous",
      source_adapter_id: "dart-kr"
    });
  });

  it("degrades to unavailable when the official directory lookup throws (run must not break)", async () => {
    const result = await bridgeOfficialDirectoryIdentifiers(
      {
        identity: {
          entity_id: "ENT-TSMC",
          display_name: "TSMC",
          primary_country: "TW",
          identifiers: {}
        },
        company_query: "TSMC",
        env,
        now
      },
      {
        lookupTwseCompanyDirectory: async () => {
          throw new Error("TWSE ISIN list fetch timed out after 20000ms");
        }
      }
    );

    expect(result).toMatchObject({ status: "unavailable", source_adapter_id: "twse-mops" });
    expect(result.reason).toContain("Official directory lookup failed");
  });

  it("persists bridged identifiers with an audit change record", async () => {
    const client = new MockTxClient();
    await mergeOfficialDirectoryIdentifiers(client, {
      entity_id: "ENT-SAMSUNG",
      identifiers: { opendart_corp_code: "00126380" },
      reviewer: "test",
      source_adapter_id: "dart-kr",
      source_url: "fixture://opendart/corpCode.xml",
      company_query: "Samsung Electronics"
    });

    expect(client.calls.some((call) => call.sql.includes("UPDATE entity_master") && call.params[1] === '{"opendart_corp_code":"00126380"}')).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("official_directory_bridge"))).toBe(true);
  });
});

describe("official directory parsers", () => {
  it("parses OpenDART corpCode XML into searchable records", () => {
    const records = parseOpenDartCorpCodeXml(`
      <result>
        <list>
          <corp_code>00126380</corp_code>
          <corp_name>삼성전자</corp_name>
          <corp_eng_name>Samsung Electronics Co., Ltd.</corp_eng_name>
          <stock_code>005930</stock_code>
        </list>
      </result>
    `);

    expect(findDartKrDirectoryCandidates(records, { query: "Samsung Electronics", limit: 5 })[0]).toMatchObject({
      corpCode: "00126380",
      stockCode: "005930"
    });
  });

  it("parses TWSE ISIN HTML rows into searchable records", () => {
    const records = parseTwseIsinListHtml(`
      <table>
        <tr><td>2330</td><td>Taiwan Semiconductor Manufacturing Co., Ltd.</td></tr>
      </table>
    `);

    expect(findTwseDirectoryCandidates(records, { query: "Taiwan Semiconductor Manufacturing", limit: 5 })[0]).toMatchObject({
      stockCode: "2330"
    });
  });
});

describe("directory snapshot cache", () => {
  it("reuses the same-day FS snapshot without fetching upstream", async () => {
    const cached = new TextEncoder().encode("<list></list>");
    const store = new MemorySnapshotStore({ "entity-directory/dart-kr/2026-05-28": cached });

    const bytes = await loadOrFetchDirectorySnapshot({
      url: "https://opendart.fss.or.kr/api/corpCode.xml",
      userAgent: "test-agent",
      sourceLabel: "OpenDART corpCode",
      storagePrefix: "entity-directory/dart-kr",
      extension: "zip",
      now,
      snapshotStore: store
    });

    expect(new TextDecoder().decode(bytes)).toBe("<list></list>");
    expect(store.reads).toEqual([{ storagePrefix: "entity-directory/dart-kr", partition: "2026-05-28", extension: "zip" }]);
    expect(store.puts).toHaveLength(0);
  });

  it("falls back to the most recent prior snapshot within the lookback window", async () => {
    const stale = new TextEncoder().encode("stale-twse");
    const store = new MemorySnapshotStore({ "entity-directory/twse/2026-05-25": stale });

    const found = await readMostRecentDirectorySnapshot(store, {
      storagePrefix: "entity-directory/twse",
      extension: "html",
      now,
      maxLookbackDays: 14
    });

    expect(found && new TextDecoder().decode(found)).toBe("stale-twse");
    expect(store.reads.map((read) => read.partition)).toEqual(["2026-05-27", "2026-05-26", "2026-05-25"]);
  });

  it("returns undefined when no snapshot exists inside the lookback window", async () => {
    const store = new MemorySnapshotStore({ "entity-directory/twse/2026-05-01": new TextEncoder().encode("too-old") });

    const found = await readMostRecentDirectorySnapshot(store, {
      storagePrefix: "entity-directory/twse",
      extension: "html",
      now,
      maxLookbackDays: 14
    });

    expect(found).toBeUndefined();
  });
});

class MockTxClient implements DbTxClient {
  readonly [dbTxClientBrand]: true = true;
  readonly calls: { sql: string; params: readonly unknown[] }[] = [];

  async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    return { command: "", rowCount: 1, oid: 0, fields: [], rows: [] };
  }
}

class MemorySnapshotStore implements SourceSnapshotStore {
  readonly reads: { storagePrefix: string; partition: string; extension: string }[] = [];
  readonly puts: { key: string; body: Uint8Array }[] = [];

  constructor(private readonly byPartition: Record<string, Uint8Array> = {}) {}

  async put(key: string, body: Uint8Array): Promise<void> {
    this.puts.push({ key, body });
  }

  async readLatest(input: { storagePrefix: string; partition: string; extension: string }): Promise<Uint8Array | undefined> {
    this.reads.push(input);
    return this.byPartition[`${input.storagePrefix}/${input.partition}`];
  }
}

function openDartFixtureRecords() {
  return parseOpenDartCorpCodeXml(`
    <list>
      <corp_code>00126380</corp_code>
      <corp_name>삼성전자</corp_name>
      <corp_eng_name>Samsung Electronics Co., Ltd.</corp_eng_name>
      <stock_code>005930</stock_code>
    </list>
    <list>
      <corp_code>00164779</corp_code>
      <corp_name>SK하이닉스</corp_name>
      <corp_eng_name>SK hynix Inc.</corp_eng_name>
      <stock_code>000660</stock_code>
    </list>
  `);
}

function twseFixtureRecords() {
  return parseTwseIsinListHtml(`<tr><td>2330</td><td>Taiwan Semiconductor Manufacturing Co., Ltd.</td></tr>`);
}
