import { loadChainCard, loadCompanyCard, loadComponentCard } from "@supplystrata/card-builder";
import { runDataQualityChecks } from "@supplystrata/data-quality";
import type { DbClient } from "@supplystrata/db/read";
import type { DatabaseStore } from "@supplystrata/db/write";
import type { ComponentCardModel } from "@supplystrata/render";
import { planSourcesForComponents } from "@supplystrata/source-plan";
import { buildWorkbenchModel, type WorkbenchModel } from "@supplystrata/workbench-export";
import { buildCorroborationSourcePlan } from "./corroboration-source-plan.js";
import { buildGate1RunLedger } from "./gate1-run-ledger.js";
import { buildInvestigationBacklog } from "./investigation-backlog.js";
import { emptyStaticDataQualitySummary, manifestFromModel } from "./manifest.js";
import { buildObservationCoverageReport } from "./observation-coverage.js";
import {
  buildOfficialDisclosureReadinessReport,
  type OfficialDisclosureReadinessProfile,
  type OfficialDisclosureReadinessTargetNode
} from "./official-disclosure-readiness.js";
import { buildQuestionReadinessMatrix } from "./question-readiness.js";
import { selectResearchTargetProfile, type ResearchTargetProfile, type ResearchTargetProfileSelection } from "./research-target-profile.js";
import { maybeBuildClaims, maybeRefreshComponentRiskViews, maybeRefreshIntelligence, resolveResearchPackWriteSteps } from "./prepare-data.js";
import { buildExpectedSourceTargetCoverageReport, buildSourceTargetCoverageReport } from "./source-target-coverage.js";
import { buildSupplyChainExpansionPlan } from "./supply-chain-expansion-plan.js";
export type * from "./definitions.js";
import type { ResearchPackInput, ResearchPackModel, WorkbenchSnapshotPackInput, WorkbenchSnapshotPackModel } from "./definitions.js";

export * from "./investigation-backlog.js";
export * from "./corroboration-source-plan.js";
export * from "./gate1-run-ledger.js";
export { renderGate1RunLedgerMarkdown } from "./gate1-run-ledger-render.js";
export * from "./observation-coverage.js";
export * from "./official-disclosure-readiness.js";
export * from "./official-disclosure-signal-correlation.js";
export * from "./question-readiness.js";
export * from "./research-target-profile.js";
export * from "./source-target-coverage.js";
export * from "./source-target-preflight.js";
export * from "./supply-chain-expansion-plan.js";
export { resolveResearchPackWriteSteps } from "./prepare-data.js";
export { safeFileSegment, writeResearchPack, writeWorkbenchSnapshotPack } from "./writer.js";

export async function buildResearchPack(client: DatabaseStore, input: ResearchPackInput): Promise<ResearchPackModel> {
  const generatedAt = input.generatedAt;
  const depth = input.depth ?? 3;
  const writeSteps = resolveResearchPackWriteSteps(input);
  const claimBuild = await maybeBuildClaims(client, writeSteps, input);
  const intelligenceRefresh = await maybeRefreshIntelligence(client, writeSteps, input, generatedAt);
  const workbench = await buildWorkbenchModel(client.read, {
    company: input.company,
    depth,
    generatedAt,
    ...(input.since === undefined ? {} : { since: input.since }),
    ...(input.changeLimit === undefined ? {} : { changeLimit: input.changeLimit }),
    ...(input.sourceLimit === undefined ? {} : { sourceLimit: input.sourceLimit })
  });
  const components = collectResearchComponentIds(workbench, input.components ?? []);
  const targetProfileSelection = selectResearchTargetProfile({
    ...(input.researchTargetProfileId === undefined ? {} : { profile_id: input.researchTargetProfileId }),
    company_id: workbench.selected_company_id,
    component_ids: components
  });
  const officialDisclosureTargetNodes = resolveOfficialDisclosureTargetNodes(input.officialDisclosureTargetNodes, targetProfileSelection.profile);
  const sourcePlan =
    components.length === 0 && officialDisclosureTargetNodes.length === 0
      ? []
      : planSourcesForComponents(sourcePlanInput(input, components, depth, officialDisclosureTargetNodes));
  const sourceTargetCoverage = await buildSourceTargetCoverageReport({
    client: client.read,
    generated_at: generatedAt,
    company_id: workbench.selected_company_id,
    source_plan: sourcePlan,
    ...(input.sourceTargetNamespace === undefined ? {} : { namespace: input.sourceTargetNamespace })
  });
  const componentRiskRefresh = await maybeRefreshComponentRiskViews(client, writeSteps, input, components, generatedAt);
  const [company, chain, componentCards, dataQuality] = await Promise.all([
    loadCompanyCard(client.read, workbench.selected_company_id, { computedAt: generatedAt }),
    loadChainCard(client.read, workbench.selected_company_id, { depth }),
    loadComponentCards(client.read, components, generatedAt),
    runDataQualityChecks(client.read, {
      checkedAt: generatedAt,
      entity_unknown_map_targets: [{ scope_id: workbench.selected_company_id, minimum_open_items: 1 }]
    })
  ]);
  const questionReadiness = buildQuestionReadinessMatrix({
    generated_at: generatedAt,
    company_id: workbench.selected_company_id,
    workbench,
    company,
    components: componentCards,
    source_plan: sourcePlan,
    data_quality: dataQuality
  });
  const observationCoverage = buildObservationCoverageReport({
    generated_at: generatedAt,
    company_id: workbench.selected_company_id,
    workbench,
    company,
    components: componentCards
  });
  const officialDisclosureReadiness = buildOfficialDisclosureReadinessReport({
    generated_at: generatedAt,
    company_id: workbench.selected_company_id,
    workbench,
    component_ids: components,
    ...(officialDisclosureTargetNodes.length === 0 ? {} : { target_nodes: officialDisclosureTargetNodes }),
    ...(targetProfileSelection.profile === null ? {} : { target_profile: officialReadinessProfile(targetProfileSelection) }),
    source_plan: sourcePlan,
    source_target_coverage: sourceTargetCoverage
  });
  const supplyChainExpansionPlan = buildSupplyChainExpansionPlan({
    generated_at: generatedAt,
    company_id: workbench.selected_company_id,
    workbench,
    component_ids: components,
    source_plan: sourcePlan,
    official_disclosure_readiness: officialDisclosureReadiness,
    max_depth: input.supplyChainExpansionMaxDepth ?? 7
  });
  const sourceTargetPreflight = input.sourceTargetPreflight ?? null;
  const investigationBacklog = buildInvestigationBacklog({
    generated_at: generatedAt,
    company_id: workbench.selected_company_id,
    workbench,
    components: componentCards,
    source_plan: sourcePlan,
    question_readiness: questionReadiness,
    observation_coverage: observationCoverage,
    official_disclosure_readiness: officialDisclosureReadiness,
    supply_chain_expansion_plan: supplyChainExpansionPlan,
    source_target_coverage: sourceTargetCoverage,
    ...(sourceTargetPreflight === null ? {} : { source_target_preflight: sourceTargetPreflight })
  });
  const corroborationSourcePlan = buildCorroborationSourcePlan({
    generated_at: generatedAt,
    company_id: workbench.selected_company_id,
    source_plan: sourcePlan,
    investigation_backlog: investigationBacklog
  });
  const manifest = manifestFromModel({
    generatedAt,
    input,
    depth,
    workbench,
    components,
    sourcePlan,
    sourceTargetCoverage,
    sourceTargetPreflight,
    dataQuality,
    questionReadiness,
    investigationBacklog,
    corroborationSourcePlan,
    observationCoverage,
    officialDisclosureReadiness,
    supplyChainExpansionPlan,
    claimBuild,
    intelligenceRefresh,
    componentRiskRefresh,
    targetProfileSelection
  });
  return {
    manifest,
    workbench,
    company,
    chain,
    components: componentCards,
    source_plan: sourcePlan,
    data_quality: dataQuality,
    question_readiness: questionReadiness,
    investigation_backlog: investigationBacklog,
    corroboration_source_plan: corroborationSourcePlan,
    source_target_coverage: sourceTargetCoverage,
    source_target_preflight: sourceTargetPreflight,
    observation_coverage: observationCoverage,
    official_disclosure_readiness: officialDisclosureReadiness,
    supply_chain_expansion_plan: supplyChainExpansionPlan,
    gate1_run_ledger: buildGate1RunLedger({
      generated_at: generatedAt,
      company_id: workbench.selected_company_id,
      research_input: input,
      official_disclosure_readiness: officialDisclosureReadiness,
      corroboration_source_plan: corroborationSourcePlan,
      supply_chain_expansion_plan: supplyChainExpansionPlan,
      source_target_coverage: sourceTargetCoverage,
      source_target_preflight: sourceTargetPreflight
    })
  };
}

export function buildResearchPackFromWorkbench(input: WorkbenchSnapshotPackInput): WorkbenchSnapshotPackModel {
  const depth = input.depth ?? input.workbench.chain.max_depth;
  const components = collectResearchComponentIds(input.workbench, input.components ?? []);
  const targetProfileSelection = selectResearchTargetProfile({
    ...(input.researchTargetProfileId === undefined ? {} : { profile_id: input.researchTargetProfileId }),
    company_id: input.workbench.selected_company_id,
    component_ids: components
  });
  const officialDisclosureTargetNodes = resolveOfficialDisclosureTargetNodes(input.officialDisclosureTargetNodes, targetProfileSelection.profile);
  const sourcePlan =
    components.length === 0 && officialDisclosureTargetNodes.length === 0
      ? input.workbench.source_plan
      : planSourcesForComponents(sourcePlanInput(input, components, depth, officialDisclosureTargetNodes));
  const generatedAt = input.generatedAt ?? input.workbench.generated_at;
  const dataQuality = emptyStaticDataQualitySummary(generatedAt);
  const staticInput: ResearchPackInput = {
    company: input.workbench.selected_company_id,
    components,
    depth,
    generatedAt,
    ...(input.tradeObservationMonth === undefined
      ? {}
      : {
          tradeObservationMonth: input.tradeObservationMonth,
          ...(input.tradeObservationCountryCode === undefined ? {} : { tradeObservationCountryCode: input.tradeObservationCountryCode }),
          ...(input.tradeObservationDirections === undefined ? {} : { tradeObservationDirections: input.tradeObservationDirections })
        }),
    ...(input.officialDisclosureYear === undefined ? {} : { officialDisclosureYear: input.officialDisclosureYear }),
    ...(input.researchTargetProfileId === undefined ? {} : { researchTargetProfileId: input.researchTargetProfileId }),
    ...(input.officialDisclosureTargetNodes === undefined ? {} : { officialDisclosureTargetNodes: input.officialDisclosureTargetNodes }),
    ...(input.materialObservationYear === undefined ? {} : { materialObservationYear: input.materialObservationYear }),
    ...(input.commodityObservationMonth === undefined ? {} : { commodityObservationMonth: input.commodityObservationMonth }),
    ...(input.sourceTargetNamespace === undefined ? {} : { sourceTargetNamespace: input.sourceTargetNamespace }),
    ...(input.supplyChainExpansionMaxDepth === undefined ? {} : { supplyChainExpansionMaxDepth: input.supplyChainExpansionMaxDepth })
  };
  const sourceTargetCoverage = buildExpectedSourceTargetCoverageReport({
    generated_at: generatedAt,
    company_id: input.workbench.selected_company_id,
    source_plan: sourcePlan,
    ...(input.sourceTargetNamespace === undefined ? {} : { namespace: input.sourceTargetNamespace })
  });
  const sourceTargetPreflight = input.sourceTargetPreflight ?? null;
  const questionReadiness = buildQuestionReadinessMatrix({
    generated_at: generatedAt,
    company_id: input.workbench.selected_company_id,
    workbench: input.workbench,
    company: null,
    components: [],
    source_plan: sourcePlan,
    data_quality: null
  });
  const observationCoverage = buildObservationCoverageReport({
    generated_at: generatedAt,
    company_id: input.workbench.selected_company_id,
    workbench: input.workbench,
    company: null,
    components: []
  });
  const officialDisclosureReadiness = buildOfficialDisclosureReadinessReport({
    generated_at: generatedAt,
    company_id: input.workbench.selected_company_id,
    workbench: input.workbench,
    component_ids: components,
    ...(officialDisclosureTargetNodes.length === 0 ? {} : { target_nodes: officialDisclosureTargetNodes }),
    ...(targetProfileSelection.profile === null ? {} : { target_profile: officialReadinessProfile(targetProfileSelection) }),
    source_plan: sourcePlan,
    source_target_coverage: sourceTargetCoverage
  });
  const supplyChainExpansionPlan = buildSupplyChainExpansionPlan({
    generated_at: generatedAt,
    company_id: input.workbench.selected_company_id,
    workbench: input.workbench,
    component_ids: components,
    source_plan: sourcePlan,
    official_disclosure_readiness: officialDisclosureReadiness,
    max_depth: input.supplyChainExpansionMaxDepth ?? 7
  });
  const investigationBacklog = buildInvestigationBacklog({
    generated_at: generatedAt,
    company_id: input.workbench.selected_company_id,
    workbench: input.workbench,
    components: [],
    source_plan: sourcePlan,
    question_readiness: questionReadiness,
    observation_coverage: observationCoverage,
    official_disclosure_readiness: officialDisclosureReadiness,
    supply_chain_expansion_plan: supplyChainExpansionPlan,
    source_target_coverage: sourceTargetCoverage,
    ...(sourceTargetPreflight === null ? {} : { source_target_preflight: sourceTargetPreflight })
  });
  const corroborationSourcePlan = buildCorroborationSourcePlan({
    generated_at: generatedAt,
    company_id: input.workbench.selected_company_id,
    source_plan: sourcePlan,
    investigation_backlog: investigationBacklog
  });
  const manifest = manifestFromModel({
    generatedAt,
    input: staticInput,
    depth,
    workbench: input.workbench,
    components,
    sourcePlan,
    sourceTargetCoverage,
    sourceTargetPreflight,
    dataQuality,
    questionReadiness,
    investigationBacklog,
    corroborationSourcePlan,
    observationCoverage,
    officialDisclosureReadiness,
    supplyChainExpansionPlan,
    claimBuild: null,
    intelligenceRefresh: null,
    componentRiskRefresh: null,
    targetProfileSelection,
    mode: "workbench_snapshot"
  });
  return {
    manifest,
    workbench: input.workbench,
    chain: input.workbench.chain,
    source_plan: sourcePlan,
    question_readiness: questionReadiness,
    investigation_backlog: investigationBacklog,
    corroboration_source_plan: corroborationSourcePlan,
    source_target_coverage: sourceTargetCoverage,
    source_target_preflight: sourceTargetPreflight,
    observation_coverage: observationCoverage,
    official_disclosure_readiness: officialDisclosureReadiness,
    supply_chain_expansion_plan: supplyChainExpansionPlan,
    gate1_run_ledger: buildGate1RunLedger({
      generated_at: generatedAt,
      company_id: input.workbench.selected_company_id,
      research_input: staticInput,
      official_disclosure_readiness: officialDisclosureReadiness,
      corroboration_source_plan: corroborationSourcePlan,
      supply_chain_expansion_plan: supplyChainExpansionPlan,
      source_target_coverage: sourceTargetCoverage,
      source_target_preflight: sourceTargetPreflight
    })
  };
}

export function collectResearchComponentIds(workbench: Pick<WorkbenchModel, "chain_segments">, explicitComponents: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const component of explicitComponents) {
    const normalized = normalizeId(component);
    if (normalized.length > 0) ids.add(normalized);
  }
  for (const segment of workbench.chain_segments) {
    if (segment.component_id !== null) ids.add(segment.component_id);
  }
  return [...ids].sort();
}

async function loadComponentCards(client: DbClient, componentIds: readonly string[], computedAt: string): Promise<ComponentCardModel[]> {
  const cards: ComponentCardModel[] = [];
  for (const componentId of componentIds) {
    cards.push(await loadComponentCard(client, componentId, { computedAt }));
  }
  return cards;
}

function sourcePlanInput(
  input: Pick<
    ResearchPackInput,
    | "tradeObservationMonth"
    | "tradeObservationCountryCode"
    | "tradeObservationDirections"
    | "officialDisclosureYear"
    | "materialObservationYear"
    | "commodityObservationMonth"
  >,
  componentIds: readonly string[],
  depth: number,
  officialDisclosureTargetNodes: readonly OfficialDisclosureReadinessTargetNode[]
): Parameters<typeof planSourcesForComponents>[0] {
  return {
    component_ids: componentIds,
    entity_ids: [],
    officialDisclosureTargetNodes,
    maxTierDepth: depth,
    ...(input.tradeObservationMonth === undefined
      ? {}
      : {
          tradeObservationMonth: input.tradeObservationMonth,
          ...(input.tradeObservationCountryCode === undefined ? {} : { tradeObservationCountryCode: input.tradeObservationCountryCode }),
          ...(input.tradeObservationDirections === undefined ? {} : { tradeObservationDirections: input.tradeObservationDirections })
        }),
    ...(input.officialDisclosureYear === undefined ? {} : { officialDisclosureYear: input.officialDisclosureYear }),
    ...(input.materialObservationYear === undefined ? {} : { materialObservationYear: input.materialObservationYear }),
    ...(input.commodityObservationMonth === undefined ? {} : { commodityObservationMonth: input.commodityObservationMonth })
  };
}

function resolveOfficialDisclosureTargetNodes(
  explicitTargetNodes: readonly OfficialDisclosureReadinessTargetNode[] | undefined,
  profile: ResearchTargetProfile | null
): readonly OfficialDisclosureReadinessTargetNode[] {
  if (explicitTargetNodes !== undefined) return explicitTargetNodes;
  return profile?.target_nodes ?? [];
}

function officialReadinessProfile(selection: ResearchTargetProfileSelection): OfficialDisclosureReadinessProfile {
  if (selection.profile === null) throw new Error("Cannot build official readiness profile without a selected profile");
  return {
    profile_id: selection.profile.profile_id,
    title: selection.profile.title,
    version: selection.profile.version,
    description: selection.profile.description,
    selection_reason: selection.reason
  };
}

function normalizeId(value: string): string {
  return value.trim();
}
