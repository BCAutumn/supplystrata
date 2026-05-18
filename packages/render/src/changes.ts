import type { ChangeTimelineInput, ChangeTimelineItem, DbClient } from "@supplystrata/db";
import { listChangeTimeline } from "@supplystrata/db";
import type { OutputFormat } from "./types.js";

export async function renderChanges(client: DbClient, input: ChangeTimelineInput & { format: OutputFormat }): Promise<string> {
  const changes = await listChangeTimeline(client, input);
  return renderChangeTimelineItems(changes, {
    format: input.format,
    since: input.since
  });
}

export function renderChangeTimelineItems(items: readonly ChangeTimelineItem[], input: { format: OutputFormat; since: string }): string {
  if (input.format === "json") return JSON.stringify({ schema_version: "1.0.0", since: input.since, changes: items }, null, 2);
  const attention = items.filter((item) => item.requires_attention);
  const normal = items.filter((item) => !item.requires_attention);
  const lines = [`# Changes since ${input.since}`, "", `Total: ${items.length}`, `Requires attention: ${attention.length}`];
  appendChangeGroup(lines, "Requires attention", attention);
  appendChangeGroup(lines, "Timeline", normal);
  return lines.join("\n");
}

function appendChangeGroup(lines: string[], title: string, items: readonly ChangeTimelineItem[]): void {
  lines.push("", `## ${title}`, "");
  if (items.length === 0) {
    lines.push("(none)");
    return;
  }
  for (const item of items) {
    lines.push(`- ${item.event_type} ${changePrimaryId(item)} at ${item.occurred_at}`);
    lines.push(`  ${changeSummary(item)}`);
    if (item.source_adapter_id !== undefined) lines.push(`  Source: ${item.source_adapter_id}`);
    if (item.evidence_id !== undefined)
      lines.push(`  Evidence: ${item.evidence_id}${item.evidence_level === undefined ? "" : ` [Level ${item.evidence_level}]`}`);
    if (item.doc_id !== undefined) lines.push(`  Document: ${item.doc_id}`);
  }
}

function changePrimaryId(item: ChangeTimelineItem): string {
  return item.edge_id ?? item.evidence_id ?? item.doc_id ?? item.source_item_id ?? item.scope_id ?? item.event_id;
}

function changeSummary(item: ChangeTimelineItem): string {
  if (item.event_family === "source") return `Source monitor recorded ${item.event_type.toLowerCase()} for ${item.source_adapter_id ?? "unknown source"}.`;
  if (item.subject_name !== undefined && item.object_name !== undefined && item.relation !== undefined) {
    const component = item.component === undefined ? "" : ` (${item.component})`;
    return `${item.subject_name} -${item.relation}${component}-> ${item.object_name}.`;
  }
  if (item.scope_kind !== undefined && item.scope_id !== undefined) return `${item.scope_kind}:${item.scope_id} changed by ${item.caused_by}.`;
  return `Change ${item.event_id} caused by ${item.caused_by}.`;
}
