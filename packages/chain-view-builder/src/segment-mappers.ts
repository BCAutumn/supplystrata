import { type ComponentUpstreamLead } from "@supplystrata/component-context";
import type { LeadObservationRow, ObservationRow, UnknownItemRow } from "@supplystrata/db/read";
import type { SourcePlanItem } from "@supplystrata/source-plan";
import { type ChainViewEndpoint, type ChainViewRoot, type ChainViewSegmentModel, type ChainViewSourceHint } from "@supplystrata/chain-view";
import type { ChainFactRow } from "./db-rows.js";

export function segmentsFromFactRow(row: ChainFactRow, rowIndex: number): ChainViewSegmentModel[] {
  const factSegment = edgeSegmentFromFactRow(row, rowIndex * 2);
  if (row.claim_id === null || row.claim_text === null) return [factSegment];
  return [factSegment, claimSegmentFromFactRow(row, rowIndex * 2 + 1)];
}

export function segmentFromObservation(row: ObservationRow, input: { root: ChainViewRoot; sequence_index: number }): ChainViewSegmentModel {
  const target: ChainViewEndpoint = row.component_id === null ? input.root : { kind: "component", id: row.component_id, name: row.component_id };
  return {
    sequence_index: input.sequence_index,
    depth: 0,
    semantic_layer: "observation",
    from: input.root,
    to: target,
    relation: "OBSERVES",
    component: null,
    component_id: row.component_id,
    observation_id: row.observation_id,
    evidence_ids: [],
    confidence: row.confidence,
    label: observationLabel(row)
  };
}

export function segmentFromLead(row: LeadObservationRow, input: { root: ChainViewRoot; sequence_index: number }): ChainViewSegmentModel {
  return {
    sequence_index: input.sequence_index,
    depth: 0,
    semantic_layer: "lead",
    from: input.root,
    to: input.root,
    relation: "LEADS_TO",
    component: null,
    component_id: null,
    lead_id: row.lead_id,
    evidence_ids: [],
    confidence: leadConfidence(row),
    label: `${row.title}: ${row.summary}`
  };
}

export function segmentFromComponentUpstreamLead(
  lead: ComponentUpstreamLead,
  input: { row: ChainFactRow; sequence_index: number; sourceHints?: readonly ChainViewSourceHint[] }
): ChainViewSegmentModel {
  return {
    sequence_index: input.sequence_index,
    depth: input.row.depth + lead.tier_depth,
    semantic_layer: "lead",
    from: { kind: "company", id: input.row.upstream_id, name: input.row.upstream_name },
    to: { kind: lead.target_kind, id: lead.target_id, name: lead.target_name },
    relation: "LEADS_TO",
    component: lead.target_name,
    component_id: lead.target_kind === "component" ? lead.target_id : input.row.component_id,
    lead_id: lead.dependency_id,
    evidence_ids: [],
    confidence: lead.confidence,
    label: componentLeadLabel(lead, input.row),
    // 二/三级 lead 必须带上“下一步查什么源”，但这些 hint 仍然只是研究计划，不会升级成事实边。
    source_hints: [...(input.sourceHints ?? [])]
  };
}

export function segmentFromUnknown(row: UnknownItemRow, input: { root: ChainViewRoot; sequence_index: number }): ChainViewSegmentModel {
  return {
    sequence_index: input.sequence_index,
    depth: 0,
    semantic_layer: "unknown",
    from: input.root,
    to: input.root,
    relation: "UNKNOWN_BOUNDARY",
    component: null,
    component_id: null,
    unknown_id: row.unknown_id,
    evidence_ids: [],
    confidence: 0,
    label: `${row.question} — ${row.why_unknown}`
  };
}

export function sourceHintFromPlanItem(item: SourcePlanItem): ChainViewSourceHint {
  return {
    source_id: item.source_id,
    source_name: item.source_name,
    expected_output_layer: item.expected_output_layer,
    relation_policy: item.relation_policy,
    requires_key: item.requires_key,
    status: item.status,
    reasons: item.reasons.slice(0, 3)
  };
}

function edgeSegmentFromFactRow(row: ChainFactRow, sequenceIndex: number): ChainViewSegmentModel {
  return {
    sequence_index: sequenceIndex,
    depth: row.depth,
    semantic_layer: "edge",
    from: { kind: "company", id: row.subject_id, name: row.subject_name },
    to: { kind: "company", id: row.object_id, name: row.object_name },
    relation: row.relation,
    component: row.component,
    component_id: row.component_id,
    edge_id: row.edge_id,
    evidence_ids: row.primary_evidence_id === null ? [] : [row.primary_evidence_id],
    evidence_level: row.evidence_level,
    confidence: row.confidence,
    label: `${row.subject_name} -${row.relation}-> ${row.object_name}`
  };
}

function claimSegmentFromFactRow(row: ChainFactRow, sequenceIndex: number): ChainViewSegmentModel {
  const claimId = requirePresent(row.claim_id, "claim_id");
  const claimText = requirePresent(row.claim_text, "claim_text");
  return {
    sequence_index: sequenceIndex,
    depth: row.depth,
    semantic_layer: "claim",
    from: { kind: "company", id: row.subject_id, name: row.subject_name },
    to: { kind: "company", id: row.object_id, name: row.object_name },
    relation: "CLAIMS",
    component: row.component,
    component_id: row.component_id,
    claim_id: claimId,
    evidence_ids: row.primary_evidence_id === null ? [] : [row.primary_evidence_id],
    evidence_level: row.evidence_level,
    confidence: row.confidence,
    label: claimText
  };
}

function requirePresent(value: string | null, field: string): string {
  if (value === null) throw new Error(`${field} is required`);
  return value;
}

function observationLabel(row: ObservationRow): string {
  const value = row.metric_value === null ? "" : ` = ${row.metric_value}${row.metric_unit === null ? "" : ` ${row.metric_unit}`}`;
  return `${row.observation_type}: ${row.metric_name}${value}`;
}

function leadConfidence(row: LeadObservationRow): number {
  if (row.status === "promoted") return 0.8;
  if (row.status === "in_review") return 0.5;
  if (row.status === "open") return 0.25;
  return 0;
}

function componentLeadLabel(lead: ComponentUpstreamLead, row: ChainFactRow): string {
  const unknowns = lead.unknowns.length === 0 ? "" : ` Unknowns: ${lead.unknowns.join("; ")}.`;
  return `${lead.title}. Trigger: ${row.upstream_name} is linked by ${row.relation} (${row.component ?? row.component_id ?? "component"}). ${lead.summary}${unknowns}`;
}
