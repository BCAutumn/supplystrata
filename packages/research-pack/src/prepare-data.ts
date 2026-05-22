import { buildEdgeClaimsFromCurrentEdgesTransactionally } from "@supplystrata/claim-builder";
import type { DatabaseStore } from "@supplystrata/db/write";
import {
  listRefreshableComponentRiskComponentIds,
  refreshComponentRiskView,
  refreshEdgeIntelligenceContext,
  type ComponentRiskRefreshSummary,
  type EdgeIntelligenceRefreshSummary
} from "@supplystrata/evidence-maintenance";
import type { ResearchPackClaimBuild, ResearchPackComponentRiskRefresh, ResearchPackInput, ResearchPackWriteSteps } from "./definitions.js";

export function resolveResearchPackWriteSteps(
  input: Pick<ResearchPackInput, "buildClaims" | "refreshIntelligence" | "refreshComponentRisk">
): ResearchPackWriteSteps {
  return {
    buildClaims: input.buildClaims === true,
    refreshIntelligence: input.refreshIntelligence === true,
    refreshComponentRisk: input.refreshComponentRisk === true
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
  input: ResearchPackInput
): Promise<EdgeIntelligenceRefreshSummary | null> {
  if (!writeSteps.refreshIntelligence) return null;
  return client.transaction((tx) =>
    refreshEdgeIntelligenceContext(tx, {
      min_evidence_level: input.minEvidenceLevel ?? 4,
      limit: input.intelligenceLimit ?? 1000,
      generated_by: input.generatedBy ?? "research-pack.intelligence-refresh.v1"
    })
  );
}

export async function maybeRefreshComponentRiskViews(
  client: DatabaseStore,
  writeSteps: ResearchPackWriteSteps,
  input: ResearchPackInput,
  componentIds: readonly string[],
  computedAt: string
): Promise<ResearchPackComponentRiskRefresh | null> {
  if (!writeSteps.refreshComponentRisk) return null;
  const generatedBy = input.generatedBy ?? "research-pack.component-risk-refresh.v1";
  const refreshableComponentIds = await listRefreshableComponentRiskComponentIds(client.read, componentIds);
  const components = await client.transaction(async (tx) => {
    const summaries: ComponentRiskRefreshSummary[] = [];
    for (const componentId of refreshableComponentIds) {
      summaries.push(
        await refreshComponentRiskView(tx, {
          component_id: componentId,
          computed_at: computedAt,
          generated_by: generatedBy
        })
      );
    }
    return summaries;
  });
  return {
    components_considered: componentIds.length,
    components_eligible: refreshableComponentIds.length,
    risk_views_refreshed: components.length,
    metrics_written: components.reduce((count, component) => count + component.metrics, 0),
    edge_count: components.reduce((count, component) => count + component.edge_count, 0),
    supplier_count: components.reduce((count, component) => count + component.supplier_count, 0),
    share_unknown_count: components.filter((component) => component.share_unknown).length,
    risk_changes_recorded: components.reduce((count, component) => count + component.risk_changes_recorded, 0),
    generated_by: generatedBy,
    components
  };
}
