import type { DbClient } from "@supplystrata/db";
import { listUnknownItems, resolveEntityId } from "@supplystrata/db";
import type { OutputFormat } from "./types.js";

export interface UnknownMapModel {
  scope: string;
  items: Awaited<ReturnType<typeof listUnknownItems>>;
}

export async function loadUnknownMap(client: DbClient, query: string): Promise<UnknownMapModel> {
  const entityId = await resolveEntityId(client, query);
  const items = await listUnknownItems(client, entityId);
  return { scope: entityId, items };
}

export async function renderUnknownMap(client: DbClient, query: string, format: OutputFormat): Promise<string> {
  return renderUnknownMapCard(await loadUnknownMap(client, query), format);
}

export function renderUnknownMapCard(model: UnknownMapModel, format: OutputFormat): string {
  if (format === "json") return JSON.stringify({ schema_version: "1.0.0", scope: model.scope, items: model.items }, null, 2);
  return [`# Unknown map [${model.scope}]`, "", ...model.items.flatMap((item) => [`- ${item.question}`, `  Why unknown: ${item.why_unknown}`])].join("\n");
}
