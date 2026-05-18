import type { OutputFormat } from "./types.js";

export type PendingEntityStatusFilter = "pending" | "resolved" | "all";

export interface PendingEntityModel {
  pending_id: string;
  surface: string;
  context: Record<string, unknown>;
  first_seen_at: string;
  occurrence_count: number;
  status: "pending" | "resolved" | "rejected";
  resolved_entity_id: string | null;
  reviewer: string | null;
}

export function renderPendingEntities(
  items: readonly PendingEntityModel[],
  input: {
    status: PendingEntityStatusFilter;
    format: OutputFormat;
  }
): string {
  if (input.format === "json") return JSON.stringify({ schema_version: "1.0.0", pending_entities: items }, null, 2);
  const lines = ["# Pending Entities", "", `Status: ${input.status}`, `Count: ${items.length}`, ""];
  for (const item of items) {
    lines.push(`- ${item.pending_id}: ${item.surface}`);
    lines.push(`  Status: ${item.status}; occurrences: ${item.occurrence_count}; first seen: ${item.first_seen_at}`);
    if (item.resolved_entity_id !== null) lines.push(`  Resolved entity: ${item.resolved_entity_id}`);
    lines.push(`  Next: supplystrata entity pending lookup ${item.pending_id} --source all`);
  }
  return lines.join("\n");
}

export function renderPendingEntity(item: PendingEntityModel, format: OutputFormat): string {
  if (format === "json") return JSON.stringify({ schema_version: "1.0.0", pending_entity: item }, null, 2);
  return [
    `# Pending Entity ${item.pending_id}`,
    "",
    `Surface: ${item.surface}`,
    `Status: ${item.status}`,
    `Occurrences: ${item.occurrence_count}`,
    `First seen: ${item.first_seen_at}`,
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
