import type { Gate1DataDepthCommandHint, Gate1DataDepthRankingContext, Gate1DataDepthWorkbenchItem } from "./gate1-data-depth-workbench-definitions.js";

const REVIEW_POLICY = "review_only_no_fact_mutation";

export function workItem(
  input: Omit<Gate1DataDepthWorkbenchItem, "review_policy" | "automatic_fact_mutation_allowed" | "ranking_contexts"> & {
    ranking_contexts?: Gate1DataDepthRankingContext[];
  }
): Gate1DataDepthWorkbenchItem {
  return {
    ...input,
    refs: uniqueSorted(input.refs).slice(0, 40),
    edge_ids: uniqueSorted(input.edge_ids).slice(0, 40),
    component_ids: uniqueSorted(input.component_ids).slice(0, 40),
    source_adapters: uniqueSorted(input.source_adapters).slice(0, 20),
    source_targets: input.source_targets.slice(0, 40),
    allowed_decisions: uniquePreserveOrder(input.allowed_decisions),
    command_hints: input.command_hints.slice(0, 12),
    ranking_contexts: (input.ranking_contexts ?? []).slice(0, 4),
    review_policy: REVIEW_POLICY,
    automatic_fact_mutation_allowed: false
  };
}

export function commandHint(label: string, command: string, writesTruthStore: boolean, requiresDatabase: boolean): Gate1DataDepthCommandHint {
  return { label, command, writes_truth_store: writesTruthStore, requires_database: requiresDatabase };
}

export function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function uniquePreserveOrder<TValue extends string>(values: readonly TValue[]): TValue[] {
  return [...new Set(values)];
}

export function nonEmpty(value: string | null): value is string {
  return value !== null && value.length > 0;
}

export function prefixedRef(prefix: string, value: string): string {
  return value.startsWith(`${prefix}:`) ? value : `${prefix}:${value}`;
}
