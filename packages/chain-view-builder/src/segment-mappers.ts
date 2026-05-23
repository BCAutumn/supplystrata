import { type ComponentUpstreamLead } from "@supplystrata/component-context";
import type { SourcePlanItem } from "@supplystrata/source-plan";
import { type ChainViewEndpoint, type ChainViewRoot, type ChainViewSegmentModel, type ChainViewSourceHint } from "@supplystrata/chain-view";
import type { ChainFact, ChainLead, ChainObservation, ChainUnknown } from "./definitions.js";

export function segmentsFromFact(fact: ChainFact, rowIndex: number): ChainViewSegmentModel[] {
  const factSegment = edgeSegmentFromFact(fact, rowIndex * 2);
  if (fact.claim_id === null || fact.claim_text === null) return [factSegment];
  return [factSegment, claimSegmentFromFact(fact, rowIndex * 2 + 1)];
}

export function segmentFromObservation(observation: ChainObservation, input: { root: ChainViewRoot; sequence_index: number }): ChainViewSegmentModel {
  const target: ChainViewEndpoint =
    observation.component_id === null ? input.root : { kind: "component", id: observation.component_id, name: observation.component_id };
  return {
    sequence_index: input.sequence_index,
    depth: 0,
    semantic_layer: "observation",
    from: input.root,
    to: target,
    relation: "OBSERVES",
    component: null,
    component_id: observation.component_id,
    observation_id: observation.observation_id,
    evidence_ids: [],
    confidence: observation.confidence,
    label: observationLabel(observation)
  };
}

export function segmentFromLead(lead: ChainLead, input: { root: ChainViewRoot; sequence_index: number }): ChainViewSegmentModel {
  return {
    sequence_index: input.sequence_index,
    depth: 0,
    semantic_layer: "lead",
    from: input.root,
    to: input.root,
    relation: "LEADS_TO",
    component: null,
    component_id: null,
    lead_id: lead.lead_id,
    evidence_ids: [],
    confidence: leadConfidence(lead),
    label: `${lead.title}: ${lead.summary}`
  };
}

export function segmentFromComponentUpstreamLead(
  lead: ComponentUpstreamLead,
  input: { fact: ChainFact; sequence_index: number; sourceHints?: readonly ChainViewSourceHint[] }
): ChainViewSegmentModel {
  return {
    sequence_index: input.sequence_index,
    depth: input.fact.depth + lead.tier_depth,
    semantic_layer: "lead",
    from: { kind: "company", id: input.fact.upstream_id, name: input.fact.upstream_name },
    to: { kind: lead.target_kind, id: lead.target_id, name: lead.target_name },
    relation: "LEADS_TO",
    component: lead.target_name,
    component_id: lead.target_kind === "component" ? lead.target_id : input.fact.component_id,
    lead_id: lead.dependency_id,
    evidence_ids: [],
    confidence: lead.confidence,
    label: componentLeadLabel(lead, input.fact),
    // 二/三级 lead 必须带上“下一步查什么源”，但这些 hint 仍然只是研究计划，不会升级成事实边。
    source_hints: [...(input.sourceHints ?? [])]
  };
}

export function segmentFromUnknown(unknown: ChainUnknown, input: { root: ChainViewRoot; sequence_index: number }): ChainViewSegmentModel {
  return {
    sequence_index: input.sequence_index,
    depth: 0,
    semantic_layer: "unknown",
    from: input.root,
    to: input.root,
    relation: "UNKNOWN_BOUNDARY",
    component: null,
    component_id: null,
    unknown_id: unknown.unknown_id,
    evidence_ids: [],
    confidence: 0,
    label: `${unknown.question} — ${unknown.why_unknown}`
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

function edgeSegmentFromFact(fact: ChainFact, sequenceIndex: number): ChainViewSegmentModel {
  return {
    sequence_index: sequenceIndex,
    depth: fact.depth,
    semantic_layer: "edge",
    from: { kind: "company", id: fact.subject_id, name: fact.subject_name },
    to: { kind: "company", id: fact.object_id, name: fact.object_name },
    relation: fact.relation,
    component: fact.component,
    component_id: fact.component_id,
    edge_id: fact.edge_id,
    evidence_ids: fact.primary_evidence_id === null ? [] : [fact.primary_evidence_id],
    evidence_level: fact.evidence_level,
    confidence: fact.confidence,
    label: `${fact.subject_name} -${fact.relation}-> ${fact.object_name}`
  };
}

function claimSegmentFromFact(fact: ChainFact, sequenceIndex: number): ChainViewSegmentModel {
  const claimId = requirePresent(fact.claim_id, "claim_id");
  const claimText = requirePresent(fact.claim_text, "claim_text");
  return {
    sequence_index: sequenceIndex,
    depth: fact.depth,
    semantic_layer: "claim",
    from: { kind: "company", id: fact.subject_id, name: fact.subject_name },
    to: { kind: "company", id: fact.object_id, name: fact.object_name },
    relation: "CLAIMS",
    component: fact.component,
    component_id: fact.component_id,
    claim_id: claimId,
    evidence_ids: fact.primary_evidence_id === null ? [] : [fact.primary_evidence_id],
    evidence_level: fact.evidence_level,
    confidence: fact.confidence,
    label: claimText
  };
}

function requirePresent(value: string | null, field: string): string {
  if (value === null) throw new Error(`${field} is required`);
  return value;
}

function observationLabel(observation: ChainObservation): string {
  const value =
    observation.metric_value === null ? "" : ` = ${observation.metric_value}${observation.metric_unit === null ? "" : ` ${observation.metric_unit}`}`;
  return `${observation.observation_type}: ${observation.metric_name}${value}`;
}

function leadConfidence(lead: ChainLead): number {
  if (lead.status === "promoted") return 0.8;
  if (lead.status === "in_review") return 0.5;
  if (lead.status === "open") return 0.25;
  return 0;
}

function componentLeadLabel(lead: ComponentUpstreamLead, fact: ChainFact): string {
  const unknowns = lead.unknowns.length === 0 ? "" : ` Unknowns: ${lead.unknowns.join("; ")}.`;
  return `${lead.title}. Trigger: ${fact.upstream_name} is linked by ${fact.relation} (${fact.component ?? fact.component_id ?? "component"}). ${lead.summary}${unknowns}`;
}
