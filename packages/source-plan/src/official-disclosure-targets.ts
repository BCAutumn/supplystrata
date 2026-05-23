import type { OfficialDisclosureContext, SourcePlanCheckTargetSuggestion, SourcePlanDraft, SourcePlanOfficialDisclosureTargetNode } from "./definitions.js";

interface OfficialDisclosureConnectorTarget {
  readonly sourceId: string;
  readonly entityId: string;
}

const OFFICIAL_DISCLOSURE_CONNECTOR_TARGETS: readonly OfficialDisclosureConnectorTarget[] = [
  { sourceId: "tsmc-ir", entityId: "ENT-TSMC" },
  { sourceId: "samsung-ir", entityId: "ENT-SAMSUNG-ELECTRONICS" },
  { sourceId: "skhynix-ir", entityId: "ENT-SKHYNIX" },
  { sourceId: "micron-ir", entityId: "ENT-MICRON" },
  { sourceId: "asml-ir", entityId: "ENT-ASML" }
];

export function officialDisclosureSourceIdsForNode(node: SourcePlanOfficialDisclosureTargetNode): string[] {
  return uniqueSorted([...(node.expected_source_ids ?? []), ...(node.expected_source_targets ?? []).map((target) => target.source_id)]);
}

export function officialDisclosureTargetReason(node: SourcePlanOfficialDisclosureTargetNode, sourceId: string): string {
  const name = node.name === undefined ? node.node_id : `${node.name} [${node.node_id}]`;
  return `${name}: target profile expects ${sourceId} official disclosure coverage; planning does not create fact edges.`;
}

export function buildOfficialDisclosureCheckTargetSuggestions(input: {
  readonly sourceId: string;
  readonly drafts: readonly SourcePlanDraft[];
  readonly targetNodes: readonly SourcePlanOfficialDisclosureTargetNode[];
  readonly officialDisclosure?: OfficialDisclosureContext;
}): SourcePlanCheckTargetSuggestion[] {
  const suggestions = explicitOfficialDisclosureSuggestionsForTargetNodes(input.sourceId, input.drafts, input.targetNodes, input.officialDisclosure);
  if (input.officialDisclosure === undefined) return suggestions;
  suggestions.push(...periodicOfficialDisclosureSuggestionsForTargetNodes(input.sourceId, input.drafts, input.officialDisclosure, input.targetNodes));
  const sourceSuggestion = officialDisclosureSuggestionForSource(input.sourceId, input.officialDisclosure);
  if (sourceSuggestion !== undefined) suggestions.push(sourceSuggestion);
  return suggestions;
}

function explicitOfficialDisclosureSuggestionsForTargetNodes(
  sourceId: string,
  drafts: readonly SourcePlanDraft[],
  targetNodes: readonly SourcePlanOfficialDisclosureTargetNode[],
  officialDisclosure: OfficialDisclosureContext | undefined
): SourcePlanCheckTargetSuggestion[] {
  const targetIds = new Set(drafts.map((draft) => draft.targetId));
  const suggestions: SourcePlanCheckTargetSuggestion[] = [];
  for (const node of targetNodes) {
    if (!targetIds.has(node.node_id)) continue;
    const explicitTarget = node.expected_source_targets?.find((target) => target.source_id === sourceId);
    if (explicitTarget === undefined) continue;
    const targetConfig = explicitOfficialDisclosureTargetConfig(explicitTarget.target_config, officialDisclosure);
    if (targetConfig === undefined) continue;
    suggestions.push({
      source_adapter_id: sourceId,
      target_kind: explicitTarget.target_kind,
      runnable: true,
      target_config: targetConfig,
      reason: explicitTarget.reason ?? `${node.node_id} has explicit ${sourceId} target config from the research target profile.`
    });
  }
  return suggestions;
}

function explicitOfficialDisclosureTargetConfig(
  config: Record<string, string | number | boolean | string[]>,
  officialDisclosure: OfficialDisclosureContext | undefined
): Record<string, string | number | boolean | string[]> | undefined {
  const cloned = cloneTargetConfig(config);
  const hasAnnualYearTemplate = Object.hasOwn(cloned, "year");
  const hasAnnualDateTemplate = Object.hasOwn(cloned, "date");
  if (!hasAnnualYearTemplate && !hasAnnualDateTemplate) return cloned;
  // 带 year/date 的 profile target 是年度模板；没有显式年份时不能伪装成可运行任务。
  if (officialDisclosure === undefined) return undefined;
  if (hasAnnualYearTemplate) cloned["year"] = Number.parseInt(officialDisclosure.year, 10);
  if (hasAnnualDateTemplate) {
    const dateTemplate = cloned["date"];
    if (typeof dateTemplate !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dateTemplate)) {
      throw new Error("Official disclosure target date template must use YYYY-MM-DD format.");
    }
    cloned["date"] = `${officialDisclosure.year}${dateTemplate.slice(4)}`;
  }
  return cloned;
}

function periodicOfficialDisclosureSuggestionsForTargetNodes(
  sourceId: string,
  drafts: readonly SourcePlanDraft[],
  context: OfficialDisclosureContext,
  targetNodes: readonly SourcePlanOfficialDisclosureTargetNode[]
): SourcePlanCheckTargetSuggestion[] {
  const targetIds = new Set(drafts.map((draft) => draft.targetId));
  const suggestions: SourcePlanCheckTargetSuggestion[] = [];
  for (const node of targetNodes) {
    if (!targetIds.has(node.node_id)) continue;
    if (!officialDisclosureSourceIdsForNode(node).includes(sourceId)) continue;
    if (node.expected_source_targets?.some((target) => target.source_id === sourceId) === true) continue;
    const suggestion = officialDisclosureSuggestionForTargetNodeSource(sourceId, node, context);
    if (suggestion !== undefined) suggestions.push(suggestion);
  }
  return suggestions;
}

function officialDisclosureSuggestionForTargetNodeSource(
  sourceId: string,
  node: SourcePlanOfficialDisclosureTargetNode,
  context: OfficialDisclosureContext
): SourcePlanCheckTargetSuggestion | undefined {
  const entityId = officialDisclosureEntityId(sourceId);
  if (entityId === undefined) return undefined;
  return {
    source_adapter_id: sourceId,
    target_kind: "official-html-disclosure",
    runnable: true,
    target_config: {
      entity_id: entityId,
      year: Number.parseInt(context.year, 10)
    },
    reason: `${node.node_id} expects ${sourceId}; ${sourceId} has a registered official disclosure connector for ${context.year}. Outputs remain observation/review context until evidence is reviewed.`
  };
}

function officialDisclosureSuggestionForSource(sourceId: string, context: OfficialDisclosureContext): SourcePlanCheckTargetSuggestion | undefined {
  const entityId = officialDisclosureEntityId(sourceId);
  if (entityId === undefined) return undefined;
  return {
    source_adapter_id: sourceId,
    target_kind: "official-html-disclosure",
    runnable: true,
    target_config: {
      entity_id: entityId,
      year: Number.parseInt(context.year, 10)
    },
    reason: `${sourceId} has a registered official disclosure connector for ${context.year}; output must remain observation/review context until evidence is reviewed.`
  };
}

function officialDisclosureEntityId(sourceId: string): string | undefined {
  return OFFICIAL_DISCLOSURE_CONNECTOR_TARGETS.find((target) => target.sourceId === sourceId)?.entityId;
}

function cloneTargetConfig(config: Record<string, string | number | boolean | string[]>): Record<string, string | number | boolean | string[]> {
  const cloned: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(config)) cloned[key] = Array.isArray(value) ? [...value] : value;
  return cloned;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
