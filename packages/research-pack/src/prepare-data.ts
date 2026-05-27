import { buildEdgeClaimsFromCurrentEdgesTransactionally } from "@supplystrata/claim-builder";
import type { DatabaseStore } from "@supplystrata/db/write";
import {
  listRefreshableComponentRiskComponentIds,
  materializeRootResearchUnknowns,
  refreshComponentRiskView,
  refreshEdgeIntelligenceContext,
  type ComponentRiskRefreshSummary,
  type EdgeIntelligenceRefreshSummary,
  type MaterializeRootResearchUnknownsSummary
} from "@supplystrata/evidence-maintenance";
import type {
  ResearchPackClaimBuild,
  ResearchPackComponentRiskRefresh,
  ResearchPackComponentRiskRefreshComponent,
  ResearchPackInput,
  ResearchPackWriteSteps
} from "./definitions.js";

export function resolveResearchPackWriteSteps(
  input: Pick<ResearchPackInput, "buildClaims" | "refreshIntelligence" | "refreshComponentRisk" | "materializeRootUnknowns">
): ResearchPackWriteSteps {
  return {
    buildClaims: input.buildClaims === true,
    refreshIntelligence: input.refreshIntelligence === true,
    refreshComponentRisk: input.refreshComponentRisk === true,
    materializeRootUnknowns: input.materializeRootUnknowns === true
  };
}

export async function maybeBuildClaims(
  client: DatabaseStore,
  writeSteps: ResearchPackWriteSteps,
  input: ResearchPackInput
): Promise<ResearchPackClaimBuild | null> {
  if (!writeSteps.buildClaims) return null;
  const summary = await buildEdgeClaimsFromCurrentEdgesTransactionally(client, {
    min_evidence_level: input.minEvidenceLevel ?? 4,
    limit: 1_000,
    generated_by: input.generatedBy ?? "research-pack.claim-build.v1"
  });
  return {
    scanned: summary.scanned,
    inserted: summary.inserted,
    updated: summary.updated,
    generated_by: summary.generated_by
  };
}

export async function maybeRefreshIntelligence(
  client: DatabaseStore,
  writeSteps: ResearchPackWriteSteps,
  input: ResearchPackInput,
  computedAt: string
): Promise<EdgeIntelligenceRefreshSummary | null> {
  if (!writeSteps.refreshIntelligence) return null;
  return client.transaction((tx) =>
    refreshEdgeIntelligenceContext(tx, {
      min_evidence_level: input.minEvidenceLevel ?? 4,
      limit: input.intelligenceLimit ?? 1000,
      computed_at: computedAt,
      generated_by: input.generatedBy ?? "research-pack.intelligence-refresh.v1"
    })
  );
}

export async function maybeRefreshComponentRiskViews(
  client: DatabaseStore,
  writeSteps: ResearchPackWriteSteps,
  input: ResearchPackInput,
  componentIds: readonly string[],
  visibleEdges: readonly { component_id: string | null }[],
  computedAt: string
): Promise<ResearchPackComponentRiskRefresh | null> {
  if (!writeSteps.refreshComponentRisk) return null;
  const generatedBy = input.generatedBy ?? "research-pack.component-risk-refresh.v1";
  const visibleEdgeCountsByComponentId = countVisibleEdgesByComponentId(visibleEdges);
  const refreshableComponentIds = await listRefreshableComponentRiskComponentIds(client.read, componentIds);
  const components = await client.transaction(async (tx) => {
    const summaries: ResearchPackComponentRiskRefreshComponent[] = [];
    for (const componentId of refreshableComponentIds) {
      const summary = await refreshComponentRiskView(tx, {
        component_id: componentId,
        computed_at: computedAt,
        generated_by: generatedBy
      });
      summaries.push(decorateComponentRiskRefreshSummary(summary, visibleEdgeCountsByComponentId));
    }
    return summaries;
  });
  return summarizeComponentRiskRefresh({
    componentIds,
    refreshableComponentIds,
    components,
    generatedBy
  });
}

export function summarizeComponentRiskRefresh(input: {
  componentIds: readonly string[];
  refreshableComponentIds: readonly string[];
  components: readonly ResearchPackComponentRiskRefreshComponent[];
  generatedBy: string;
}): ResearchPackComponentRiskRefresh {
  return {
    scope_kind: "component_global",
    interpretation:
      "Component risk is refreshed at component-global scope. research_pack_visible_edge_count shows how many current pack fact edges support that component for the selected company.",
    components_considered: input.componentIds.length,
    components_eligible: input.refreshableComponentIds.length,
    risk_views_refreshed: input.components.length,
    metrics_written: input.components.reduce((count, component) => count + component.metrics, 0),
    edge_count: input.components.reduce((count, component) => count + component.edge_count, 0),
    research_pack_visible_edge_count: input.components.reduce((count, component) => count + component.research_pack_visible_edge_count, 0),
    supplier_count: input.components.reduce((count, component) => count + component.supplier_count, 0),
    share_unknown_count: input.components.filter((component) => component.share_unknown).length,
    risk_changes_recorded: input.components.reduce((count, component) => count + component.risk_changes_recorded, 0),
    generated_by: input.generatedBy,
    components: [...input.components]
  };
}

export function decorateComponentRiskRefreshSummary(
  summary: ComponentRiskRefreshSummary,
  visibleEdgeCountsByComponentId: ReadonlyMap<string, number>
): ResearchPackComponentRiskRefreshComponent {
  return {
    ...summary,
    scope_kind: "component_global",
    research_pack_visible_edge_count: visibleEdgeCountsByComponentId.get(summary.component_id) ?? 0
  };
}

function countVisibleEdgesByComponentId(visibleEdges: readonly { component_id: string | null }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const edge of visibleEdges) {
    if (edge.component_id === null) continue;
    counts.set(edge.component_id, (counts.get(edge.component_id) ?? 0) + 1);
  }
  return counts;
}

export async function maybeMaterializeRootUnknowns(
  client: DatabaseStore,
  writeSteps: ResearchPackWriteSteps,
  input: ResearchPackInput,
  companyId: string
): Promise<MaterializeRootResearchUnknownsSummary | null> {
  if (!writeSteps.materializeRootUnknowns) return null;
  return client.transaction((tx) =>
    materializeRootResearchUnknowns(tx, {
      company_ids: [companyId],
      min_evidence_level: input.minEvidenceLevel ?? 4,
      generated_by: input.generatedBy ?? "research-pack.root-unknown-materialization.v1"
    })
  );
}
