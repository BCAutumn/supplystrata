import type { SourceTargetCoverageItem } from "@supplystrata/source-monitor";
import type {
  Gate1DataDepthCommandHint,
  Gate1DataDepthFrontendActionKind,
  Gate1DataDepthPriority,
  Gate1DataDepthResearchContext,
  Gate1DataDepthRankingCalibrationExistingLabel,
  Gate1DataDepthRankingContext,
  Gate1DataDepthReviewDecision,
  Gate1DataDepthSourceTargetRef,
  Gate1DataDepthWorkbenchInput,
  Gate1DataDepthWorkbenchItem,
  Gate1DataDepthWorkstream
} from "./gate1-data-depth-workbench-definitions.js";
import type { Gate1AdjacentOfficialFactEdge } from "./gate1-adjacent-official-facts.js";
import type {
  OfficialDisclosureCorroborationQueueItem,
  OfficialDisclosureReadinessGap,
  OfficialDisclosureReadinessNode
} from "./official-disclosure-readiness.js";
import {
  ADJACENT_COMPANY_RANKING_MODEL_VERSION,
  rankAdjacentOfficialFactCompanyCandidates,
  type AdjacentCompanyCandidate
} from "./gate1-adjacent-company-ranking.js";
import type { Gate1EntityAffiliationContext } from "./gate1-entity-affiliation-context.js";
import type { SourceTargetCoverageReport } from "./source-target-coverage.js";
import type { SupplyChainExpansionPlan } from "./supply-chain-expansion-plan.js";

const REVIEW_POLICY = "review_only_no_fact_mutation";

export function buildGate1DataDepthItems(input: Gate1DataDepthWorkbenchInput): Gate1DataDepthWorkbenchItem[] {
  return [
    ...gapWorkItems(input.official_disclosure_readiness.gaps),
    ...sourceBlockerItems(input.source_target_coverage),
    ...entityAffiliationWorkItems(input.entity_affiliation_contexts ?? [], input.official_disclosure_readiness),
    ...adjacentOfficialFactItems(input.adjacent_official_facts.edges, input.company_id, input.ranking_calibration_labels ?? [], input.research_context),
    ...corroborationWorkItems(input.official_disclosure_readiness.corroboration_queue),
    ...observationCalibrationItems(input.source_target_coverage),
    ...propagationWorkItems(input.propagation_readiness),
    ...frontierWorkItems(input.supply_chain_expansion_plan)
  ];
}

function adjacentOfficialFactItems(
  edges: readonly Gate1AdjacentOfficialFactEdge[],
  companyId: string,
  rankingLabels: readonly Gate1DataDepthRankingCalibrationExistingLabel[],
  researchContext: Gate1DataDepthResearchContext | undefined
): Gate1DataDepthWorkbenchItem[] {
  if (edges.length === 0) return [];
  const grouped = new Map<string, Gate1AdjacentOfficialFactEdge[]>();
  for (const edge of edges) {
    const key = edge.component_id;
    grouped.set(key, [...(grouped.get(key) ?? []), edge]);
  }
  return [...grouped.entries()].map(([componentId, componentEdges]) => {
    const topEdges = componentEdges.slice(0, 12);
    const companies = uniqueSorted(componentEdges.flatMap((edge) => [edge.from_id, edge.to_id]));
    const rankedCandidates = rankAdjacentOfficialFactCompanyCandidates({
      edges: topEdges,
      selected_company_id: companyId,
      component_id: componentId
    }).slice(0, 3);
    return workItem({
      item_id: `gate1-adjacent-official-facts:${componentId}`,
      workstream: "adjacent_official_facts",
      priority: componentEdges.some((edge) => edge.evidence_level === 5) ? "P1" : "P2",
      frontend_action_kind: "run_adjacent_company_research",
      title: `Use adjacent official facts for ${componentId}`,
      rationale:
        `${componentEdges.length} L4/L5 official fact edge(s) exist on the same component outside the current visible target-profile chain. ` +
        "They are evidence-backed context for the next recursive company loop, but they do not prove an NVIDIA relationship by themselves.",
      recommended_action:
        "Select the most relevant adjacent counterparties and run the same listed-company official-disclosure loop. Keep these edges as adjacent context until review-approved evidence links them into the target chain.",
      recommended_decision: "run_recursive_company_research",
      allowed_decisions: ["run_recursive_company_research", "defer"],
      write_impact: "No fact edge mutation is authorized; this only chooses next research targets from already-audited adjacent official facts.",
      command_hints: adjacentOfficialFactCommandHints(rankedCandidates, componentId, researchContext),
      ranking_contexts: adjacentOfficialFactRankingContexts(componentId, rankedCandidates, rankingLabels),
      refs: topEdges.flatMap((edge) => [`edge:${edge.edge_id}`, ...edge.evidence_ids.map((evidenceId) => `evidence:${evidenceId}`)]),
      edge_ids: componentEdges.map((edge) => edge.edge_id),
      component_ids: [componentId],
      source_adapters: uniqueSorted(componentEdges.flatMap((edge) => edge.source_adapters)),
      source_targets: []
    });
  });
}

function gapWorkItems(gaps: readonly OfficialDisclosureReadinessGap[]): Gate1DataDepthWorkbenchItem[] {
  return gaps.map((gap) =>
    workItem({
      item_id: `gate1-gap:${gap.gap_id}`,
      workstream: workstreamForGap(gap.kind),
      priority: gap.priority,
      frontend_action_kind: actionKindForWorkstream(workstreamForGap(gap.kind)),
      title: gap.title,
      rationale: gap.rationale,
      recommended_action: gap.action,
      recommended_decision: decisionForGap(gap.kind),
      allowed_decisions: allowedDecisionsForGap(gap.kind),
      write_impact: writeImpactForGap(gap.kind),
      command_hints: commandHintsForGap(gap),
      refs: gapRefs(gap),
      edge_ids: gap.edge_ids,
      component_ids: gap.component_ids,
      source_adapters: gap.source_adapters,
      source_targets: gap.source_targets.map(toSourceTargetRef)
    })
  );
}

function sourceBlockerItems(report: SourceTargetCoverageReport): Gate1DataDepthWorkbenchItem[] {
  const blockers = report.items.filter(isSourceBlocked);
  if (blockers.length === 0) return [];
  const grouped = new Map<string, SourceTargetCoverageItem[]>();
  for (const item of blockers) {
    const key = `${item.expected_target.source_adapter_id}:${item.latest_job?.failure_kind ?? item.state}`;
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return [...grouped.entries()].map(([key, items]) => {
    const [sourceAdapter, reason] = key.split(":");
    const sourceAdapterId = sourceAdapter ?? "unknown-source";
    const blockerReason = reason ?? "unknown";
    return workItem({
      item_id: `gate1-source-blocker:${sourceAdapterId}:${blockerReason}`,
      workstream: "source_blocker",
      priority: blockerReason === "missing_credentials" || blockerReason === "source_unreachable" ? "P0" : "P1",
      frontend_action_kind: "repair_source_target",
      title: `Resolve source blocker for ${sourceAdapterId}`,
      rationale: `${items.length} expected source target(s) are blocked by ${blockerReason}; without fixing this path, official observations cannot improve corroboration or data depth.`,
      recommended_action:
        "Fix the source policy or credential/configuration surface, then rerun the source target sync/check path. Keep resulting observations in review paths until evidence is approved.",
      recommended_decision:
        blockerReason === "missing_credentials" || blockerReason === "target_config_invalid" ? "sync_or_enable_source_target" : "rerun_source_check",
      allowed_decisions: ["sync_or_enable_source_target", "rerun_source_check", "defer"],
      write_impact: "May update source policy or source_check_targets/jobs only; does not create evidence or fact edges.",
      command_hints: sourceBlockerCommandHints(sourceAdapterId),
      refs: items.map((item) => `source_target:${item.matched_check_target_id ?? item.expected_target.check_target_id}`).sort(),
      edge_ids: [],
      component_ids: uniqueSorted(items.map((item) => targetConfigString(item, "component_id")).filter(nonEmpty)),
      source_adapters: [sourceAdapterId],
      source_targets: items.map(toCoverageSourceTargetRef)
    });
  });
}

function corroborationWorkItems(queue: readonly OfficialDisclosureCorroborationQueueItem[]): Gate1DataDepthWorkbenchItem[] {
  return queue.slice(0, 40).map((item) =>
    workItem({
      item_id: `gate1-corroboration:${item.edge_id}`,
      workstream: "counterparty_corroboration",
      priority: item.priority,
      frontend_action_kind: "review_counterparty_corroboration",
      title: `Corroborate edge ${item.from_name} -> ${item.to_name}`,
      rationale: item.reason,
      recommended_action: item.action,
      recommended_decision: "record_corroboration_disposition",
      allowed_decisions: ["record_corroboration_disposition", "keep_unknown_open", "defer"],
      write_impact: "May record review disposition or queue review work; must not mutate fact edges until approved evidence exists.",
      command_hints: corroborationCommandHints(item),
      refs: uniqueSorted([
        `edge:${item.edge_id}`,
        ...item.source_plan_refs.map((ref) => prefixedRef("source_plan", ref)),
        ...item.unknown_ids.map((unknownId) => `unknown:${unknownId}`)
      ]),
      edge_ids: [item.edge_id],
      component_ids: item.component_id === null ? [] : [item.component_id],
      source_adapters: item.candidate_source_ids,
      source_targets: item.source_targets.map(toSourceTargetRef)
    })
  );
}

function entityAffiliationWorkItems(
  contexts: readonly Gate1EntityAffiliationContext[],
  report: Gate1DataDepthWorkbenchInput["official_disclosure_readiness"]
): Gate1DataDepthWorkbenchItem[] {
  return contexts.map((context) => {
    const parentNode = report.nodes.find((node) => node.node_id === context.parent_entity_id);
    const parentName = context.parent_name ?? context.parent_entity_id;
    const sourceTargets = parentNode?.source_targets ?? [];
    return workItem({
      item_id: context.context_id,
      workstream: "entity_context",
      priority: entityContextPriority(parentNode),
      frontend_action_kind: "review_entity_context",
      title: `Review ${context.subject_name} via parent ${parentName}`,
      rationale:
        `${context.subject_name} is modeled as a ${context.subject_kind} with parent ${parentName}. ` +
        "This can explain why visible NVIDIA edges stop at a business-unit node while official disclosure monitoring is configured on the parent legal entity." +
        entityContextUnknownRationale(context),
      recommended_action:
        "Review whether the next recursive research loop should run on the parent legal entity, the business unit, or both. Do not copy parent evidence onto the child entity without review-approved relationship evidence." +
        entityContextUnknownAction(context),
      recommended_decision: "review_entity_affiliation",
      allowed_decisions: ["review_entity_affiliation", "run_recursive_company_research", "keep_unknown_open", "defer"],
      write_impact: "May record review disposition or choose a research scope; must not merge entities or propagate fact edges automatically.",
      command_hints: entityContextCommandHints(context),
      refs: uniqueSorted([
        `entity:${context.subject_entity_id}`,
        `entity:${context.parent_entity_id}`,
        ...context.edge_ids.map((edgeId) => `edge:${edgeId}`),
        ...context.parent_unknown_ids.map((unknownId) => `unknown:${unknownId}`),
        ...(parentNode?.source_plan_refs ?? [])
      ]),
      edge_ids: context.edge_ids,
      component_ids: context.component_ids,
      source_adapters: uniqueSorted([...(parentNode?.expected_source_ids ?? []), ...sourceTargets.map((target) => target.source_adapter_id)]),
      source_targets: sourceTargets.map(toSourceTargetRef)
    });
  });
}

function observationCalibrationItems(report: SourceTargetCoverageReport): Gate1DataDepthWorkbenchItem[] {
  const plan = report.observation_review.labeling_plan;
  if (plan.candidates.length === 0) return [];
  return [
    workItem({
      item_id: "gate1-observation-calibration:next-labeling-batch",
      workstream: "observation_calibration",
      priority: plan.candidates.some((candidate) => candidate.priority === "P0") ? "P0" : "P1",
      frontend_action_kind: "label_observation_sample",
      title: "Label the next observation calibration batch",
      rationale:
        "Gate 1 needs a small gold-label sample so metric anomaly, signal usefulness, and source quality can be held stable during later algorithm changes.",
      recommended_action:
        "Review the stratified unlabeled batch and persist labels through the observation calibration label path. Labels calibrate algorithms; they do not create fact edges.",
      recommended_decision: "record_observation_label",
      allowed_decisions: ["record_observation_label", "defer"],
      write_impact: "Writes observation_calibration_labels only; does not modify observations, evidence, unknowns, or fact edges.",
      command_hints: observationCalibrationCommandHints(plan.candidates.map((candidate) => candidate.observation_id)),
      refs: plan.candidates.map((candidate) => `observation:${candidate.observation_id}`),
      edge_ids: [],
      component_ids: [],
      source_adapters: uniqueSorted(
        report.items
          .filter((item) => item.observation_samples.some((sample) => plan.candidates.some((candidate) => candidate.observation_id === sample.observation_id)))
          .map((item) => item.expected_target.source_adapter_id)
      ),
      source_targets: []
    })
  ];
}

function propagationWorkItems(report: Gate1DataDepthWorkbenchInput["propagation_readiness"]): Gate1DataDepthWorkbenchItem[] {
  return report.items
    .filter((item) => item.status !== "ready")
    .map((item) =>
      workItem({
        item_id: `gate1-propagation:${item.context_kind}`,
        workstream: "propagation_context",
        priority: item.status === "blocked" ? "P1" : "P2",
        frontend_action_kind: "review_intelligence_context",
        title: item.title,
        rationale: item.rationale,
        recommended_action: item.action,
        recommended_decision: "keep_unknown_open",
        allowed_decisions: ["keep_unknown_open", "defer"],
        write_impact: "No write is recommended from this item; use it as propagation context until review-approved evidence or labels exist.",
        command_hints: [],
        refs: uniqueSorted([...item.observation_series_refs, ...item.source_plan_refs, ...item.component_dependency_refs, ...item.frontier_refs]),
        edge_ids: item.frontier_refs.map((ref) => ref.replace("supply_chain_frontier:", "")),
        component_ids: item.component_ids,
        source_adapters: [],
        source_targets: []
      })
    );
}

function frontierWorkItems(plan: SupplyChainExpansionPlan): Gate1DataDepthWorkbenchItem[] {
  if (plan.summary.blocked_frontier_edges === 0 && plan.summary.component_dependency_leads === 0) return [];
  return [
    workItem({
      item_id: "gate1-frontier:recursive-depth",
      workstream: "fact_edge_growth",
      priority: plan.summary.frontier_edges > 0 ? "P1" : "P2",
      frontend_action_kind: "run_frontier_research",
      title: "Advance recursive listed-company research frontier",
      rationale: `${plan.summary.frontier_edges} frontier edge(s) and ${plan.summary.component_dependency_leads} component lead(s) are available for the next evidence-first company loop.`,
      recommended_action:
        "Run the same official disclosure loop for ready frontier companies, then use review-approved evidence to grow L4/L5 edges. Component leads stay lead-only until official relationship evidence exists.",
      recommended_decision: "run_recursive_company_research",
      allowed_decisions: ["run_recursive_company_research", "defer"],
      write_impact:
        "Running research may refresh derived context and source targets when explicitly prepared; component leads remain non-fact until review-approved evidence exists.",
      command_hints: frontierCommandHints(plan),
      refs: uniqueSorted([
        ...plan.frontier.slice(0, 20).map((item) => `supply_chain_frontier:${item.frontier_id}`),
        ...plan.component_dependency_leads.slice(0, 20).map((lead) => `component_dependency:${lead.dependency_id}`)
      ]),
      edge_ids: plan.frontier.map((item) => item.edge_id),
      component_ids: uniqueSorted([
        ...plan.frontier.flatMap((item) => (item.component_id === null ? [] : [item.component_id])),
        ...plan.component_dependency_leads.map((lead) => lead.parent_component_id)
      ]),
      source_adapters: uniqueSorted(plan.component_dependency_leads.flatMap((lead) => lead.source_ids)),
      source_targets: []
    })
  ];
}

function workItem(
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
    command_hints: input.command_hints.slice(0, 8),
    ranking_contexts: (input.ranking_contexts ?? []).slice(0, 4),
    review_policy: REVIEW_POLICY,
    automatic_fact_mutation_allowed: false
  };
}

function actionKindForWorkstream(workstream: Gate1DataDepthWorkstream): Gate1DataDepthFrontendActionKind {
  if (workstream === "source_blocker") return "repair_source_target";
  if (workstream === "observation_calibration") return "label_observation_sample";
  if (workstream === "counterparty_corroboration") return "review_counterparty_corroboration";
  if (workstream === "entity_context") return "review_entity_context";
  if (workstream === "adjacent_official_facts") return "run_adjacent_company_research";
  if (workstream === "strength_context" || workstream === "propagation_context") return "review_intelligence_context";
  return "run_frontier_research";
}

function decisionForGap(kind: OfficialDisclosureReadinessGap["kind"]): Gate1DataDepthReviewDecision {
  if (kind === "expected_official_source_coverage" || kind === "traceability") return "sync_or_enable_source_target";
  if (kind === "corroboration_or_disposition_coverage") return "record_corroboration_disposition";
  if (kind === "edge_strength" || kind === "edge_freshness") return "keep_unknown_open";
  return "run_recursive_company_research";
}

function allowedDecisionsForGap(kind: OfficialDisclosureReadinessGap["kind"]): Gate1DataDepthReviewDecision[] {
  if (kind === "expected_official_source_coverage" || kind === "traceability") return ["sync_or_enable_source_target", "rerun_source_check", "defer"];
  if (kind === "corroboration_or_disposition_coverage") return ["record_corroboration_disposition", "keep_unknown_open", "defer"];
  if (kind === "edge_strength" || kind === "edge_freshness") return ["keep_unknown_open", "defer"];
  return ["run_recursive_company_research", "defer"];
}

function writeImpactForGap(kind: OfficialDisclosureReadinessGap["kind"]): string {
  if (kind === "expected_official_source_coverage" || kind === "traceability") {
    return "May update source_check_targets/jobs or review dispositions; must not create fact edges without review-approved evidence.";
  }
  if (kind === "corroboration_or_disposition_coverage") {
    return "May record a corroboration disposition or keep an unknown open; must not infer corroboration from silence.";
  }
  if (kind === "edge_strength" || kind === "edge_freshness") {
    return "No direct fact-layer write is recommended; missing strength/freshness remains explicit context until evidence supports it.";
  }
  return "May run another research/export loop; any new relation still requires review-approved evidence before it becomes a fact edge.";
}

function commandHintsForGap(gap: OfficialDisclosureReadinessGap): Gate1DataDepthCommandHint[] {
  if (gap.kind === "expected_official_source_coverage" || gap.kind === "traceability") return sourcePlanCommandHints(gap.source_adapters);
  if (gap.kind === "corroboration_or_disposition_coverage") return corroborationCommandHints();
  if (gap.kind === "core_node_coverage" || gap.kind === "level_4_5_edge_coverage") {
    return [
      commandHint(
        "Run next company research loop",
        "pnpm --silent cli research run --company <next-company-id> --depth 3 --prepare-data --out <research-pack-out>",
        true,
        true
      )
    ];
  }
  return [];
}

function sourcePlanCommandHints(sourceAdapters: readonly string[]): Gate1DataDepthCommandHint[] {
  const sourceFlag = sourceAdapters.length === 0 ? "" : ` --source ${uniqueSorted(sourceAdapters).join(",")}`;
  return [
    commandHint(
      "Preview source-plan targets",
      `pnpm --silent cli sources policy preview-plan-targets --source-plan <source-plan.json> --namespace <namespace>${sourceFlag}`,
      false,
      false
    ),
    commandHint(
      "Smoke source-plan targets",
      `pnpm --silent cli sources policy smoke-plan-targets --source-plan <source-plan.json> --namespace <namespace>${sourceFlag}`,
      false,
      false
    ),
    commandHint(
      "Sync source-plan targets",
      `pnpm --silent cli sources policy sync-plan-targets --source-plan <source-plan.json> --namespace <namespace>${sourceFlag}`,
      true,
      true
    )
  ];
}

function sourceBlockerCommandHints(sourceAdapterId: string): Gate1DataDepthCommandHint[] {
  return [
    commandHint("Inspect due targets", `pnpm --silent cli sources due --source ${sourceAdapterId}`, false, true),
    commandHint("Rerun due targets", `pnpm --silent cli sources run-due --source ${sourceAdapterId} --limit 10`, true, true),
    commandHint("Run one configured check", `pnpm --silent cli sources check --source ${sourceAdapterId} --config-file <target-config.json>`, true, true)
  ];
}

function observationCalibrationCommandHints(observationIds: readonly string[]): Gate1DataDepthCommandHint[] {
  const firstObservationId = observationIds[0] ?? "<observation-id>";
  return [
    commandHint(
      "Record observation label",
      `pnpm --silent cli intelligence observation-calibration-label ${firstObservationId} --label useful_signal --reviewer <reviewer> --rationale "<why this is a useful calibration sample>"`,
      true,
      true
    )
  ];
}

function corroborationCommandHints(item?: OfficialDisclosureCorroborationQueueItem): Gate1DataDepthCommandHint[] {
  const decision =
    item?.disposition === "needs_explicit_single_source_disposition" || item?.latest_disposition?.decision === "record_single_source_unknown"
      ? "record_single_source_unknown"
      : "needs_more_evidence";
  const edgeId = item?.edge_id ?? "<edge-id>";
  const firstTarget = item?.source_targets[0];
  const checkTargetFlag =
    firstTarget?.check_target_id === undefined || firstTarget.check_target_id === null ? "" : ` --check-target ${firstTarget.check_target_id}`;
  const unknownFlag = item?.proposed_unknown?.unknown_id === undefined ? "" : ` --unknown ${item.proposed_unknown.unknown_id}`;
  return [
    commandHint(
      "Record edge corroboration disposition",
      `pnpm --silent cli review edge-corroboration-disposition ${edgeId} --decision ${decision} --reviewer <reviewer> --reason "<why the second-source review is or is not enough>"${checkTargetFlag}${unknownFlag}`,
      true,
      true
    )
  ];
}

function frontierCommandHints(plan: SupplyChainExpansionPlan): Gate1DataDepthCommandHint[] {
  const nextCompanyId = plan.frontier.find((item) => item.next_company_id !== null)?.next_company_id ?? "<next-company-id>";
  return [
    commandHint(
      "Run recursive company research",
      `pnpm --silent cli research run --company ${nextCompanyId} --depth 3 --prepare-data --out <research-pack-out>`,
      true,
      true
    )
  ];
}

function adjacentOfficialFactCommandHints(
  candidates: readonly AdjacentCompanyCandidate[],
  componentId: string,
  researchContext: Gate1DataDepthResearchContext | undefined
): Gate1DataDepthCommandHint[] {
  if (candidates.length === 0) {
    return [
      commandHint(
        "Run adjacent official-fact company research",
        adjacentOfficialFactResearchCommand("<adjacent-company-id>", componentId, researchContext),
        true,
        true
      )
    ];
  }
  return candidates.map((candidate) =>
    commandHint(
      `Run adjacent official-fact research for ${candidate.company_name}`,
      adjacentOfficialFactResearchCommand(candidate.company_id, componentId, researchContext),
      true,
      true
    )
  );
}

function adjacentOfficialFactResearchCommand(companyId: string, componentId: string, researchContext: Gate1DataDepthResearchContext | undefined): string {
  const depth = researchContext?.depth ?? 3;
  const parts = ["pnpm --silent cli research run", `--company ${companyId}`, `--component ${componentId}`, `--depth ${depth}`, "--prepare-data"];
  if (researchContext?.research_target_profile_id !== undefined) parts.push(`--target-profile ${researchContext.research_target_profile_id}`);
  if (researchContext?.official_disclosure_year !== undefined) parts.push(`--official-year ${researchContext.official_disclosure_year}`);
  parts.push(`--source-target-namespace ${adjacentResearchNamespace(companyId)}`);
  parts.push(`--out ${adjacentResearchOutDir(companyId, componentId)}`);
  return parts.join(" ");
}

function adjacentResearchNamespace(companyId: string): string {
  return `research-${slugForCommand(companyId)}`;
}

function adjacentResearchOutDir(companyId: string, componentId: string): string {
  return `reports/${slugForCommand(companyId)}-${slugForCommand(componentId)}-research-pack`;
}

function slugForCommand(value: string): string {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function adjacentOfficialFactRankingContexts(
  componentId: string,
  candidates: readonly AdjacentCompanyCandidate[],
  rankingLabels: readonly Gate1DataDepthRankingCalibrationExistingLabel[]
): Gate1DataDepthRankingContext[] {
  if (candidates.length === 0) return [];
  const contextId = `ranking:adjacent-company:${componentId}:${ADJACENT_COMPANY_RANKING_MODEL_VERSION}`;
  return [
    {
      context_id: contextId,
      ranking_kind: "adjacent_company_candidate",
      model_version: ADJACENT_COMPANY_RANKING_MODEL_VERSION,
      policy: "candidate_generation_not_probability",
      calibration_status: "uncalibrated",
      needs_label: true,
      assumptions: [
        "Component or industry relevance is stronger than disclosure frequency for recursive upstream research.",
        "Likely upstream role is inferred from relation direction only as a candidate-generation feature.",
        "Edge frequency is only a tie-breaker and must not be interpreted as probability or relationship strength."
      ],
      candidates: candidates.map((candidate, index) => rankedCandidate(contextId, candidate, index + 1, rankingLabels))
    }
  ];
}

function rankedCandidate(
  contextId: string,
  candidate: AdjacentCompanyCandidate,
  rank: number,
  rankingLabels: readonly Gate1DataDepthRankingCalibrationExistingLabel[]
): Gate1DataDepthRankingContext["candidates"][number] {
  const labels = latestFirst(rankingLabels.filter((label) => label.ranking_context_id === contextId && label.candidate_entity_id === candidate.company_id));
  const latestLabel = labels[0] ?? null;
  return {
    candidate_id: `${contextId}:${candidate.company_id}`,
    rank,
    entity_id: candidate.company_id,
    entity_name: candidate.company_name,
    review_status: latestLabel === null ? "unlabeled" : "labeled",
    latest_label: latestLabel,
    existing_labels: labels,
    suggested_label: candidate.suggested_label,
    suggested_label_reason: candidate.suggested_label_reason,
    suggested_label_policy: candidate.suggestion_policy,
    ranking_reason: candidate.ranking_reason,
    score_breakdown: {
      component_relevance: candidate.component_relevance,
      upstream_role_edges: candidate.upstream_role_edges,
      max_evidence_level: candidate.max_evidence_level,
      max_confidence: candidate.max_confidence,
      edge_frequency_tiebreaker: candidate.edge_count
    }
  };
}

function latestFirst<T extends { reviewed_at: string; label_id: string }>(labels: readonly T[]): T[] {
  return [...labels].sort((left, right) => {
    const reviewedAt = right.reviewed_at.localeCompare(left.reviewed_at);
    if (reviewedAt !== 0) return reviewedAt;
    return right.label_id.localeCompare(left.label_id);
  });
}

function entityContextCommandHints(context: Gate1EntityAffiliationContext): Gate1DataDepthCommandHint[] {
  const dispositionHint = commandHint(
    "Record affiliation disposition",
    `pnpm --silent cli review entity-affiliation-disposition ${context.context_id} --subject ${context.subject_entity_id} --parent ${context.parent_entity_id} --decision research_parent_entity --reviewer <reviewer> --reason "<why the parent legal-entity scope is appropriate>"${entityContextOptionalRefFlags(
      context
    )}`,
    true,
    true
  );
  if (context.latest_disposition === null) return [dispositionHint];
  if (context.latest_disposition.decision !== "research_parent_entity" && context.latest_disposition.decision !== "research_both_scopes") return [];
  return [
    commandHint(
      "Run reviewed parent entity research loop",
      `pnpm --silent cli research run --company ${context.parent_entity_id} --depth 3 --prepare-data --out <research-pack-out>`,
      true,
      true
    )
  ];
}

function entityContextUnknownRationale(context: Gate1EntityAffiliationContext): string {
  if (context.parent_unknown_ids.length === 0) return "";
  return ` Parent scope already has explicit unknown(s): ${context.parent_unknown_ids.join(", ")}.`;
}

function entityContextUnknownAction(context: Gate1EntityAffiliationContext): string {
  if (context.parent_unknown_ids.length === 0) return "";
  return " Keep linked parent unknowns open until reviewed official evidence establishes the relationship scope.";
}

function entityContextOptionalRefFlags(context: Gate1EntityAffiliationContext): string {
  const edgeFlag = context.edge_ids.length === 0 ? "" : ` --edge ${context.edge_ids.join(",")}`;
  const componentFlag = context.component_ids.length === 0 ? "" : ` --component ${context.component_ids.join(",")}`;
  const unknownFlag = context.parent_unknown_ids.length === 0 ? "" : ` --unknown ${context.parent_unknown_ids.join(",")}`;
  return `${edgeFlag}${componentFlag}${unknownFlag}`;
}

function entityContextPriority(parentNode: OfficialDisclosureReadinessNode | undefined): Gate1DataDepthPriority {
  if (parentNode?.target_priority === "P0") return "P0";
  if (parentNode?.source_targets.some((target) => target.synced === true || target.runnable)) return "P1";
  return "P2";
}

function commandHint(label: string, command: string, writesTruthStore: boolean, requiresDatabase: boolean): Gate1DataDepthCommandHint {
  return { label, command, writes_truth_store: writesTruthStore, requires_database: requiresDatabase };
}

function workstreamForGap(kind: OfficialDisclosureReadinessGap["kind"]): Gate1DataDepthWorkstream {
  if (kind === "level_4_5_edge_coverage" || kind === "core_node_coverage") return "fact_edge_growth";
  if (kind === "expected_official_source_coverage" || kind === "traceability") return "source_blocker";
  if (kind === "corroboration_or_disposition_coverage") return "counterparty_corroboration";
  if (kind === "edge_strength" || kind === "edge_freshness") return "strength_context";
  return "fact_edge_growth";
}

function gapRefs(gap: OfficialDisclosureReadinessGap): string[] {
  return uniqueSorted([
    `gate1_gap:${gap.gap_id}`,
    ...gap.edge_ids.map((edgeId) => `edge:${edgeId}`),
    ...gap.component_ids.map((componentId) => `component:${componentId}`),
    ...gap.source_plan_refs.map((ref) => prefixedRef("source_plan", ref))
  ]);
}

function isSourceBlocked(item: SourceTargetCoverageItem): boolean {
  return (
    item.state === "retry_wait" ||
    item.state === "degraded" ||
    item.state === "dead" ||
    (item.latest_job !== null && item.latest_job.failure_kind !== null) ||
    item.latest_event?.event_type === "SOURCE_FAILED"
  );
}

function toCoverageSourceTargetRef(item: SourceTargetCoverageItem): Gate1DataDepthSourceTargetRef {
  return {
    check_target_id: item.matched_check_target_id ?? item.expected_target.check_target_id,
    source_adapter_id: item.expected_target.source_adapter_id,
    target_kind: item.expected_target.target_kind,
    state: item.state,
    latest_event_type: item.latest_event?.event_type ?? null,
    failure_kind: item.latest_job?.failure_kind ?? null,
    observations: item.observations,
    target_entity_id: targetConfigString(item, "entity_id"),
    target_component_id: targetConfigString(item, "component_id")
  };
}

function toSourceTargetRef(target: {
  check_target_id: string | null;
  source_adapter_id: string;
  target_kind: string;
  state: string | null;
  latest_event_type: string | null;
  observations: number | null;
  target_entity_id: string | null;
  target_component_id: string | null;
}): Gate1DataDepthSourceTargetRef {
  return {
    check_target_id: target.check_target_id,
    source_adapter_id: target.source_adapter_id,
    target_kind: target.target_kind,
    state: target.state,
    latest_event_type: target.latest_event_type,
    failure_kind: null,
    observations: target.observations,
    target_entity_id: target.target_entity_id,
    target_component_id: target.target_component_id
  };
}

function targetConfigString(item: SourceTargetCoverageItem, key: string): string | null {
  const value = item.expected_target.target_config[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function uniquePreserveOrder<TValue extends string>(values: readonly TValue[]): TValue[] {
  return [...new Set(values)];
}

function nonEmpty(value: string | null): value is string {
  return value !== null && value.length > 0;
}

function prefixedRef(prefix: string, value: string): string {
  return value.startsWith(`${prefix}:`) ? value : `${prefix}:${value}`;
}
