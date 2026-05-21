import type { EvidenceLevel, RelationType } from "@supplystrata/core";
import type { OutputFormat } from "./types.js";

export interface ChangeTimelineItemModel {
  event_id: string;
  event_family: "graph" | "source" | "semantic" | "risk";
  event_type: string;
  occurred_at: string;
  scope_kind?: string;
  scope_id?: string;
  source_adapter_id?: string;
  source_item_id?: string;
  doc_id?: string;
  previous_doc_id?: string;
  next_doc_id?: string;
  edge_id?: string;
  evidence_id?: string;
  evidence_level?: EvidenceLevel;
  superseded_evidence_ids?: string[];
  superseded_by_evidence_id?: string;
  subject_name?: string;
  object_name?: string;
  relation?: RelationType;
  component?: string;
  semantic_relation_kind?: string;
  relation_subject_surface?: string;
  relation_object_surface?: string;
  relation_fingerprint?: string;
  observation_scope_kind?: string;
  observation_scope_id?: string;
  metric_name?: string;
  metric_value?: string;
  metric_unit?: string;
  baseline_method?: string;
  baseline_value?: string;
  change_percent?: number;
  anomaly_severity?: string;
  anomaly_direction?: string;
  caused_by: string;
  requires_attention: boolean;
}

export function renderChangeTimelineItems(items: readonly ChangeTimelineItemModel[], input: { format: OutputFormat; since: string }): string {
  if (input.format === "json") return JSON.stringify({ schema_version: "1.0.0", since: input.since, changes: items }, null, 2);
  const attention = items.filter((item) => item.requires_attention);
  const normal = items.filter((item) => !item.requires_attention);
  const lines = [`# Changes since ${input.since}`, "", `Total: ${items.length}`, `Requires attention: ${attention.length}`];
  appendChangeGroup(lines, "Requires attention", attention);
  appendChangeGroup(lines, "Timeline", normal);
  return lines.join("\n");
}

function appendChangeGroup(lines: string[], title: string, items: readonly ChangeTimelineItemModel[]): void {
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

function changePrimaryId(item: ChangeTimelineItemModel): string {
  if (item.event_type === "OBSERVATION_ANOMALY" && item.scope_id !== undefined) return item.scope_id;
  return item.edge_id ?? item.evidence_id ?? item.doc_id ?? item.source_item_id ?? item.scope_id ?? item.event_id;
}

function changeSummary(item: ChangeTimelineItemModel): string {
  if (item.event_family === "source") return `Source monitor recorded ${item.event_type.toLowerCase()} for ${item.source_adapter_id ?? "unknown source"}.`;
  if (item.event_family === "risk") return `Risk metric ${item.scope_id ?? item.event_id} changed by ${item.caused_by}.`;
  if (item.event_type === "OBSERVATION_ANOMALY" && item.metric_name !== undefined) return observationAnomalySummary(item);
  if (item.event_type === "EVIDENCE_SUPERSEDED") return evidenceSupersessionSummary(item);
  if (isRelationSemanticChange(item)) return relationSemanticChangeSummary(item);
  if (item.subject_name !== undefined && item.object_name !== undefined && item.relation !== undefined) {
    const component = item.component === undefined ? "" : ` (${item.component})`;
    return `${item.subject_name} -${item.relation}${component}-> ${item.object_name}.`;
  }
  if (item.scope_kind !== undefined && item.scope_id !== undefined) return `${item.scope_kind}:${item.scope_id} changed by ${item.caused_by}.`;
  return `Change ${item.event_id} caused by ${item.caused_by}.`;
}

function evidenceSupersessionSummary(item: ChangeTimelineItemModel): string {
  const superseded =
    item.superseded_evidence_ids === undefined || item.superseded_evidence_ids.length === 0 ? "older evidence" : item.superseded_evidence_ids.join(", ");
  const replacement = item.superseded_by_evidence_id ?? item.evidence_id ?? "new evidence";
  const edge = item.edge_id === undefined ? "" : ` on edge ${item.edge_id}`;
  return `Evidence ${superseded} was superseded by ${replacement}${edge}.`;
}

function isRelationSemanticChange(item: ChangeTimelineItemModel): boolean {
  return item.semantic_relation_kind !== undefined || /_(?:RELATION|OBLIGATION|RESERVATION|RISK)_(?:ADDED|CHANGED|REMOVED)$/u.test(item.event_type);
}

function relationSemanticChangeSummary(item: ChangeTimelineItemModel): string {
  const subject = item.relation_subject_surface ?? "unknown subject";
  const object = item.relation_object_surface ?? "unknown object";
  const relation = item.relation ?? "relation";
  const component = item.component === undefined ? "" : ` (${item.component})`;
  const status = relationChangeStatus(item.event_type);
  const kind = item.semantic_relation_kind === undefined ? "relation" : item.semantic_relation_kind.replace(/_/gu, " ");
  const fingerprint = item.relation_fingerprint === undefined ? "" : ` fingerprint ${item.relation_fingerprint}`;
  return `Official disclosure ${kind} ${status}: ${subject} -${relation}${component}-> ${object}.${fingerprint}`;
}

function relationChangeStatus(eventType: string): string {
  if (eventType.endsWith("_ADDED")) return "added";
  if (eventType.endsWith("_REMOVED")) return "removed";
  if (eventType.endsWith("_CHANGED")) return "changed";
  return "changed";
}

function observationAnomalySummary(item: ChangeTimelineItemModel): string {
  const scope =
    item.observation_scope_kind === undefined || item.observation_scope_id === undefined
      ? ""
      : ` for ${item.observation_scope_kind}:${item.observation_scope_id}`;
  const direction = anomalyDirectionText(item.anomaly_direction);
  const change = item.change_percent === undefined ? "outside baseline" : `${item.change_percent.toFixed(2)}% vs baseline`;
  const baseline = item.baseline_value === undefined ? "" : ` ${item.baseline_value}`;
  const value = item.metric_value === undefined ? "" : `; value ${item.metric_value}${item.metric_unit === undefined ? "" : ` ${item.metric_unit}`}`;
  const severity = item.anomaly_severity === undefined ? "" : `; severity ${item.anomaly_severity}`;
  const method = item.baseline_method === undefined ? "" : `; method ${item.baseline_method}`;
  return `Observation ${item.metric_name}${scope} ${direction} ${change}${baseline}${value}${severity}${method}.`;
}

function anomalyDirectionText(direction: string | undefined): string {
  if (direction === "increase") return "increased";
  if (direction === "decrease") return "decreased";
  if (direction === "flat") return "stayed flat";
  return "changed";
}
