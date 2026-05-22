import { buildEdgeClaimsFromCurrentEdgesTransactionally } from "@supplystrata/claim-builder";
import { loadChainCard, loadCompanyCard, loadComponentCard } from "@supplystrata/card-builder";
import { runDataQualityChecks, type DataQualitySummary } from "@supplystrata/data-quality";
import type { DatabaseStore, DbClient } from "@supplystrata/db";
import {
  listRefreshableComponentRiskComponentIds,
  refreshComponentRiskView,
  refreshEdgeIntelligenceContext,
  type ComponentRiskRefreshSummary,
  type EdgeIntelligenceRefreshSummary
} from "@supplystrata/evidence-maintenance";
import { type ChainViewModel, type CompanyCardModel, type ComponentCardModel } from "@supplystrata/render";
import { planSourcesForComponents, type SourcePlanItem } from "@supplystrata/source-plan";
import { buildWorkbenchModel, type WorkbenchModel } from "@supplystrata/workbench-export";
import { buildCorroborationSourcePlan, type CorroborationSourcePlan } from "./corroboration-source-plan.js";
import { buildInvestigationBacklog, type InvestigationBacklog } from "./investigation-backlog.js";
import { buildObservationCoverageReport, type ObservationCoverageReport } from "./observation-coverage.js";
import {
  buildOfficialDisclosureReadinessReport,
  type OfficialDisclosureReadinessProfile,
  type OfficialDisclosureReadinessReport,
  type OfficialDisclosureReadinessTargetNode
} from "./official-disclosure-readiness.js";
import { buildQuestionReadinessMatrix, type QuestionReadinessMatrix } from "./question-readiness.js";
import {
  selectResearchTargetProfile,
  type ResearchTargetProfile,
  type ResearchTargetProfileOption,
  type ResearchTargetProfileSelection
} from "./research-target-profile.js";
import { buildExpectedSourceTargetCoverageReport, buildSourceTargetCoverageReport, type SourceTargetCoverageReport } from "./source-target-coverage.js";
import type { SourceTargetPreflightReport } from "./source-target-preflight.js";
import { buildSupplyChainExpansionPlan, type SupplyChainExpansionPlan } from "./supply-chain-expansion-plan.js";
export type * from "./definitions.js";
import type {
  ResearchPackClaimBuild,
  ResearchPackComponentRiskRefresh,
  ResearchPackFile,
  ResearchPackInput,
  ResearchPackManifest,
  ResearchPackModel,
  ResearchPackTargetProfile,
  ResearchPackWriteSteps,
  WorkbenchSnapshotPackInput,
  WorkbenchSnapshotPackModel,
  WrittenResearchPack
} from "./definitions.js";

export * from "./investigation-backlog.js";
export * from "./corroboration-source-plan.js";
export * from "./observation-coverage.js";
export * from "./official-disclosure-readiness.js";
export * from "./official-disclosure-signal-correlation.js";
export * from "./question-readiness.js";
export * from "./research-target-profile.js";
export * from "./source-target-coverage.js";
export * from "./source-target-preflight.js";
export * from "./supply-chain-expansion-plan.js";
export { safeFileSegment, writeResearchPack, writeWorkbenchSnapshotPack } from "./writer.js";

export async function buildResearchPack(client: DatabaseStore, input: ResearchPackInput): Promise<ResearchPackModel> {
  const generatedAt = new Date().toISOString();
  const depth = input.depth ?? 3;
  const writeSteps = resolveResearchPackWriteSteps(input);
  const claimBuild = await maybeBuildClaims(client, writeSteps, input);
  const intelligenceRefresh = await maybeRefreshIntelligence(client, writeSteps, input);
  const workbench = await buildWorkbenchModel(client, {
    company: input.company,
    depth,
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
    client,
    generated_at: generatedAt,
    company_id: workbench.selected_company_id,
    source_plan: sourcePlan,
    ...(input.sourceTargetNamespace === undefined ? {} : { namespace: input.sourceTargetNamespace })
  });
  const componentRiskRefresh = await maybeRefreshComponentRiskViews(client, writeSteps, input, components, generatedAt);
  const [company, chain, componentCards, dataQuality] = await Promise.all([
    loadCompanyCard(client, workbench.selected_company_id),
    loadChainCard(client, workbench.selected_company_id, { depth }),
    loadComponentCards(client, components),
    runDataQualityChecks(client)
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
    supply_chain_expansion_plan: supplyChainExpansionPlan
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
  const dataQuality = emptyStaticDataQualitySummary();
  const generatedAt = new Date().toISOString();
  const staticInput: ResearchPackInput = {
    company: input.workbench.selected_company_id,
    components,
    depth,
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
    supply_chain_expansion_plan: supplyChainExpansionPlan
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

export function resolveResearchPackWriteSteps(
  input: Pick<ResearchPackInput, "buildClaims" | "refreshIntelligence" | "refreshComponentRisk">
): ResearchPackWriteSteps {
  return {
    buildClaims: input.buildClaims === true,
    refreshIntelligence: input.refreshIntelligence === true,
    refreshComponentRisk: input.refreshComponentRisk === true
  };
}

async function maybeBuildClaims(client: DatabaseStore, writeSteps: ResearchPackWriteSteps, input: ResearchPackInput): Promise<ResearchPackClaimBuild | null> {
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

async function maybeRefreshIntelligence(
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

async function maybeRefreshComponentRiskViews(
  client: DatabaseStore,
  writeSteps: ResearchPackWriteSteps,
  input: ResearchPackInput,
  componentIds: readonly string[],
  computedAt: string
): Promise<ResearchPackComponentRiskRefresh | null> {
  if (!writeSteps.refreshComponentRisk) return null;
  const generatedBy = input.generatedBy ?? "research-pack.component-risk-refresh.v1";
  const refreshableComponentIds = await listRefreshableComponentRiskComponentIds(client, componentIds);
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

async function loadComponentCards(client: DbClient, componentIds: readonly string[]): Promise<ComponentCardModel[]> {
  const cards: ComponentCardModel[] = [];
  for (const componentId of componentIds) {
    cards.push(await loadComponentCard(client, componentId));
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

function researchPackTargetProfile(selection: ResearchTargetProfileSelection): ResearchPackTargetProfile | null {
  if (selection.profile === null) return null;
  return {
    profile_id: selection.profile.profile_id,
    title: selection.profile.title,
    version: selection.profile.version,
    description: selection.profile.description,
    selection_reason: selection.reason,
    target_nodes: selection.profile.target_nodes.length
  };
}

function manifestFromModel(input: {
  generatedAt: string;
  input: ResearchPackInput;
  depth: number;
  workbench: WorkbenchModel;
  components: readonly string[];
  sourcePlan: readonly SourcePlanItem[];
  sourceTargetCoverage?: SourceTargetCoverageReport;
  sourceTargetPreflight?: SourceTargetPreflightReport | null;
  dataQuality: DataQualitySummary;
  questionReadiness: QuestionReadinessMatrix;
  investigationBacklog: InvestigationBacklog;
  corroborationSourcePlan: CorroborationSourcePlan;
  observationCoverage: ObservationCoverageReport;
  officialDisclosureReadiness: OfficialDisclosureReadinessReport;
  supplyChainExpansionPlan: SupplyChainExpansionPlan;
  claimBuild: ResearchPackClaimBuild | null;
  intelligenceRefresh: EdgeIntelligenceRefreshSummary | null;
  componentRiskRefresh: ResearchPackComponentRiskRefresh | null;
  targetProfileSelection: ResearchTargetProfileSelection;
  mode?: ResearchPackManifest["mode"];
}): ResearchPackManifest {
  return {
    schema_version: "1.0.0",
    mode: input.mode ?? "truth_store",
    generated_at: input.generatedAt,
    company_query: input.input.company,
    selected_company_id: input.workbench.selected_company_id,
    depth: input.depth,
    components: [...input.components],
    files: [],
    stats: {
      companies: input.workbench.companies.length,
      chain_segments: input.workbench.chain_segments.length,
      fact_edges: input.workbench.edges.length,
      claims: input.workbench.claims.length,
      draft_claims: input.workbench.draft_claims.length,
      claim_conflicts: countClaimConflicts(input.workbench),
      contradicting_evidence_links: countContradictingEvidenceLinks(input.workbench),
      claim_lifecycle_warnings: countClaimLifecycleWarnings(input.workbench),
      attention_items: input.workbench.attention_queue.length,
      review_candidates: input.workbench.review_queue.length,
      evidences: input.workbench.evidences.length,
      unknown_items: input.workbench.unknown_items.length,
      source_plan_items: input.sourcePlan.length,
      runnable_suggested_targets: input.sourcePlan.reduce((count, item) => count + item.suggested_check_targets.filter((target) => target.runnable).length, 0),
      data_quality_errors: input.dataQuality.counts.error,
      data_quality_warnings: input.dataQuality.counts.warn,
      intelligence_edge_strengths: input.workbench.intelligence.edge_strengths.length,
      intelligence_edge_freshness: input.workbench.intelligence.edge_freshness.length,
      component_risk_views_refreshed: input.componentRiskRefresh?.risk_views_refreshed ?? 0,
      component_risk_metrics_written: input.componentRiskRefresh?.metrics_written ?? 0,
      component_risk_changes_recorded: input.componentRiskRefresh?.risk_changes_recorded ?? 0,
      question_readiness_ready: input.questionReadiness.summary.ready,
      question_readiness_partial: input.questionReadiness.summary.partial,
      question_readiness_blocked: input.questionReadiness.summary.blocked,
      investigation_backlog_items: input.investigationBacklog.summary.open_items,
      investigation_backlog_p0: input.investigationBacklog.summary.p0,
      investigation_backlog_p1: input.investigationBacklog.summary.p1,
      investigation_backlog_corroboration_reviews: input.investigationBacklog.summary.corroboration_reviews,
      investigation_backlog_corroboration_review_runnable_targets: input.investigationBacklog.summary.corroboration_review_runnable_targets,
      investigation_backlog_corroboration_review_with_source_target_coverage:
        input.investigationBacklog.summary.corroboration_review_with_source_target_coverage,
      investigation_backlog_corroboration_review_explicit_disposition_only: input.investigationBacklog.summary.corroboration_review_explicit_disposition_only,
      investigation_backlog_corroboration_review_need_sync: input.investigationBacklog.summary.corroboration_review_need_sync,
      investigation_backlog_corroboration_review_need_enable: input.investigationBacklog.summary.corroboration_review_need_enable,
      investigation_backlog_corroboration_review_due: input.investigationBacklog.summary.corroboration_review_due,
      investigation_backlog_corroboration_review_failed_preflight: input.investigationBacklog.summary.corroboration_review_failed_preflight,
      investigation_backlog_corroboration_review_missing_credentials: input.investigationBacklog.summary.corroboration_review_missing_credentials,
      investigation_backlog_corroboration_review_invalid_config: input.investigationBacklog.summary.corroboration_review_invalid_config,
      investigation_backlog_corroboration_review_unsupported_connector: input.investigationBacklog.summary.corroboration_review_unsupported_connector,
      investigation_backlog_corroboration_review_source_unreachable: input.investigationBacklog.summary.corroboration_review_source_unreachable,
      corroboration_source_plan_items: input.corroborationSourcePlan.summary.source_plan_items,
      corroboration_source_plan_targets: input.corroborationSourcePlan.summary.runnable_targets,
      corroboration_source_plan_edges: input.corroborationSourcePlan.summary.review_edges,
      corroboration_source_plan_need_sync: input.corroborationSourcePlan.summary.targets_need_sync,
      corroboration_source_plan_need_enable: input.corroborationSourcePlan.summary.targets_need_enable,
      corroboration_source_plan_due: input.corroborationSourcePlan.summary.targets_due,
      corroboration_source_plan_failed_preflight: input.corroborationSourcePlan.summary.targets_failed_preflight,
      corroboration_source_plan_missing_credentials: input.corroborationSourcePlan.summary.targets_missing_credentials,
      corroboration_source_plan_next_actions: input.corroborationSourcePlan.summary.by_next_action,
      investigation_backlog_runnable_targets: input.investigationBacklog.summary.runnable_check_targets,
      source_target_expected_targets: input.sourceTargetCoverage?.summary.expected_targets ?? 0,
      source_target_synced_targets: input.sourceTargetCoverage?.summary.synced_targets ?? 0,
      source_target_not_synced: input.sourceTargetCoverage?.summary.not_synced ?? 0,
      source_target_due_targets: input.sourceTargetCoverage?.summary.due_targets ?? 0,
      source_target_active_jobs: input.sourceTargetCoverage?.summary.active_jobs ?? 0,
      source_target_degraded_targets: input.sourceTargetCoverage?.summary.degraded_targets ?? 0,
      source_target_dead_targets: input.sourceTargetCoverage?.summary.dead_targets ?? 0,
      source_target_targets_with_observations: input.sourceTargetCoverage?.summary.targets_with_observations ?? 0,
      source_target_preflight_selected_targets: input.sourceTargetPreflight?.summary.selected_targets ?? 0,
      source_target_preflight_checked_targets: input.sourceTargetPreflight?.summary.checked_targets ?? 0,
      source_target_preflight_failed_targets: input.sourceTargetPreflight?.summary.failed_targets ?? 0,
      source_target_preflight_degraded_documents: input.sourceTargetPreflight?.summary.degraded_documents ?? 0,
      source_target_preflight_issue_kinds: countSourceTargetPreflightIssueKinds(input.sourceTargetPreflight ?? null),
      observation_records: input.observationCoverage.summary.typed_observations,
      observation_chain_segments: input.observationCoverage.summary.chain_observation_segments,
      observation_types_present: input.observationCoverage.summary.observation_types_present,
      observation_methodology_types_missing: input.observationCoverage.summary.methodology_types_missing,
      observation_series: input.observationCoverage.summary.observation_series,
      observation_time_series_ready: input.observationCoverage.summary.time_series_ready,
      observation_explicit_baseline_ready: input.observationCoverage.summary.explicit_baseline_ready,
      observation_sparse_series: input.observationCoverage.summary.sparse_series,
      official_disclosure_visible_nodes: input.officialDisclosureReadiness.summary.visible_research_nodes,
      official_disclosure_target_nodes: input.officialDisclosureReadiness.summary.target_research_nodes,
      official_disclosure_nodes_with_fact_edges: input.officialDisclosureReadiness.summary.nodes_with_fact_edges,
      official_disclosure_target_nodes_with_fact_edges: input.officialDisclosureReadiness.summary.target_nodes_with_fact_edges,
      official_disclosure_nodes_missing_coverage: input.officialDisclosureReadiness.summary.nodes_missing_official_coverage,
      official_disclosure_target_nodes_missing_coverage: input.officialDisclosureReadiness.summary.target_nodes_missing_official_coverage,
      official_disclosure_profile_expansion_candidates: input.officialDisclosureReadiness.profile_expansion_candidates.length,
      official_disclosure_expected_source_links: input.officialDisclosureReadiness.summary.expected_official_source_links,
      official_disclosure_expected_source_links_with_coverage: input.officialDisclosureReadiness.summary.expected_official_source_links_with_coverage,
      official_disclosure_expected_source_links_runnable: input.officialDisclosureReadiness.summary.expected_official_source_links_runnable,
      official_disclosure_expected_source_links_connector_available:
        input.officialDisclosureReadiness.summary.expected_official_source_links_connector_available,
      official_disclosure_expected_source_links_unimplemented: input.officialDisclosureReadiness.summary.expected_official_source_links_unimplemented,
      official_disclosure_expected_source_links_missing: input.officialDisclosureReadiness.summary.expected_official_source_links_missing,
      official_disclosure_l4_l5_edges: input.officialDisclosureReadiness.summary.level_4_5_fact_edges,
      official_disclosure_traceable_edges: input.officialDisclosureReadiness.summary.traceable_edges,
      official_disclosure_cross_source_edges: input.officialDisclosureReadiness.summary.cross_source_edges,
      official_disclosure_corroboration_ratio: input.officialDisclosureReadiness.summary.corroboration_ratio,
      official_disclosure_corroboration_queue_items: input.officialDisclosureReadiness.summary.corroboration_queue_items,
      official_disclosure_corroboration_queue_with_runnable_targets: input.officialDisclosureReadiness.summary.corroboration_queue_with_runnable_targets,
      official_disclosure_corroboration_queue_needing_disposition: input.officialDisclosureReadiness.summary.corroboration_queue_needing_disposition,
      official_disclosure_corroboration_queue_recorded_disposition: input.officialDisclosureReadiness.summary.corroboration_queue_with_recorded_disposition,
      official_disclosure_corroboration_queue_proposed_unknowns: input.officialDisclosureReadiness.summary.corroboration_queue_proposed_unknowns,
      official_disclosure_gaps: input.officialDisclosureReadiness.gaps.length,
      official_disclosure_p0_gaps: input.officialDisclosureReadiness.gaps.filter((gap) => gap.priority === "P0").length,
      official_disclosure_runnable_targets: input.officialDisclosureReadiness.summary.runnable_official_targets,
      official_disclosure_synced_targets: input.officialDisclosureReadiness.summary.synced_official_targets,
      official_disclosure_due_targets: input.officialDisclosureReadiness.summary.due_official_targets,
      official_disclosure_degraded_targets: input.officialDisclosureReadiness.summary.degraded_official_targets,
      official_disclosure_targets_with_observations: input.officialDisclosureReadiness.summary.official_targets_with_observations,
      official_disclosure_signal_review_candidates: input.officialDisclosureReadiness.summary.official_disclosure_signal_review_candidates,
      open_official_disclosure_signal_review_candidates: input.officialDisclosureReadiness.summary.open_official_disclosure_signal_review_candidates,
      official_disclosure_signal_dispositions: input.officialDisclosureReadiness.summary.official_disclosure_signal_dispositions,
      official_disclosure_signal_correlation_hints: input.officialDisclosureReadiness.summary.official_disclosure_signal_correlation_hints,
      open_official_disclosure_signal_correlation_hints: input.officialDisclosureReadiness.summary.open_official_disclosure_signal_correlation_hints,
      official_disclosure_gate1_overall_progress: input.officialDisclosureReadiness.scorecard.overall_progress,
      official_disclosure_gate1_data_progress: input.officialDisclosureReadiness.scorecard.data_progress,
      official_disclosure_gate1_source_path_progress: input.officialDisclosureReadiness.scorecard.source_path_progress,
      supply_chain_expansion_frontier_edges: input.supplyChainExpansionPlan.summary.frontier_edges,
      supply_chain_expansion_frontier_companies: input.supplyChainExpansionPlan.summary.frontier_companies,
      supply_chain_expansion_component_dependency_leads: input.supplyChainExpansionPlan.summary.component_dependency_leads,
      supply_chain_expansion_leads_with_source_path: input.supplyChainExpansionPlan.summary.leads_with_source_path,
      supply_chain_expansion_blocked_frontier_edges: input.supplyChainExpansionPlan.summary.blocked_frontier_edges,
      supply_chain_expansion_stop_conditions: input.supplyChainExpansionPlan.summary.stop_conditions
    },
    claim_build: input.claimBuild,
    intelligence_refresh: input.intelligenceRefresh,
    component_risk_refresh: input.componentRiskRefresh,
    research_target_profile: researchPackTargetProfile(input.targetProfileSelection)
  };
}

function emptyStaticDataQualitySummary(): DataQualitySummary {
  return {
    checked_at: new Date().toISOString(),
    ok: true,
    counts: { error: 0, warn: 0, info: 0 },
    issues: []
  };
}

function countClaimConflicts(workbench: WorkbenchModel): number {
  return [...workbench.claims, ...workbench.draft_claims].filter((claim) => claim.conflict_state !== "none").length;
}

function countContradictingEvidenceLinks(workbench: WorkbenchModel): number {
  return [...workbench.claims, ...workbench.draft_claims].reduce(
    (count, claim) => count + claim.evidence_refs.filter((ref) => ref.role === "contradicting").length,
    0
  );
}

function countClaimLifecycleWarnings(workbench: WorkbenchModel): number {
  return [...workbench.claims, ...workbench.draft_claims].reduce((count, claim) => count + claim.lifecycle_warnings.length, 0);
}

function countSourceTargetPreflightIssueKinds(report: SourceTargetPreflightReport | null): Record<string, number> {
  if (report === null) return {};
  const counts: Record<string, number> = {};
  for (const summary of Object.values(report.summary.by_source_status)) {
    for (const [issueKind, count] of Object.entries(summary.issue_kinds)) {
      counts[issueKind] = (counts[issueKind] ?? 0) + count;
    }
  }
  const sorted: Record<string, number> = {};
  for (const [issueKind, count] of Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))) {
    sorted[issueKind] = count;
  }
  return sorted;
}

function normalizeId(value: string): string {
  return value.trim();
}
