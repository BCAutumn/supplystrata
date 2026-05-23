import type { EdgeStrengthKind } from "@supplystrata/core";

export interface EdgeStrengthDraft {
  strength_kind: EdgeStrengthKind;
  value?: string;
  lower_bound?: string;
  upper_bound?: string;
  unit?: string;
  method: string;
  attrs: Record<string, unknown>;
}

interface TextStrengthRule {
  readonly strength_kind: EdgeStrengthKind;
  readonly method: string;
  readonly match: (text: string) => EdgeStrengthDraft | undefined;
}

const EVIDENCE_TEXT_SOURCE = "primary_evidence_cite_text";

const NAMED_SHARE_RULE: TextStrengthRule = {
  strength_kind: "share",
  method: "intelligence-refresh.named-share-text.v1",
  match: (text) => {
    if (!/\b(?:accounted for|represented|comprised|made up|contributed)\b/i.test(text)) return undefined;
    if (!/\b(?:revenue|sales|purchases?|spend|supply|capacity|cost|costs|obligations?)\b/i.test(text)) return undefined;
    const match = /\b(\d{1,2}(?:\.\d+)?|100(?:\.0+)?)\s?%/u.exec(text);
    if (match?.[1] === undefined) return undefined;
    const value = Number.parseFloat(match[1]);
    if (!Number.isFinite(value) || value <= 0 || value > 100) return undefined;
    return {
      strength_kind: "share",
      value: value.toString(),
      unit: "percent",
      method: NAMED_SHARE_RULE.method,
      attrs: { source: EVIDENCE_TEXT_SOURCE, signal: "named_percentage_share" }
    };
  }
};

const TEXT_STRENGTH_RULES: readonly TextStrengthRule[] = [
  NAMED_SHARE_RULE,
  {
    strength_kind: "dependency",
    method: "intelligence-refresh.dependency-text.v1",
    match: (text) => {
      if (/\b(?:sole source|single source|single-source|sole supplier|single supplier)\b/i.test(text)) {
        return dependencyDraft("1", "single_source_dependency", "single_source");
      }
      if (/\b(?:limited number of suppliers|limited suppliers|limited supplier base|few suppliers)\b/i.test(text)) {
        return dependencyDraft("0.7", "limited_supplier_dependency", "limited_supplier");
      }
      return undefined;
    }
  },
  {
    strength_kind: "capacity",
    method: "intelligence-refresh.capacity-text.v1",
    match: (text) => {
      if (
        !/\b(?:capacity reservations?|capacity commitments?|capacity reservation agreements?|take[-\s]?or[-\s]?pay|purchase obligations?|purchase commitments?|long[-\s]?term supply agreements?|wafer supply agreements?)\b/i.test(
          text
        )
      ) {
        return undefined;
      }
      return {
        strength_kind: "capacity",
        value: "1",
        unit: "disclosed_commitment",
        method: "intelligence-refresh.capacity-text.v1",
        attrs: { source: EVIDENCE_TEXT_SOURCE, signal: "capacity_or_purchase_commitment" }
      };
    }
  },
  {
    strength_kind: "qualitative",
    method: "intelligence-refresh.qualitative-text.v1",
    match: (text) => {
      if (!/\b(?:primary|principal|strategic|key|major|significant|main)\s+(?:supplier|customer|foundry|manufacturer|partner)\b/i.test(text)) {
        return undefined;
      }
      return {
        strength_kind: "qualitative",
        value: "1",
        unit: "qualitative_flag",
        method: "intelligence-refresh.qualitative-text.v1",
        attrs: { source: EVIDENCE_TEXT_SOURCE, signal: "explicit_strong_relationship_language" }
      };
    }
  }
];

export function inferEdgeStrengthDrafts(edge: { cite_text: string; object_name: string }): EdgeStrengthDraft[] {
  const text = normalizeWhitespace(edge.cite_text);
  // 强度只能来自命名 counterparty 的原文证据；匿名 customer/supplier concentration 只能留下 unknown。
  if (!mentionsCounterparty(text, edge.object_name)) return [];

  return dedupeStrengthDrafts(TEXT_STRENGTH_RULES.flatMap((rule) => rule.match(text) ?? []));
}

function dependencyDraft(value: string, signal: string, dependencyKind: string): EdgeStrengthDraft {
  return {
    strength_kind: "dependency",
    value,
    unit: "dependency_index",
    method: "intelligence-refresh.dependency-text.v1",
    attrs: { source: EVIDENCE_TEXT_SOURCE, signal, dependency_kind: dependencyKind }
  };
}

function dedupeStrengthDrafts(drafts: readonly EdgeStrengthDraft[]): EdgeStrengthDraft[] {
  const byKind = new Map<EdgeStrengthKind, EdgeStrengthDraft>();
  for (const draft of drafts) {
    if (!byKind.has(draft.strength_kind)) byKind.set(draft.strength_kind, draft);
  }
  return [...byKind.values()];
}

function mentionsCounterparty(text: string, objectName: string): boolean {
  const textTokens = normalizeForMention(text);
  const objectTokens = normalizeForMention(objectName);
  if (objectTokens.length === 0) return false;
  return textTokens.includes(objectTokens);
}

function normalizeForMention(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\b(?:inc|incorporated|corp|corporation|co|company|ltd|limited|plc)\b\.?/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function normalizeWhitespace(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}
