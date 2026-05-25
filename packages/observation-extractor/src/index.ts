import type { DocumentType, NormalizedDocument, ObservationType } from "@supplystrata/core";
import { candidateSentences, findNearbySnippet } from "@supplystrata/parsers-text";

export type DisclosureObservationScopeKind = "company" | "component";
export type SemanticSectionKind = "inventory" | "backlog" | "capex" | "customer_concentration" | "procurement";

export interface DisclosureObservationDraft {
  observation_type: ObservationType;
  source_adapter_id: string;
  scope_kind: DisclosureObservationScopeKind;
  scope_id: string;
  component_id?: string;
  metric_name: string;
  metric_value: string;
  metric_unit: string;
  time_window_start?: string;
  time_window_end?: string;
  confidence: number;
  provenance: Record<string, unknown>;
  attrs: Record<string, unknown>;
}

export interface SemanticSectionSnapshot {
  section_kind: SemanticSectionKind;
  observation_type: ObservationType;
  source_adapter_id: string;
  scope_kind: DisclosureObservationScopeKind;
  scope_id: string;
  component_id?: string;
  title: string;
  cite_text: string;
  fingerprint: string;
  attrs: Record<string, unknown>;
}

interface DisclosureObservationPattern {
  section_kind: SemanticSectionKind;
  observation_type: ObservationType;
  title: string;
  metric_name: string;
  confidence: number;
  patterns: readonly RegExp[];
  exclude?: readonly RegExp[];
}

const SUPPORTED_DOCUMENT_TYPES = new Set<DocumentType>(["10-K", "10-Q", "20-F", "8-K", "annual_report"]);

const DISCLOSURE_OBSERVATION_PATTERNS: readonly DisclosureObservationPattern[] = [
  {
    section_kind: "inventory",
    observation_type: "INVENTORY_OBSERVATION",
    title: "Official disclosure mentions inventory or inventories",
    metric_name: "official_inventory_mention",
    confidence: 0.72,
    patterns: [/\binventor(?:y|ies)\b/i]
  },
  {
    section_kind: "backlog",
    observation_type: "BACKLOG_OBSERVATION",
    title: "Official disclosure mentions backlog",
    metric_name: "official_backlog_mention",
    confidence: 0.7,
    patterns: [/\bbacklog\b/i]
  },
  {
    section_kind: "capex",
    observation_type: "CAPEX_OBSERVATION",
    title: "Official disclosure mentions capital expenditure or capital commitments",
    metric_name: "official_capex_mention",
    confidence: 0.72,
    patterns: [/\bcapital (?:expenditure|expenditures|spending|commitment|commitments)\b/i]
  },
  {
    section_kind: "customer_concentration",
    observation_type: "CUSTOMER_CONCENTRATION_OBSERVATION",
    title: "Official disclosure mentions named customer concentration",
    metric_name: "official_customer_concentration_mention",
    confidence: 0.78,
    patterns: [
      /\bcustomer(?:s)?\b/i,
      /\b(?:accounted for|represented|contributed|comprised|derived from|revenue from|sales to|net sales to)\b/i,
      /\b(?:revenue|net sales|sales)\b/i
    ],
    exclude: [/\b(?:compete|competitor|competition|partner|partnership|platform|integrat(?:e|es|ed|ion)|compatible)\b/i]
  },
  {
    section_kind: "procurement",
    observation_type: "PROCUREMENT_OBSERVATION",
    title: "Official disclosure mentions purchase obligations or supply commitments",
    metric_name: "official_procurement_commitment_mention",
    confidence: 0.74,
    patterns: [
      /\b(?:purchase obligation|purchase obligations|long-term supply agreement|capacity reservation|take-or-pay|supply commitment|supply commitments)\b/i
    ]
  }
];

export function extractDisclosureObservations(document: NormalizedDocument): DisclosureObservationDraft[] {
  if (document.primary_entity_id === undefined) return [];
  if (!SUPPORTED_DOCUMENT_TYPES.has(document.document_type)) return [];
  const sentences = splitCandidateSentences(document.text);
  const drafts: DisclosureObservationDraft[] = [];
  const seen = new Set<string>();

  for (const pattern of DISCLOSURE_OBSERVATION_PATTERNS) {
    const citeText = findCiteText(document.text, sentences, pattern);
    if (citeText === undefined) continue;
    const componentId = inferComponentId(citeText);
    const scope =
      componentId === undefined
        ? { scope_kind: "company" as const, scope_id: document.primary_entity_id }
        : { scope_kind: "component" as const, scope_id: componentId };
    const key = `${pattern.observation_type}:${scope.scope_kind}:${scope.scope_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    drafts.push(toDraft({ document, pattern, citeText, componentId, scope }));
  }

  return drafts;
}

export function extractSemanticSections(document: NormalizedDocument): SemanticSectionSnapshot[] {
  if (document.primary_entity_id === undefined) return [];
  if (!SUPPORTED_DOCUMENT_TYPES.has(document.document_type)) return [];
  const sentences = splitCandidateSentences(document.text);
  const snapshots: SemanticSectionSnapshot[] = [];
  const seen = new Set<string>();

  for (const pattern of DISCLOSURE_OBSERVATION_PATTERNS) {
    const citeText = findCiteText(document.text, sentences, pattern);
    if (citeText === undefined) continue;
    const componentId = inferComponentId(citeText);
    const scope =
      componentId === undefined
        ? { scope_kind: "company" as const, scope_id: document.primary_entity_id }
        : { scope_kind: "component" as const, scope_id: componentId };
    const key = sectionIdentity(pattern.section_kind, scope.scope_kind, scope.scope_id);
    if (seen.has(key)) continue;
    seen.add(key);
    snapshots.push({
      section_kind: pattern.section_kind,
      observation_type: pattern.observation_type,
      source_adapter_id: document.source_adapter_id,
      scope_kind: scope.scope_kind,
      scope_id: scope.scope_id,
      title: pattern.title,
      cite_text: citeText,
      fingerprint: sectionFingerprint(citeText),
      attrs: {
        observation_extractor_id: "official-disclosure",
        document_type: document.document_type,
        source_url: document.source_url,
        source_date: document.source_date,
        fetched_at: document.fetched_at
      },
      ...(componentId === undefined ? {} : { component_id: componentId })
    });
  }

  return snapshots;
}

function toDraft(input: {
  document: NormalizedDocument;
  pattern: DisclosureObservationPattern;
  citeText: string;
  componentId: string | undefined;
  scope: { scope_kind: DisclosureObservationScopeKind; scope_id: string };
}): DisclosureObservationDraft {
  const { document, pattern, citeText, componentId, scope } = input;
  const draft: DisclosureObservationDraft = {
    observation_type: pattern.observation_type,
    source_adapter_id: document.source_adapter_id,
    scope_kind: scope.scope_kind,
    scope_id: scope.scope_id,
    metric_name: pattern.metric_name,
    metric_value: "1",
    metric_unit: "mention",
    confidence: pattern.confidence,
    provenance: {
      source_url: document.source_url,
      cite_text: citeText,
      document_type: document.document_type,
      fetched_at: document.fetched_at
    },
    attrs: {
      observation_extractor_id: "official-disclosure",
      title: pattern.title,
      cite_text: citeText,
      document_type: document.document_type
    }
  };
  if (componentId !== undefined) draft.component_id = componentId;
  if (document.source_date !== undefined) {
    draft.time_window_start = document.source_date;
    draft.time_window_end = document.source_date;
    draft.provenance["source_date"] = document.source_date;
  }
  return draft;
}

function splitCandidateSentences(text: string): string[] {
  return candidateSentences(text, { minLength: 40, maxLength: 1200 });
}

function findCiteText(text: string, sentences: readonly string[], pattern: DisclosureObservationPattern): string | undefined {
  const sentence = sentences.find((item) => pattern.patterns.every((regex) => regex.test(item)) && !hasExcludedContext(item, pattern));
  if (sentence !== undefined) return sentence;
  const snippet = findNearbySnippet(text, pattern.patterns, { beforeChars: 280, afterChars: 640, minLength: 40 });
  if (snippet === undefined || hasExcludedContext(snippet, pattern)) return undefined;
  return snippet;
}

function hasExcludedContext(sentence: string, pattern: DisclosureObservationPattern): boolean {
  if (pattern.exclude === undefined) return false;
  return pattern.exclude.some((item) => item.test(sentence));
}

function inferComponentId(text: string): string | undefined {
  if (/\b(?:HBM|High Bandwidth Memory|HBM3|HBM3e|HBM4)\b/i.test(text)) return "COMP-HBM";
  if (/\b(?:memory|DRAM|NAND|GDDR)\b/i.test(text)) return "COMP-MEMORY";
  if (/\b(?:wafer|foundry|fabrication|semiconductor manufacturing)\b/i.test(text)) return "COMP-WAFER";
  if (/\b(?:advanced packaging|CoWoS|packaging)\b/i.test(text)) return "COMP-ADVANCED-PACKAGING";
  return undefined;
}

function sectionIdentity(sectionKind: SemanticSectionKind, scopeKind: DisclosureObservationScopeKind, scopeId: string): string {
  return `${sectionKind}:${scopeKind}:${scopeId}`;
}

function sectionFingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}.$% -]+/gu, "")
    .trim();
}
