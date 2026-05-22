import type pg from "pg";

export interface EntityIdRow extends pg.QueryResultRow {
  entity_id: string;
}

export interface CountRow extends pg.QueryResultRow {
  count: string;
}
