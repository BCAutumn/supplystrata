import type pg from "pg";
import { describe, expect, it } from "vitest";
import { normalizeAlias } from "@supplystrata/core";
import { DbEntityResolver } from "@supplystrata/entity-resolver";
import type { DbClient } from "@supplystrata/db/read";

interface AliasFixture {
  entity_id: string;
  canonical_name: string;
  display_name: string;
  alias: string;
  alias_kind: "official" | "informal" | "abbreviation" | "translation" | "former";
  source_type: string | null;
  primary_country: string | null;
  identifiers: Record<string, unknown>;
  industry: string[];
}

class ResolverMockClient implements DbClient {
  readonly #aliases: readonly AliasFixture[];

  constructor(aliases: readonly AliasFixture[]) {
    this.#aliases = aliases;
  }

  async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    if (sql.includes("FROM entity_master WHERE lower(entity_id)")) return queryResult([]);
    if (sql.includes("FROM entity_master WHERE status = 'active'")) return queryResult([]);
    if (sql.includes("WHERE a.alias_norm = $1")) {
      const normalized = String(params[0] ?? "");
      return queryResult(this.#aliases.filter((alias) => normalizeAlias(alias.alias) === normalized) as unknown as T[]);
    }
    if (sql.includes("WHERE a.alias_norm LIKE $1")) {
      const normalized = String(params[0] ?? "").replace(/%/g, "");
      return queryResult(this.#aliases.filter((alias) => normalizeAlias(alias.alias).includes(normalized)) as unknown as T[]);
    }
    return queryResult([]);
  }
}

describe("DbEntityResolver", () => {
  it("auto-resolves long exact aliases imported from reviewed GLEIF candidates", async () => {
    const resolver = new DbEntityResolver(
      new ResolverMockClient([
        aliasFixture({
          entityId: "ENT-GLEIF-SKYWORKS",
          displayName: "Skyworks Solutions, Inc.",
          alias: "Skyworks Solutions Incorporated",
          aliasKind: "informal",
          sourceType: "gleif"
        })
      ])
    );

    await expect(resolver.resolve({ surface: "Skyworks Solutions Incorporated" })).resolves.toMatchObject({
      status: "resolved",
      entity_id: "ENT-GLEIF-SKYWORKS"
    });
  });

  it("keeps short reviewed registry aliases out of automatic resolution", async () => {
    const resolver = new DbEntityResolver(
      new ResolverMockClient([
        aliasFixture({
          entityId: "ENT-GLEIF-3M",
          displayName: "3M COMPANY",
          alias: "3M",
          aliasKind: "informal",
          sourceType: "gleif"
        })
      ])
    );

    await expect(resolver.resolve({ surface: "3M" })).resolves.toMatchObject({
      status: "ambiguous",
      needs_human_review: true
    });
  });
});

function aliasFixture(input: {
  entityId: string;
  displayName: string;
  alias: string;
  aliasKind: AliasFixture["alias_kind"];
  sourceType: string | null;
}): AliasFixture {
  return {
    entity_id: input.entityId,
    canonical_name: input.displayName,
    display_name: input.displayName,
    alias: input.alias,
    alias_kind: input.aliasKind,
    source_type: input.sourceType,
    primary_country: null,
    identifiers: {},
    industry: []
  };
}

function queryResult<T extends pg.QueryResultRow>(rows: T[]): pg.QueryResult<T> {
  return {
    command: "",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows
  };
}
