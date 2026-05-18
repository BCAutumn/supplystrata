import type { DbClient, PendingEntityStatusFilter } from "@supplystrata/db";
import { getPendingEntity, listPendingEntities } from "@supplystrata/db";
import type { OutputFormat } from "./types.js";

export async function renderPendingEntities(
  client: DbClient,
  input: {
    status: PendingEntityStatusFilter;
    limit: number;
    format: OutputFormat;
  }
): Promise<string> {
  const items = await listPendingEntities(client, {
    status: input.status,
    limit: input.limit
  });
  if (input.format === "json") return JSON.stringify({ schema_version: "1.0.0", pending_entities: items }, null, 2);
  const lines = ["# Pending Entities", "", `Status: ${input.status}`, `Count: ${items.length}`, ""];
  for (const item of items) {
    lines.push(`- ${item.pending_id}: ${item.surface}`);
    lines.push(`  Status: ${item.status}; occurrences: ${item.occurrence_count}; first seen: ${item.first_seen_at.toISOString()}`);
    if (item.resolved_entity_id !== null) lines.push(`  Resolved entity: ${item.resolved_entity_id}`);
    lines.push(`  Next: supplystrata entity pending lookup ${item.pending_id} --source all`);
  }
  return lines.join("\n");
}

export async function renderPendingEntity(client: DbClient, pendingId: string, format: OutputFormat): Promise<string> {
  const item = await getPendingEntity(client, pendingId);
  if (item === undefined) throw new Error(`Pending entity not found: ${pendingId}`);
  if (format === "json") return JSON.stringify({ schema_version: "1.0.0", pending_entity: item }, null, 2);
  return [
    `# Pending Entity ${item.pending_id}`,
    "",
    `Surface: ${item.surface}`,
    `Status: ${item.status}`,
    `Occurrences: ${item.occurrence_count}`,
    `First seen: ${item.first_seen_at.toISOString()}`,
    item.resolved_entity_id === null ? "Resolved entity: (none)" : `Resolved entity: ${item.resolved_entity_id}`,
    item.reviewer === null ? "Reviewer: (none)" : `Reviewer: ${item.reviewer}`,
    "",
    "## Context",
    "",
    JSON.stringify(item.context, null, 2),
    "",
    "## Next",
    "",
    `supplystrata entity pending lookup ${item.pending_id} --source all`,
    `supplystrata review enqueue entity-source "${item.surface}" --source <source>`
  ].join("\n");
}
