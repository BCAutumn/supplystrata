import type { EntityUnknownMapTarget } from "@supplystrata/data-quality";

export interface ResearchPackUnknownMapTargetContext {
  selected_company_id: string;
  root_unknown_materialization?: RootUnknownCoverageSummaryForDataQuality | null;
  edges: readonly {
    from_id: string;
    to_id: string;
    evidence_level: number;
  }[];
}

export interface RootUnknownCoverageSummaryForDataQuality {
  companies_with_l4_l5_edges: number;
}

export function researchPackUnknownMapTargets(input: ResearchPackUnknownMapTargetContext): EntityUnknownMapTarget[] {
  // 与 root unknown 物化规则保持一致：已有 L4/L5 事实边时，不再要求 company-level root unknown。
  if ((input.root_unknown_materialization?.companies_with_l4_l5_edges ?? 0) > 0) return [];
  if (hasSelectedCompanyL4L5FactEdge(input)) return [];
  return [{ scope_id: input.selected_company_id, minimum_open_items: 1 }];
}

function hasSelectedCompanyL4L5FactEdge(input: ResearchPackUnknownMapTargetContext): boolean {
  return input.edges.some((edge) => edge.evidence_level >= 4 && (edge.from_id === input.selected_company_id || edge.to_id === input.selected_company_id));
}
