import type { DataQualitySummary } from "@supplystrata/data-quality";
import type { CompanyCardModel, ComponentCardModel } from "@supplystrata/render";
import type { SourcePlanItem } from "@supplystrata/source-plan";
import type { WorkbenchModel } from "@supplystrata/workbench-export";

export type QuestionReadinessStatus = "ready" | "partial" | "blocked";

export interface QuestionReadinessItem {
  question_id: string;
  question: string;
  status: QuestionReadinessStatus;
  confidence: number;
  ready_signals: string[];
  missing_requirements: string[];
  supporting_refs: string[];
  unknown_ids: string[];
}

export interface QuestionReadinessMatrix {
  schema_version: "1.0.0";
  generated_at: string;
  company_id: string;
  summary: {
    ready: number;
    partial: number;
    blocked: number;
  };
  items: QuestionReadinessItem[];
}

export interface QuestionReadinessInput {
  generated_at: string;
  company_id: string;
  workbench: WorkbenchModel;
  company: CompanyCardModel | null;
  components: readonly ComponentCardModel[];
  source_plan: readonly SourcePlanItem[];
  data_quality: DataQualitySummary | null;
}

interface ReadinessDraft {
  question_id: string;
  question: string;
  ready_signals: string[];
  missing_requirements: string[];
  supporting_refs: string[];
  unknown_ids: string[];
  confidence_seed: number;
}

export function buildQuestionReadinessMatrix(input: QuestionReadinessInput): QuestionReadinessMatrix {
  const items = [
    companyUpstreamDependencies(input),
    productComponentDependencies(input),
    componentProviderCoverage(input),
    evidenceTraceability(input),
    recentChangeAwareness(input),
    knownUnknownBoundaries(input),
    relationshipIntelligenceContext(input),
    financialSignalContext(input),
    componentRiskContext(input),
    nextSourcePlanContext(input)
  ].map(finalizeReadinessItem);

  return {
    schema_version: "1.0.0",
    generated_at: input.generated_at,
    company_id: input.company_id,
    summary: {
      ready: items.filter((item) => item.status === "ready").length,
      partial: items.filter((item) => item.status === "partial").length,
      blocked: items.filter((item) => item.status === "blocked").length
    },
    items
  };
}

export function renderQuestionReadinessMarkdown(matrix: QuestionReadinessMatrix): string {
  const lines = [
    `# Question Readiness ${matrix.company_id}`,
    "",
    `Generated at: ${matrix.generated_at}`,
    `Ready: ${matrix.summary.ready}; partial: ${matrix.summary.partial}; blocked: ${matrix.summary.blocked}`,
    "",
    "## Matrix",
    ""
  ];
  for (const item of matrix.items) {
    lines.push(`- ${item.question_id}: ${item.status} (confidence ${item.confidence.toFixed(2)})`);
    lines.push(`  Question: ${item.question}`);
    lines.push(`  Ready signals: ${item.ready_signals.length === 0 ? "(none)" : item.ready_signals.join("; ")}`);
    lines.push(`  Missing: ${item.missing_requirements.length === 0 ? "(none)" : item.missing_requirements.join("; ")}`);
    if (item.supporting_refs.length > 0) lines.push(`  Refs: ${item.supporting_refs.join(", ")}`);
    if (item.unknown_ids.length > 0) lines.push(`  Unknowns: ${item.unknown_ids.join(", ")}`);
  }
  return lines.join("\n");
}

function companyUpstreamDependencies(input: QuestionReadinessInput): ReadinessDraft {
  const upstreamEdges = input.company?.directly_disclosed_upstream ?? input.workbench.edges.filter((edge) => edge.from_id === input.company_id);
  return {
    question_id: "company.upstream_dependencies",
    question: "某公司依赖哪些上游？",
    ready_signals: [
      signalIf(upstreamEdges.length > 0, `${upstreamEdges.length} Level 4/5 upstream fact edges`),
      signalIf(
        upstreamEdges.some((edge) => edge.evidence_level >= 5),
        "At least one Level 5 direct disclosure edge"
      )
    ].filter(isPresent),
    missing_requirements: [
      signalIf(upstreamEdges.length === 0, "No Level 4/5 upstream fact edge for the selected company"),
      signalIf(openCompanyUnknowns(input).length === 0, "No company-scoped unknown map to bound missing upstream relationships")
    ].filter(isPresent),
    supporting_refs: edgeRefs(upstreamEdges),
    unknown_ids: openCompanyUnknowns(input),
    confidence_seed: upstreamEdges.length === 0 ? 0 : average(upstreamEdges.map((edge) => edge.confidence))
  };
}

function productComponentDependencies(input: QuestionReadinessInput): ReadinessDraft {
  const componentIds = uniqueSorted(input.workbench.chain_segments.flatMap((segment) => (segment.component_id === null ? [] : [segment.component_id])));
  return {
    question_id: "product.component_dependencies",
    question: "某产品或公司链路依赖哪些组件？",
    ready_signals: [
      signalIf(componentIds.length > 0, `${componentIds.length} component ids appear in chain segments`),
      signalIf(input.components.length > 0, `${input.components.length} ComponentCards included in research pack`)
    ].filter(isPresent),
    missing_requirements: [
      signalIf(componentIds.length === 0, "No component_id found in current chain segments"),
      signalIf(input.components.length === 0, "No ComponentCard included, so component-specific details are not packaged")
    ].filter(isPresent),
    supporting_refs: componentIds.map((componentId) => `component:${componentId}`),
    unknown_ids: componentUnknownIds(input),
    confidence_seed: componentIds.length === 0 ? 0 : Math.min(0.9, 0.45 + componentIds.length * 0.08)
  };
}

function componentProviderCoverage(input: QuestionReadinessInput): ReadinessDraft {
  const covered = input.components.filter((component) => component.known_suppliers.length > 0 || component.known_consumers.length > 0);
  return {
    question_id: "component.known_providers",
    question: "某组件由哪些公司提供或消费？",
    ready_signals: [
      signalIf(covered.length > 0, `${covered.length}/${input.components.length} components have known suppliers or consumers`),
      signalIf(
        input.components.some((component) => component.source_coverage.sources > 0),
        "At least one component has source coverage metadata"
      )
    ].filter(isPresent),
    missing_requirements: [
      signalIf(input.components.length === 0, "No component cards available"),
      signalIf(input.components.length > 0 && covered.length < input.components.length, "Some components still have no known supplier/consumer coverage")
    ].filter(isPresent),
    supporting_refs: covered.map((component) => `component:${component.component.component_id}`),
    unknown_ids: componentUnknownIds(input),
    confidence_seed: input.components.length === 0 ? 0 : covered.length / input.components.length
  };
}

function evidenceTraceability(input: QuestionReadinessInput): ReadinessDraft {
  const edgeIds = new Set(input.workbench.edges.map((edge) => edge.edge_id));
  const tracedEdgeIds = new Set(input.workbench.evidences.flatMap((evidence) => (evidence.edge_id === null ? [] : [evidence.edge_id])));
  const tracedCount = [...edgeIds].filter((edgeId) => tracedEdgeIds.has(edgeId)).length;
  const missingTraceIssues = input.data_quality?.issues.filter((issue) => issue.rule_id.startsWith("evidence.") || issue.rule_id.startsWith("edge.")) ?? [];
  return {
    question_id: "evidence.traceability",
    question: "证据在哪里，能否追溯到来源和原文？",
    ready_signals: [
      signalIf(input.workbench.evidences.length > 0, `${input.workbench.evidences.length} evidence records packaged`),
      signalIf(edgeIds.size > 0, `${tracedCount}/${edgeIds.size} fact edges have evidence records in the pack`),
      signalIf(missingTraceIssues.length === 0 && input.data_quality !== null, "No evidence/edge data-quality issue reported")
    ].filter(isPresent),
    missing_requirements: [
      signalIf(edgeIds.size === 0, "No fact edges to trace"),
      signalIf(edgeIds.size > 0 && tracedCount < edgeIds.size, "Some fact edges do not have packaged evidence records"),
      signalIf(missingTraceIssues.length > 0, `${missingTraceIssues.length} evidence/edge data-quality issues remain`)
    ].filter(isPresent),
    supporting_refs: input.workbench.evidences.slice(0, 10).map((evidence) => `evidence:${evidence.evidence_id}`),
    unknown_ids: [],
    confidence_seed: edgeIds.size === 0 ? 0 : tracedCount / edgeIds.size
  };
}

function recentChangeAwareness(input: QuestionReadinessInput): ReadinessDraft {
  const attentionChanges = input.workbench.changes.filter((change) => change.event_family === "semantic" || change.event_family === "risk");
  return {
    question_id: "monitoring.recent_changes",
    question: "最近有没有变化？",
    ready_signals: [
      signalIf(input.workbench.changes.length > 0, `${input.workbench.changes.length} timeline changes packaged`),
      signalIf(attentionChanges.length > 0, `${attentionChanges.length} semantic changes available for review`)
    ].filter(isPresent),
    missing_requirements: [
      signalIf(input.workbench.changes.length === 0, "No change timeline items in the current pack"),
      signalIf(input.workbench.sources.length === 0, "No source health rows packaged for monitoring context")
    ].filter(isPresent),
    supporting_refs: input.workbench.changes.slice(0, 10).map((change) => `change:${change.event_id}`),
    unknown_ids: [],
    confidence_seed: input.workbench.changes.length === 0 ? 0 : Math.min(0.85, 0.35 + input.workbench.changes.length * 0.04)
  };
}

function knownUnknownBoundaries(input: QuestionReadinessInput): ReadinessDraft {
  const unknowns = uniqueSorted([
    ...input.workbench.unknown_items.map((item) => item.unknown_id),
    ...openCompanyUnknowns(input),
    ...componentUnknownIds(input)
  ]);
  return {
    question_id: "unknown.boundaries",
    question: "哪些环节我们知道，哪些其实不知道？",
    ready_signals: [signalIf(unknowns.length > 0, `${unknowns.length} open unknown items bound the answer`)].filter(isPresent),
    missing_requirements: [signalIf(unknowns.length === 0, "No unknown map items packaged; answers may look more certain than the data supports")].filter(
      isPresent
    ),
    supporting_refs: unknowns.map((unknownId) => `unknown:${unknownId}`),
    unknown_ids: unknowns,
    confidence_seed: unknowns.length === 0 ? 0.2 : Math.min(0.9, 0.45 + unknowns.length * 0.05)
  };
}

function relationshipIntelligenceContext(input: QuestionReadinessInput): ReadinessDraft {
  const edgeCount = input.workbench.edges.length;
  const strengthEdgeIds = new Set(input.workbench.intelligence.edge_strengths.map((strength) => strength.edge_id));
  const freshnessEdgeIds = new Set(input.workbench.intelligence.edge_freshness.map((freshness) => freshness.edge_id));
  const contextualizedEdges = input.workbench.edges.filter((edge) => strengthEdgeIds.has(edge.edge_id) || freshnessEdgeIds.has(edge.edge_id));
  return {
    question_id: "relationship.strength_freshness",
    question: "这些关系有多重要，多久没验证？",
    ready_signals: [
      signalIf(input.workbench.intelligence.edge_strengths.length > 0, `${input.workbench.intelligence.edge_strengths.length} edge strength estimates`),
      signalIf(input.workbench.intelligence.edge_freshness.length > 0, `${input.workbench.intelligence.edge_freshness.length} edge freshness records`),
      signalIf(edgeCount > 0, `${contextualizedEdges.length}/${edgeCount} edges have strength or freshness context`)
    ].filter(isPresent),
    missing_requirements: [
      signalIf(edgeCount === 0, "No fact edges available"),
      signalIf(edgeCount > 0 && input.workbench.intelligence.edge_freshness.length === 0, "No edge freshness context"),
      signalIf(edgeCount > 0 && input.workbench.intelligence.edge_strengths.length === 0, "No edge strength estimates")
    ].filter(isPresent),
    supporting_refs: contextualizedEdges.slice(0, 10).map((edge) => `edge:${edge.edge_id}`),
    unknown_ids: input.workbench.unknown_items
      .filter((unknown) => input.workbench.edges.some((edge) => edge.edge_id === unknown.unknown_id || unknown.question.includes(edge.edge_id)))
      .map((unknown) => unknown.unknown_id),
    confidence_seed: edgeCount === 0 ? 0 : contextualizedEdges.length / edgeCount
  };
}

function financialSignalContext(input: QuestionReadinessInput): ReadinessDraft {
  const observations = input.company?.related_observations ?? [];
  const peerMetrics = input.company?.financial_peer_metrics ?? [];
  const anomalousObservations = observations.filter((observation) => observation.anomaly?.is_anomaly === true);
  return {
    question_id: "signals.financial_context",
    question: "财务指标是否有跨期变化或同行位置线索？",
    ready_signals: [
      signalIf(observations.length > 0, `${observations.length} company observations included`),
      signalIf(anomalousObservations.length > 0, `${anomalousObservations.length} observation anomaly summaries included`),
      signalIf(peerMetrics.length > 0, `${peerMetrics.length} financial peer metrics included`)
    ].filter(isPresent),
    missing_requirements: [
      signalIf(input.company === null, "CompanyCard is not available in this pack"),
      signalIf(observations.length === 0, "No company-scoped observations included"),
      signalIf(peerMetrics.length === 0, "No financial peer comparison metrics included")
    ].filter(isPresent),
    supporting_refs: [
      ...observations.slice(0, 5).map((observation) => `observation:${observation.observation_id}`),
      ...peerMetrics.slice(0, 5).map((metric) => `risk_metric:${metric.metric_id}`)
    ],
    unknown_ids: [],
    confidence_seed: Math.min(0.9, observations.length * 0.06 + peerMetrics.length * 0.06 + anomalousObservations.length * 0.08)
  };
}

function componentRiskContext(input: QuestionReadinessInput): ReadinessDraft {
  const componentsWithRisk = input.components.filter((component) => component.risk_view !== null);
  const riskMetricCount = componentsWithRisk.reduce((count, component) => count + (component.risk_view?.metrics.length ?? 0), 0);
  return {
    question_id: "graph.component_risk",
    question: "哪些组件或节点是瓶颈、单点或传播风险？",
    ready_signals: [
      signalIf(componentsWithRisk.length > 0, `${componentsWithRisk.length}/${input.components.length} components have risk views`),
      signalIf(riskMetricCount > 0, `${riskMetricCount} component risk metrics included`)
    ].filter(isPresent),
    missing_requirements: [
      signalIf(input.components.length === 0, "No component cards available"),
      signalIf(input.components.length > 0 && componentsWithRisk.length < input.components.length, "Some components have no component risk baseline")
    ].filter(isPresent),
    supporting_refs: componentsWithRisk.flatMap((component) => (component.risk_view === null ? [] : [`risk_view:${component.risk_view.risk_view_id}`])),
    unknown_ids: componentUnknownIds(input),
    confidence_seed: input.components.length === 0 ? 0 : componentsWithRisk.length / input.components.length
  };
}

function nextSourcePlanContext(input: QuestionReadinessInput): ReadinessDraft {
  const runnableTargets = input.source_plan.flatMap((item) => item.suggested_check_targets.filter((target) => target.runnable));
  return {
    question_id: "investigation.next_sources",
    question: "缺口下一步该查哪些公开源？",
    ready_signals: [
      signalIf(input.source_plan.length > 0, `${input.source_plan.length} source plan items included`),
      signalIf(runnableTargets.length > 0, `${runnableTargets.length} runnable source check targets suggested`)
    ].filter(isPresent),
    missing_requirements: [
      signalIf(input.source_plan.length === 0, "No source plan items included"),
      signalIf(input.source_plan.length > 0 && runnableTargets.length === 0, "Source plan has no runnable check targets yet")
    ].filter(isPresent),
    supporting_refs: input.source_plan.slice(0, 20).map((item) => `source_plan:${item.source_id}`),
    unknown_ids: [],
    confidence_seed: input.source_plan.length === 0 ? 0 : Math.min(0.85, 0.35 + runnableTargets.length * 0.05)
  };
}

function finalizeReadinessItem(draft: ReadinessDraft): QuestionReadinessItem {
  const status = readinessStatus(draft);
  return {
    question_id: draft.question_id,
    question: draft.question,
    status,
    confidence: readinessConfidence(draft, status),
    ready_signals: draft.ready_signals,
    missing_requirements: draft.missing_requirements,
    supporting_refs: uniqueSorted(draft.supporting_refs).slice(0, 20),
    unknown_ids: uniqueSorted(draft.unknown_ids).slice(0, 20)
  };
}

function readinessStatus(draft: ReadinessDraft): QuestionReadinessStatus {
  if (draft.ready_signals.length === 0) return "blocked";
  if (draft.missing_requirements.length === 0) return "ready";
  return "partial";
}

function readinessConfidence(draft: ReadinessDraft, status: QuestionReadinessStatus): number {
  const penalty = status === "ready" ? 0 : status === "partial" ? 0.15 : 0.35;
  return clamp(draft.confidence_seed - penalty, 0, 0.95);
}

function openCompanyUnknowns(input: QuestionReadinessInput): string[] {
  return input.company?.unknown_map.map((item) => item.unknown_id) ?? input.workbench.unknown_items.map((item) => item.unknown_id);
}

function componentUnknownIds(input: QuestionReadinessInput): string[] {
  return input.components.flatMap((component) => component.unknown_map.map((item) => item.unknown_id));
}

function edgeRefs(edges: readonly { edge_id: string }[]): string[] {
  return edges.slice(0, 20).map((edge) => `edge:${edge.edge_id}`);
}

function signalIf(condition: boolean, value: string): string | undefined {
  return condition ? value : undefined;
}

function isPresent(value: string | undefined): value is string {
  return value !== undefined;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number(value.toFixed(3))));
}
