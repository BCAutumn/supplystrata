import type { DbClient } from "@supplystrata/db";
import { listUnknownItems, resolveEntityId } from "@supplystrata/db";
import type { OutputFormat } from "./types.js";

export async function renderUnknownMap(client: DbClient, query: string, format: OutputFormat): Promise<string> {
  const entityId = await resolveEntityId(client, query);
  const items = await listUnknownItems(client, entityId);
  if (format === "json") return JSON.stringify({ schema_version: "1.0.0", scope: entityId, items }, null, 2);
  return [`# Unknown map [${entityId}]`, "", ...items.flatMap((item) => [`- ${item.question}`, `  Why unknown: ${item.why_unknown}`])].join("\n");
}
