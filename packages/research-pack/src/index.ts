import { loadChainCard, loadCompanyCard, loadComponentCard } from "@supplystrata/card-builder";
import { runDataQualityChecks } from "@supplystrata/data-quality";
import { listRankingCalibrationLabels, type DbClient, type RankingCalibrationLabelRecord } from "@supplystrata/db/read";
import type { DatabaseStore } from "@supplystrata/db/write";
import type { ComponentCardModel } from "@supplystrata/render";
import { planSourcesForComponents } from "@supplystrata/source-plan";
import { listEdgeCorroborationDispositions, type EdgeCorroborationDispositionRecord } from "@supplystrata/review-store";
import { buildWorkbenchModel, type WorkbenchModel } from "@supplystrata/workbench-export";
import { buildCorroborationSourcePlan } from "./corroboration-source-plan.js";
import { loadGate1AdjacentOfficialFacts } from "./gate1-adjacent-official-facts.js";
import { loadGate1EntityAffiliationContexts } from "./gate1-entity-affiliation-context.js";
import { buildGate1DataDepthWorkbench } from "./gate1-data-depth-workbench.js";
import { buildGate1RunLedger } from "./gate1-run-ledger.js";
import { buildInvestigationBacklog } from "./investigation-backlog.js";
import { emptyStaticDataQualitySummary, manifestFromModel } from "./manifest.js";
import { buildObservationCoverageReport } from "./observation-coverage.js";
import {
  buildOfficialDisclosureReadinessReport,
  type OfficialDisclosureReadinessProfile,
  type OfficialDisclosureReadinessTargetNode
} from "./official-disclosure-readiness.js";
import { buildPropagationReadinessReport } from "./propagation-readiness.js";
import { buildQuestionReadinessMatrix } from "./question-readiness.js";
import { selectResearchTargetProfile, type ResearchTargetProfile, type ResearchTargetProfileSelection } from "./research-target-profile.js";
import {
  maybeBuildClaims,
  maybeMaterializeRootUnknowns,
  maybeRefreshComponentRiskViews,
  maybeRefreshIntelligence,
  resolveResearchPackWriteSteps
} from "./prepare-data.js";
import { buildExpectedSourceTargetCoverageReport, buildSourceTargetCoverageReport } from "./source-target-coverage.js";
import { withSourcePlanWindowDefaults } from "./source-plan-windows.js";
import { buildSupplyChainExpansionPlan } from "./supply-chain-expansion-plan.js";
export type * from "./definitions.js";
import type { Gate1AdjacentOfficialFactsReport } from "./gate1-adjacent-official-facts.js";
import type { ResearchPackInput, ResearchPackModel, WorkbenchSnapshotPackInput, WorkbenchSnapshotPackModel } from "./definitions.js";

export * from "./investigation-backlog.js";
export * from "./corroboration-source-plan.js";
export * from "./gate1-adjacent-official-facts.js";
export * from "./gate1-entity-affiliation-context.js";
export * from "./gate1-data-depth-workbench.js";
export * from "./gate1-run-ledger.js";
export { renderGate1RunLedgerMarkdown } from "./gate1-run-ledger-render.js";
export * from "./observation-coverage.js";
export * from "./official-disclosure-readiness.js";
export * from "./official-disclosure-signal-correlation.js";
export * from "./ai-compute-propagation-readiness.js";
export * from "./propagation-readiness.js";
export * from "./question-readiness.js";
export * from "./research-target-profile.js";
export * from "./source-target-coverage.js";
export * from "./source-target-observation-review.js";
export * from "./source-target-preflight.js";
export * from "./supply-chain-expansion-plan.js";
export { resolveResearchPackWriteSteps } from "./prepare-data.js";
export { safeFileSegment, writeResearchPack, writeWorkbenchSnapshotPack } from "./writer.js";

export async function buildResearchPack(client: DatabaseStore, input: ResearchPackInput): Promise<ResearchPackModel> {
  const generatedAt = input.generatedAt;
  const sourcePlanInputWithDefaults = withSourcePlanWindowDefaults(input, generatedAt);
  const depth = input.depth ?? 3;
  const writeSteps = resolveResearchPackWriteSteps(input);
  const claimBuild = await maybeBuildClaims(client, writeSteps, input);
  const intelligenceRefresh = await maybeRefreshIntelligence(client, writeSteps, input, generatedAt);
  let workbench = await buildWorkbenchModel(client.read, {
    company: input.company,
    depth,
    generatedAt,
    ...(input.since === undefined ? {} : { since: input.since }),
    ...(input.changeLimit === undefined ? {} : { changeLimit: input.changeLimit }),
    ...(input.sourceLimit === undefined ? {} : { sourceLimit: input.sourceLimit })
  });
  const rootUnknownMaterialization = await maybeMaterializeRootUnknowns(client, writeSteps, input, workbench.selected_company_id);
  if (rootUnknownMaterialization !== null && (rootUnknownMaterialization.unknowns_inserted > 0 || rootUnknownMaterialization.unknowns_updated > 0)) {
    workbench = await buildWorkbenchModel(client.read, {
      company: input.company,
      depth,
      generatedAt,
      ...(input.since === undefined ? {} : { since: input.since }),
      ...(input.changeLimit === undefined ? {} : { changeLimit: input.changeLimit }),
      ...(input.sourceLimit === undefined ? {} : { sourceLimit: input.sourceLimit })
    });
  }
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
      : planSourcesForComponents(sourcePlanInput(sourcePlanInputWithDefaults, components, depth, officialDisclosureTargetNodes));
  const sourceTargetCoverage = await buildSourceTargetCoverageReport({
    client: client.read,
    generated_at: generatedAt,
    company_id: workbench.selected_company_id,
    source_plan: sourcePlan,
    ...(input.sourceTargetNamespace === undefined ? {} : { namespace: input.sourceTargetNamespace })
  });
  const edgeCorroborationDispositions = await listEdgeCorroborationDispositions(client.read, {
    edgeIds: workbench.edges.map((edge) => edge.edge_id),
    limit: 500
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
    source_target_coverage: sourceTargetCoverage,
    edge_corroboration_dispositions: edgeCorroborationDispositions.map(edgeCorroborationDispositionSummary)
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
  const propagationReadiness = buildPropagationReadinessReport({
    generated_at: generatedAt,
    company_id: workbench.selected_company_id,
    workbench,
    observation_coverage: observationCoverage,
    official_disclosure_readiness: officialDisclosureReadiness,
    source_plan: sourcePlan,
    source_target_coverage: sourceTargetCoverage,
    supply_chain_expansion_plan: supplyChainExpansionPlan
  });
  const entityAffiliationContexts = await loadGate1EntityAffiliationContexts(client.read, { workbench });
  const adjacentOfficialFacts = await loadGate1AdjacentOfficialFacts(client.read, {
    generated_at: generatedAt,
    company_id: workbench.selected_company_id,
    component_ids: components,
    visible_edge_ids: workbench.edges.map((edge) => edge.edge_id)
  });
  let gate1DataDepthWorkbench = buildGate1DataDepthWorkbench({
    generated_at: generatedAt,
    company_id: workbench.selected_company_id,
    research_context: gate1DataDepthResearchContext(input, sourcePlanInputWithDefaults),
    official_disclosure_readiness: officialDisclosureReadiness,
    source_target_coverage: sourceTargetCoverage,
    supply_chain_expansion_plan: supplyChainExpansionPlan,
    propagation_readiness: propagationReadiness,
    adjacent_official_facts: adjacentOfficialFacts,
    entity_affiliation_contexts: entityAffiliationContexts
  });
  const rankingContextIds = gate1DataDepthWorkbench.items.flatMap((item) => item.ranking_contexts.map((context) => context.context_id));
  if (rankingContextIds.length > 0) {
    const rankingCalibrationLabels = await listRankingCalibrationLabels(client.read, {
      ranking_context_ids: rankingContextIds,
      limit: Math.max(100, rankingContextIds.length * 10)
    });
    if (rankingCalibrationLabels.length > 0) {
      gate1DataDepthWorkbench = buildGate1DataDepthWorkbench({
        generated_at: generatedAt,
        company_id: workbench.selected_company_id,
        research_context: gate1DataDepthResearchContext(input, sourcePlanInputWithDefaults),
        official_disclosure_readiness: officialDisclosureReadiness,
        source_target_coverage: sourceTargetCoverage,
        supply_chain_expansion_plan: supplyChainExpansionPlan,
        propagation_readiness: propagationReadiness,
        adjacent_official_facts: adjacentOfficialFacts,
        entity_affiliation_contexts: entityAffiliationContexts,
        ranking_calibration_labels: rankingCalibrationLabels.map(toGate1RankingCalibrationLabel)
      });
    }
  }
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
    propagation_readiness: propagationReadiness,
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
    input: sourcePlanInputWithDefaults,
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
    propagationReadiness,
    gate1DataDepthWorkbench,
    claimBuild,
    intelligenceRefresh,
    componentRiskRefresh,
    rootUnknownMaterialization,
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
    propagation_readiness: propagationReadiness,
    gate1_data_depth_workbench: gate1DataDepthWorkbench,
    gate1_run_ledger: buildGate1RunLedger({
      generated_at: generatedAt,
      company_id: workbench.selected_company_id,
      research_input: sourcePlanInputWithDefaults,
      official_disclosure_readiness: officialDisclosureReadiness,
      corroboration_source_plan: corroborationSourcePlan,
      supply_chain_expansion_plan: supplyChainExpansionPlan,
      entity_affiliation_contexts: entityAffiliationContexts,
      source_target_coverage: sourceTargetCoverage,
      source_target_preflight: sourceTargetPreflight
    })
  };
}

export function buildResearchPackFromWorkbench(input: WorkbenchSnapshotPackInput): WorkbenchSnapshotPackModel {
  const depth = input.depth ?? input.workbench.chain.max_depth;
  const components = collectResearchComponentIds(input.workbench, input.components ?? []);
  const generatedAt = input.generatedAt ?? input.workbench.generated_at;
  const sourcePlanInputWithDefaults = withSourcePlanWindowDefaults(input, generatedAt);
  const targetProfileSelection = selectResearchTargetProfile({
    ...(input.researchTargetProfileId === undefined ? {} : { profile_id: input.researchTargetProfileId }),
    company_id: input.workbench.selected_company_id,
    component_ids: components
  });
  const officialDisclosureTargetNodes = resolveOfficialDisclosureTargetNodes(input.officialDisclosureTargetNodes, targetProfileSelection.profile);
  const sourcePlan =
    components.length === 0 && officialDisclosureTargetNodes.length === 0
      ? input.workbench.source_plan
      : planSourcesForComponents(sourcePlanInput(sourcePlanInputWithDefaults, components, depth, officialDisclosureTargetNodes));
  const dataQuality = emptyStaticDataQualitySummary(generatedAt);
  const staticInput: ResearchPackInput = {
    company: input.workbench.selected_company_id,
    components,
    depth,
    generatedAt,
    tradeObservationMonth: sourcePlanInputWithDefaults.tradeObservationMonth,
    ...(sourcePlanInputWithDefaults.tradeObservationCountryCode === undefined
      ? {}
      : { tradeObservationCountryCode: sourcePlanInputWithDefaults.tradeObservationCountryCode }),
    ...(sourcePlanInputWithDefaults.tradeObservationDirections === undefined
      ? {}
      : { tradeObservationDirections: sourcePlanInputWithDefaults.tradeObservationDirections }),
    officialDisclosureYear: sourcePlanInputWithDefaults.officialDisclosureYear,
    ...(input.researchTargetProfileId === undefined ? {} : { researchTargetProfileId: input.researchTargetProfileId }),
    ...(input.officialDisclosureTargetNodes === undefined ? {} : { officialDisclosureTargetNodes: input.officialDisclosureTargetNodes }),
    materialObservationYear: sourcePlanInputWithDefaults.materialObservationYear,
    commodityObservationMonth: sourcePlanInputWithDefaults.commodityObservationMonth,
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
  const propagationReadiness = buildPropagationReadinessReport({
    generated_at: generatedAt,
    company_id: input.workbench.selected_company_id,
    workbench: input.workbench,
    observation_coverage: observationCoverage,
    official_disclosure_readiness: officialDisclosureReadiness,
    source_plan: sourcePlan,
    source_target_coverage: sourceTargetCoverage,
    supply_chain_expansion_plan: supplyChainExpansionPlan
  });
  const gate1DataDepthWorkbench = buildGate1DataDepthWorkbench({
    generated_at: generatedAt,
    company_id: input.workbench.selected_company_id,
    official_disclosure_readiness: officialDisclosureReadiness,
    source_target_coverage: sourceTargetCoverage,
    supply_chain_expansion_plan: supplyChainExpansionPlan,
    propagation_readiness: propagationReadiness,
    adjacent_official_facts: emptyAdjacentOfficialFacts(generatedAt, input.workbench.selected_company_id),
    entity_affiliation_contexts: []
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
    propagation_readiness: propagationReadiness,
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
    propagationReadiness,
    gate1DataDepthWorkbench,
    claimBuild: null,
    intelligenceRefresh: null,
    componentRiskRefresh: null,
    rootUnknownMaterialization: null,
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
    propagation_readiness: propagationReadiness,
    gate1_data_depth_workbench: gate1DataDepthWorkbench,
    gate1_run_ledger: buildGate1RunLedger({
      generated_at: generatedAt,
      company_id: input.workbench.selected_company_id,
      research_input: staticInput,
      official_disclosure_readiness: officialDisclosureReadiness,
      corroboration_source_plan: corroborationSourcePlan,
      supply_chain_expansion_plan: supplyChainExpansionPlan,
      entity_affiliation_contexts: [],
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

function emptyAdjacentOfficialFacts(generatedAt: string, companyId: string): Gate1AdjacentOfficialFactsReport {
  return {
    schema_version: "1.0.0",
    generated_at: generatedAt,
    company_id: companyId,
    summary: {
      fact_edges: 0,
      companies: 0,
      components: 0,
      source_adapters: 0,
      visible_edge_exclusions: 0,
      policy: "adjacent_context_only_no_fact_mutation"
    },
    edges: []
  };
}

function gate1DataDepthResearchContext(input: ResearchPackInput, sourcePlanInputWithDefaults: ReturnType<typeof withSourcePlanWindowDefaults>) {
  return {
    ...(input.depth === undefined ? {} : { depth: input.depth }),
    ...(sourcePlanInputWithDefaults.officialDisclosureYear === undefined
      ? {}
      : { official_disclosure_year: sourcePlanInputWithDefaults.officialDisclosureYear }),
    ...(input.researchTargetProfileId === undefined ? {} : { research_target_profile_id: input.researchTargetProfileId })
  };
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

function edgeCorroborationDispositionSummary(record: EdgeCorroborationDispositionRecord) {
  return {
    change_id: record.change_id,
    edge_id: record.edge_id,
    decision: record.decision,
    reviewer: record.reviewer,
    reason: record.reason,
    evidence_id: record.evidence_id,
    unknown_id: record.unknown_id,
    check_target_id: record.check_target_id,
    recorded_at: record.recorded_at
  };
}

function toGate1RankingCalibrationLabel(record: RankingCalibrationLabelRecord) {
  return {
    label_id: record.label_id,
    ranking_context_id: record.ranking_context_id,
    candidate_entity_id: record.candidate_entity_id,
    label: record.label,
    reviewer: record.reviewer,
    reviewed_at: record.reviewed_at,
    ...(record.rationale === undefined ? {} : { rationale: record.rationale })
  };
}

function normalizeId(value: string): string {
  return value.trim();
}
