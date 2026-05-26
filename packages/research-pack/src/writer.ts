import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderChainCard, renderCompanyCard, renderComponentCard } from "@supplystrata/render";
import type { WorkbenchModel } from "@supplystrata/workbench-export";
import {
  CORROBORATION_SOURCE_PLAN_ACTION_BATCHES,
  buildCorroborationSourcePlanActionBatch,
  renderCorroborationSourcePlanMarkdown,
  type CorroborationSourcePlan
} from "./corroboration-source-plan.js";
import {
  GATE1_DATA_DEPTH_ACTION_BATCHES,
  buildGate1DataDepthActionBatch,
  renderGate1DataDepthWorkbenchMarkdown,
  type Gate1DataDepthWorkbench
} from "./gate1-data-depth-workbench.js";
import type { ResearchPackFile, ResearchPackModel, WorkbenchSnapshotPackModel, WrittenResearchPack } from "./definitions.js";
import { renderInvestigationBacklogMarkdown } from "./investigation-backlog.js";
import { renderGate1RunLedgerMarkdown } from "./gate1-run-ledger-render.js";
import { renderObservationCoverageMarkdown } from "./observation-coverage.js";
import { renderOfficialDisclosureReadinessMarkdown } from "./official-disclosure-readiness.js";
import { renderPropagationReadinessMarkdown } from "./propagation-readiness.js";
import { renderQuestionReadinessMarkdown } from "./question-readiness.js";
import { renderSourceTargetCoverageMarkdown } from "./source-target-coverage.js";
import { renderSourceTargetPreflightMarkdown, type SourceTargetPreflightReport } from "./source-target-preflight.js";
import { renderSupplyChainExpansionPlanMarkdown } from "./supply-chain-expansion-plan.js";

export async function writeResearchPack(outDir: string, pack: ResearchPackModel): Promise<WrittenResearchPack> {
  await mkdir(outDir, { recursive: true });
  await mkdir(join(outDir, "components"), { recursive: true });

  const files: ResearchPackFile[] = [
    await writeJsonFile(outDir, "manifest.json", pack.manifest, "Research pack manifest"),
    await writeJsonFile(outDir, "workbench.json", pack.workbench, "Workbench JSON consumed by apps/research-preview"),
    await writeJsonFile(
      outDir,
      "attention-queue.json",
      { schema_version: "1.0.0", attention_queue: pack.workbench.attention_queue },
      "Unified attention queue from claim review, alerts, source health, and semantic changes"
    ),
    await writeMarkdownFile(outDir, "attention-queue.md", renderAttentionQueueMarkdown(pack.workbench), "Unified attention queue markdown"),
    await writeJsonFile(outDir, "source-plan.json", { schema_version: "1.0.0", source_plan: pack.source_plan }, "Source plan for existing component coverage"),
    await writeJsonFile(outDir, "quality.json", pack.data_quality, "Data quality summary"),
    await writeJsonFile(outDir, "company.json", { schema_version: "1.0.0", company: pack.company }, "Company card JSON"),
    await writeMarkdownFile(outDir, "company.md", renderCompanyCard(pack.company, "markdown"), "Company card markdown"),
    await writeJsonFile(outDir, "question-readiness.json", pack.question_readiness, "Question readiness matrix"),
    await writeMarkdownFile(outDir, "question-readiness.md", renderQuestionReadinessMarkdown(pack.question_readiness), "Question readiness matrix markdown"),
    await writeJsonFile(outDir, "observation-coverage.json", pack.observation_coverage, "Observation signal coverage"),
    await writeMarkdownFile(
      outDir,
      "observation-coverage.md",
      renderObservationCoverageMarkdown(pack.observation_coverage),
      "Observation signal coverage markdown"
    ),
    await writeJsonFile(outDir, "official-disclosure-readiness.json", pack.official_disclosure_readiness, "Official disclosure coverage readiness"),
    await writeMarkdownFile(
      outDir,
      "official-disclosure-readiness.md",
      renderOfficialDisclosureReadinessMarkdown(pack.official_disclosure_readiness),
      "Official disclosure coverage readiness markdown"
    ),
    await writeJsonFile(outDir, "supply-chain-expansion-plan.json", pack.supply_chain_expansion_plan, "Recursive supply-chain expansion plan"),
    await writeMarkdownFile(
      outDir,
      "supply-chain-expansion-plan.md",
      renderSupplyChainExpansionPlanMarkdown(pack.supply_chain_expansion_plan),
      "Recursive supply-chain expansion plan markdown"
    ),
    await writeJsonFile(outDir, "propagation-readiness.json", pack.propagation_readiness, "Structured propagation reasoning readiness"),
    await writeMarkdownFile(
      outDir,
      "propagation-readiness.md",
      renderPropagationReadinessMarkdown(pack.propagation_readiness),
      "Structured propagation reasoning readiness markdown"
    ),
    await writeJsonFile(outDir, "gate1-data-depth-workbench.json", pack.gate1_data_depth_workbench, "Gate 1 data-depth execution workbench"),
    await writeMarkdownFile(
      outDir,
      "gate1-data-depth-workbench.md",
      renderGate1DataDepthWorkbenchMarkdown(pack.gate1_data_depth_workbench),
      "Gate 1 data-depth execution workbench markdown"
    ),
    ...(await gate1DataDepthActionBatchFiles(outDir, pack.gate1_data_depth_workbench)),
    await writeJsonFile(outDir, "gate1-run-ledger.json", pack.gate1_run_ledger, "Gate 1 execution ledger"),
    await writeMarkdownFile(outDir, "gate1-run-ledger.md", renderGate1RunLedgerMarkdown(pack.gate1_run_ledger), "Gate 1 execution ledger markdown"),
    await writeJsonFile(outDir, "investigation-backlog.json", pack.investigation_backlog, "Investigation backlog"),
    await writeMarkdownFile(
      outDir,
      "investigation-backlog.md",
      renderInvestigationBacklogMarkdown(pack.investigation_backlog),
      "Investigation backlog markdown"
    ),
    await writeJsonFile(outDir, "corroboration-source-plan.json", pack.corroboration_source_plan, "Filtered source plan for edge corroboration review targets"),
    await writeMarkdownFile(
      outDir,
      "corroboration-source-plan.md",
      renderCorroborationSourcePlanMarkdown(pack.corroboration_source_plan),
      "Filtered source plan for edge corroboration review targets markdown"
    ),
    ...(await corroborationSourcePlanActionBatchFiles(outDir, pack.corroboration_source_plan)),
    await writeJsonFile(outDir, "source-target-coverage.json", pack.source_target_coverage, "Source target coverage from source monitor"),
    await writeMarkdownFile(
      outDir,
      "source-target-coverage.md",
      renderSourceTargetCoverageMarkdown(pack.source_target_coverage),
      "Source target coverage markdown"
    ),
    ...(await sourceTargetPreflightFiles(outDir, pack.source_target_preflight)),
    await writeJsonFile(outDir, "chain.json", pack.chain, "ChainView JSON"),
    await writeMarkdownFile(outDir, "chain.md", renderChainCard(pack.chain, "markdown"), "ChainView markdown"),
    await writeMarkdownFile(outDir, "README.md", renderResearchPackReadme(pack), "Research pack table of contents")
  ];

  for (const component of pack.components) {
    const name = safeFileSegment(component.component.component_id);
    files.push(
      await writeJsonFile(
        outDir,
        `components/${name}.json`,
        { schema_version: "1.0.0", component },
        `Component card JSON for ${component.component.component_id}`
      )
    );
    files.push(
      await writeMarkdownFile(
        outDir,
        `components/${name}.md`,
        renderComponentCard(component, "markdown"),
        `Component card markdown for ${component.component.component_id}`
      )
    );
  }

  const manifest = { ...pack.manifest, files: sortFiles(files) };
  await writeJsonFile(outDir, "manifest.json", manifest, "Research pack manifest");
  return { out_dir: outDir, manifest };
}

export async function writeWorkbenchSnapshotPack(outDir: string, pack: WorkbenchSnapshotPackModel): Promise<WrittenResearchPack> {
  await mkdir(outDir, { recursive: true });
  const files: ResearchPackFile[] = [
    await writeJsonFile(outDir, "manifest.json", pack.manifest, "Research snapshot manifest"),
    await writeJsonFile(outDir, "workbench.json", pack.workbench, "Workbench JSON consumed by apps/research-preview"),
    await writeJsonFile(
      outDir,
      "attention-queue.json",
      { schema_version: "1.0.0", attention_queue: pack.workbench.attention_queue },
      "Unified attention queue from the Workbench export"
    ),
    await writeMarkdownFile(outDir, "attention-queue.md", renderAttentionQueueMarkdown(pack.workbench), "Unified attention queue markdown"),
    await writeJsonFile(outDir, "chain.json", pack.chain, "ChainView JSON copied from the Workbench export"),
    await writeMarkdownFile(outDir, "chain.md", renderChainCard(pack.chain, "markdown"), "ChainView markdown"),
    await writeJsonFile(
      outDir,
      "source-plan.json",
      { schema_version: "1.0.0", source_plan: pack.source_plan },
      "Source plan derived from the Workbench components"
    ),
    await writeJsonFile(outDir, "question-readiness.json", pack.question_readiness, "Question readiness matrix"),
    await writeMarkdownFile(outDir, "question-readiness.md", renderQuestionReadinessMarkdown(pack.question_readiness), "Question readiness matrix markdown"),
    await writeJsonFile(outDir, "observation-coverage.json", pack.observation_coverage, "Observation signal coverage"),
    await writeMarkdownFile(
      outDir,
      "observation-coverage.md",
      renderObservationCoverageMarkdown(pack.observation_coverage),
      "Observation signal coverage markdown"
    ),
    await writeJsonFile(outDir, "official-disclosure-readiness.json", pack.official_disclosure_readiness, "Official disclosure coverage readiness"),
    await writeMarkdownFile(
      outDir,
      "official-disclosure-readiness.md",
      renderOfficialDisclosureReadinessMarkdown(pack.official_disclosure_readiness),
      "Official disclosure coverage readiness markdown"
    ),
    await writeJsonFile(outDir, "supply-chain-expansion-plan.json", pack.supply_chain_expansion_plan, "Recursive supply-chain expansion plan"),
    await writeMarkdownFile(
      outDir,
      "supply-chain-expansion-plan.md",
      renderSupplyChainExpansionPlanMarkdown(pack.supply_chain_expansion_plan),
      "Recursive supply-chain expansion plan markdown"
    ),
    await writeJsonFile(outDir, "propagation-readiness.json", pack.propagation_readiness, "Structured propagation reasoning readiness"),
    await writeMarkdownFile(
      outDir,
      "propagation-readiness.md",
      renderPropagationReadinessMarkdown(pack.propagation_readiness),
      "Structured propagation reasoning readiness markdown"
    ),
    await writeJsonFile(outDir, "gate1-data-depth-workbench.json", pack.gate1_data_depth_workbench, "Gate 1 data-depth execution workbench"),
    await writeMarkdownFile(
      outDir,
      "gate1-data-depth-workbench.md",
      renderGate1DataDepthWorkbenchMarkdown(pack.gate1_data_depth_workbench),
      "Gate 1 data-depth execution workbench markdown"
    ),
    ...(await gate1DataDepthActionBatchFiles(outDir, pack.gate1_data_depth_workbench)),
    await writeJsonFile(outDir, "gate1-run-ledger.json", pack.gate1_run_ledger, "Gate 1 execution ledger"),
    await writeMarkdownFile(outDir, "gate1-run-ledger.md", renderGate1RunLedgerMarkdown(pack.gate1_run_ledger), "Gate 1 execution ledger markdown"),
    await writeJsonFile(outDir, "investigation-backlog.json", pack.investigation_backlog, "Investigation backlog"),
    await writeMarkdownFile(
      outDir,
      "investigation-backlog.md",
      renderInvestigationBacklogMarkdown(pack.investigation_backlog),
      "Investigation backlog markdown"
    ),
    await writeJsonFile(outDir, "corroboration-source-plan.json", pack.corroboration_source_plan, "Filtered source plan for edge corroboration review targets"),
    await writeMarkdownFile(
      outDir,
      "corroboration-source-plan.md",
      renderCorroborationSourcePlanMarkdown(pack.corroboration_source_plan),
      "Filtered source plan for edge corroboration review targets markdown"
    ),
    ...(await corroborationSourcePlanActionBatchFiles(outDir, pack.corroboration_source_plan)),
    await writeJsonFile(outDir, "source-target-coverage.json", pack.source_target_coverage, "Expected source target coverage"),
    await writeMarkdownFile(
      outDir,
      "source-target-coverage.md",
      renderSourceTargetCoverageMarkdown(pack.source_target_coverage),
      "Expected source target coverage markdown"
    ),
    ...(await sourceTargetPreflightFiles(outDir, pack.source_target_preflight)),
    await writeJsonFile(
      outDir,
      "evidence-index.json",
      { schema_version: "1.0.0", evidences: pack.workbench.evidences },
      "Evidence records included in the Workbench export"
    ),
    await writeMarkdownFile(outDir, "README.md", renderWorkbenchSnapshotReadme(pack), "Research snapshot table of contents")
  ];

  const manifest = { ...pack.manifest, files: sortFiles(files) };
  await writeJsonFile(outDir, "manifest.json", manifest, "Research snapshot manifest");
  return { out_dir: outDir, manifest };
}

export function safeFileSegment(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (cleaned.length === 0) throw new Error(`Cannot create a file name from empty value: ${value}`);
  return cleaned;
}

function renderResearchPackReadme(pack: ResearchPackModel): string {
  const lines = [
    `# Research Pack ${pack.company.entity.canonical_name}`,
    "",
    `Generated at: ${pack.manifest.generated_at}`,
    `Company: ${pack.company.entity.canonical_name} [${pack.manifest.selected_company_id}]`,
    `Depth: ${pack.manifest.depth}`,
    "",
    "## Stats",
    "",
    ...researchPackStatsLines(pack, "truth_store"),
    "",
    "## Files",
    "",
    "- `workbench.json` feeds the TypeScript research preview.",
    "- `attention-queue.json` and `attention-queue.md` unify immediate review items from claim conflicts, claim lifecycle warnings, alert candidates, degraded source monitors, and semantic changes.",
    "- `chain.md` and `company.md` are human-readable research cards with intelligence context.",
    "- `question-readiness.json` and `question-readiness.md` show which core supply-chain questions are ready, partial, or blocked.",
    "- `observation-coverage.json` and `observation-coverage.md` summarize typed signal coverage and methodology gaps.",
    "- `official-disclosure-readiness.json` and `official-disclosure-readiness.md` show Gate 1 node/source coverage, traceability, corroboration, and intelligence-context gaps.",
    "- `supply-chain-expansion-plan.json` and `supply-chain-expansion-plan.md` turn the current L4/L5 fact frontier into the next evidence-first recursive research plan. It does not write facts.",
    "- `propagation-readiness.json` and `propagation-readiness.md` prepare demand, capacity, facility, equipment, process-material, price/trade, and policy reasoning inputs for future AI/frontend analysis. They do not write facts.",
    "- `gate1-data-depth-workbench.json` and `gate1-data-depth-workbench.md` rank the highest-value data-depth moves across L4/L5 growth, adjacent official facts, entity affiliation context, counterparty corroboration, source blockers, strength gaps, observation calibration, and propagation context. `gate1-data-depth-p0.json`, `gate1-data-depth-source-blockers.json`, `gate1-data-depth-labeling.json`, `gate1-data-depth-corroboration.json`, `gate1-data-depth-entity-context.json`, `gate1-data-depth-adjacent-facts.json`, and `gate1-data-depth-intelligence-context.json`, when non-empty, split that workbench into frontend-ready review/action batches. They are review-only.",
    "- `gate1-run-ledger.json` and `gate1-run-ledger.md` merge readiness, source-target coverage, corroboration batches, and frontier switching into one deterministic execution ledger.",
    "- `investigation-backlog.json` and `investigation-backlog.md` turn readiness gaps and unknowns into auditable next investigation steps.",
    "- `corroboration-source-plan.json` and `corroboration-source-plan.md` filter the source plan down to edge-level corroboration targets that can be previewed, smoked, synced, or enabled by the existing source commands. When non-empty, `corroboration-source-plan-smoke.json`, `corroboration-source-plan-sync.json`, `corroboration-source-plan-enable.json`, and `corroboration-source-plan-run-due.json` split that plan by audited next action.",
    "- `source-target-coverage.json` and `source-target-coverage.md` show whether runnable source-plan targets are synced, enabled, due, running, failed, or producing observations.",
    "- `source-target-preflight.json` and `source-target-preflight.md`, when present, carry an explicit no-database source-plan smoke result. They do not imply fact coverage.",
    "- `components/*.md` contains component-level evidence, observation, strength, freshness, and unknown context.",
    "- `source-plan.json` lists which existing free/public sources should be checked next.",
    "- `quality.json` records data-quality checks for audit."
  ];
  return lines.join("\n");
}

function renderWorkbenchSnapshotReadme(pack: WorkbenchSnapshotPackModel): string {
  const lines = [
    `# Research Snapshot ${pack.workbench.chain.root.name}`,
    "",
    `Generated at: ${pack.manifest.generated_at}`,
    `Company: ${pack.workbench.chain.root.name} [${pack.manifest.selected_company_id}]`,
    `Depth: ${pack.manifest.depth}`,
    "",
    "This pack was built from an existing Workbench JSON export. It does not refresh the SQL truth store, rebuild claims, or run data-quality checks.",
    "",
    "## Stats",
    "",
    ...researchPackStatsLines(pack, "workbench_snapshot"),
    "",
    "## Files",
    "",
    "- `workbench.json` feeds the TypeScript research preview.",
    "- `attention-queue.json` and `attention-queue.md` unify immediate review items carried by the packaged workbench context.",
    "- `chain.md` is a human-readable chain view.",
    "- `question-readiness.json` and `question-readiness.md` summarize answer readiness from the packaged workbench context.",
    "- `observation-coverage.json` and `observation-coverage.md` summarize typed signal coverage visible from the snapshot.",
    "- `official-disclosure-readiness.json` and `official-disclosure-readiness.md` show Gate 1 node/source coverage, traceability, corroboration, and intelligence-context gaps.",
    "- `supply-chain-expansion-plan.json` and `supply-chain-expansion-plan.md` turn the current L4/L5 fact frontier into the next evidence-first recursive research plan. It does not write facts.",
    "- `propagation-readiness.json` and `propagation-readiness.md` prepare demand, capacity, facility, equipment, process-material, price/trade, and policy reasoning inputs for future AI/frontend analysis. They do not write facts.",
    "- `gate1-data-depth-workbench.json` and `gate1-data-depth-workbench.md` rank the highest-value data-depth moves across L4/L5 growth, adjacent official facts, entity affiliation context, counterparty corroboration, source blockers, strength gaps, observation calibration, and propagation context. `gate1-data-depth-p0.json`, `gate1-data-depth-source-blockers.json`, `gate1-data-depth-labeling.json`, `gate1-data-depth-corroboration.json`, `gate1-data-depth-entity-context.json`, `gate1-data-depth-adjacent-facts.json`, and `gate1-data-depth-intelligence-context.json`, when non-empty, split that workbench into frontend-ready review/action batches. They are review-only.",
    "- `gate1-run-ledger.json` and `gate1-run-ledger.md` merge readiness, source-target coverage, corroboration batches, and frontier switching into one deterministic execution ledger.",
    "- `investigation-backlog.json` and `investigation-backlog.md` turn readiness gaps and unknowns into auditable next investigation steps.",
    "- `corroboration-source-plan.json` and `corroboration-source-plan.md` filter the source plan down to edge-level corroboration targets that can be previewed, smoked, synced, or enabled by the existing source commands. When non-empty, `corroboration-source-plan-smoke.json`, `corroboration-source-plan-sync.json`, `corroboration-source-plan-enable.json`, and `corroboration-source-plan-run-due.json` split that plan by audited next action.",
    "- `source-target-coverage.json` and `source-target-coverage.md` show expected runnable targets as `not_synced` until a SQL truth store syncs them into `source_check_targets`.",
    "- `source-target-preflight.json` and `source-target-preflight.md`, when present, carry an explicit no-database source-plan smoke result. They do not imply fact coverage.",
    "- `source-plan.json` lists existing free/public source checks suggested by the components in this workbench.",
    "- `evidence-index.json` contains the evidence records carried by the workbench export."
  ];
  return lines.join("\n");
}

function researchPackStatsLines(
  pack: Pick<ResearchPackModel, "manifest"> | Pick<WorkbenchSnapshotPackModel, "manifest">,
  mode: ResearchPackModel["manifest"]["mode"]
): string[] {
  const stats = pack.manifest.stats;
  const commonLines = [
    `- Fact edges: ${stats.fact_edges}`,
    `- Claims: ${stats.claims}`,
    `- Claim conflicts: ${stats.claim_conflicts}`,
    `- Contradicting evidence links: ${stats.contradicting_evidence_links}`,
    `- Claim lifecycle warnings: ${stats.claim_lifecycle_warnings}`,
    `- Attention queue items: ${stats.attention_items}`,
    `- Review candidates: ${stats.review_candidates}; official disclosure signals ${stats.open_official_disclosure_signal_review_candidates}/${stats.official_disclosure_signal_review_candidates} open; signal dispositions ${stats.official_disclosure_signal_dispositions}; correlation hints ${stats.open_official_disclosure_signal_correlation_hints}/${stats.official_disclosure_signal_correlation_hints} open`,
    `- Evidence records: ${stats.evidences}`,
    `- Unknown items: ${stats.unknown_items}`,
    pack.manifest.root_unknown_materialization === null
      ? "- Root unknown materialization: not run"
      : `- Root unknown materialization: ${pack.manifest.root_unknown_materialization.unknowns_inserted} inserted, ${pack.manifest.root_unknown_materialization.unknowns_updated} updated, ${pack.manifest.root_unknown_materialization.companies_with_l4_l5_edges} already fact-covered`,
    `- Intelligence strengths: ${stats.intelligence_edge_strengths}`,
    `- Intelligence freshness records: ${stats.intelligence_edge_freshness}`,
    `- Research target profile: ${pack.manifest.research_target_profile === null ? "none" : `${pack.manifest.research_target_profile.profile_id} (${pack.manifest.research_target_profile.target_nodes} target nodes)`}`,
    `- Gate 1 scorecard: overall ${formatReadmePercent(stats.official_disclosure_gate1_overall_progress)}, data ${formatReadmePercent(stats.official_disclosure_gate1_data_progress)}, source paths ${formatReadmePercent(stats.official_disclosure_gate1_source_path_progress)}`,
    `- Official disclosure readiness: ${stats.official_disclosure_visible_nodes} visible nodes, ${stats.official_disclosure_target_nodes} explicit targets (${stats.official_disclosure_nodes_with_fact_edges} fact-covered, ${stats.official_disclosure_nodes_missing_coverage} missing), ${stats.official_disclosure_l4_l5_edges} L4/L5 edges, ${stats.official_disclosure_cross_source_edges} cross-source`,
    `- Official disclosure corroboration queue: ${stats.official_disclosure_corroboration_queue_items} edges; ${stats.official_disclosure_corroboration_queue_with_runnable_targets} with runnable target; ${stats.official_disclosure_corroboration_queue_needing_disposition} need explicit disposition; ${stats.official_disclosure_corroboration_queue_recorded_disposition} recorded; ${stats.official_disclosure_corroboration_queue_proposed_unknowns} proposed unknowns`,
    `- Official disclosure profile expansion candidates: ${stats.official_disclosure_profile_expansion_candidates}`,
    `- Official disclosure expected sources: ${stats.official_disclosure_expected_source_links_with_coverage}/${stats.official_disclosure_expected_source_links} covered; ${stats.official_disclosure_expected_source_links_runnable} runnable paths; ${stats.official_disclosure_expected_source_links_connector_available} connector-only; ${stats.official_disclosure_expected_source_links_unimplemented} unimplemented; ${stats.official_disclosure_expected_source_links_missing} missing mappings`,
    `- Official disclosure gaps: ${stats.official_disclosure_gaps} open (${stats.official_disclosure_p0_gaps} P0)`,
    `- Official disclosure targets: ${stats.official_disclosure_synced_targets}/${stats.official_disclosure_runnable_targets} synced; ${stats.official_disclosure_due_targets} due; ${stats.official_disclosure_degraded_targets} degraded`,
    `- Official disclosure review signals: ${stats.open_official_disclosure_signal_review_candidates}/${stats.official_disclosure_signal_review_candidates} open`,
    `- Official disclosure signal correlation hints: ${stats.open_official_disclosure_signal_correlation_hints}/${stats.official_disclosure_signal_correlation_hints} open; dispositions ${stats.official_disclosure_signal_dispositions}`,
    `- Supply-chain expansion plan: ${stats.supply_chain_expansion_frontier_edges} frontier edges, ${stats.supply_chain_expansion_frontier_companies} frontier companies, ${stats.supply_chain_expansion_component_dependency_leads} component leads (${stats.supply_chain_expansion_leads_with_source_path} with source path: ${stats.supply_chain_expansion_leads_with_fact_capable_source_path} fact-capable, ${stats.supply_chain_expansion_leads_with_observation_source_path} observation-only, ${stats.supply_chain_expansion_leads_with_lead_only_source_path} lead-only), ${stats.supply_chain_expansion_stop_conditions} stop conditions`,
    `- Propagation readiness: ${stats.propagation_readiness_ready} ready, ${stats.propagation_readiness_partial} partial, ${stats.propagation_readiness_blocked} blocked; observations ${stats.propagation_contexts_with_observations}, source paths ${stats.propagation_contexts_with_source_plan}, component leads ${stats.propagation_contexts_with_component_leads}, reasoning inputs ${stats.propagation_reasoning_inputs}`,
    `- Gate 1 data-depth workbench: ${stats.gate1_data_depth_items} items (${stats.gate1_data_depth_p0} P0, ${stats.gate1_data_depth_p1} P1, ${stats.gate1_data_depth_p2} P2); workstreams ${formatStatsCountMap(stats.gate1_data_depth_by_workstream)}; fact edge gap ${stats.gate1_data_depth_fact_edge_gap}; adjacent official facts ${stats.gate1_data_depth_adjacent_official_fact_edges}; source blockers ${stats.gate1_data_depth_source_blockers}; entity context ${stats.gate1_data_depth_entity_context_items}; missing strength ${stats.gate1_data_depth_strength_missing_edges}; labeling batch ${stats.gate1_data_depth_observation_labeling_batch}; propagation not ready ${stats.gate1_data_depth_propagation_contexts_not_ready}; ranking labels ${stats.gate1_data_depth_ranking_labeled_candidates}/${stats.gate1_data_depth_ranking_calibration_candidates} persisted ${formatStatsCountMap(stats.gate1_data_depth_ranking_labels_by_persisted_label)}`,
    `- Observation records: ${stats.observation_records}`,
    `- Observation types present: ${stats.observation_types_present}`,
    `- Observation series readiness: ${stats.observation_time_series_ready} time-series ready, ${stats.observation_explicit_baseline_ready} explicit-baseline ready, ${stats.observation_sparse_series} sparse`,
    `- Observation methodology types missing: ${stats.observation_methodology_types_missing}`,
    `- Component risk views refreshed: ${stats.component_risk_views_refreshed}`,
    `- Component risk metrics written: ${stats.component_risk_metrics_written}`,
    `- Question readiness: ${stats.question_readiness_ready} ready, ${stats.question_readiness_partial} partial, ${stats.question_readiness_blocked} blocked`,
    `- Investigation backlog: ${stats.investigation_backlog_items} open (${stats.investigation_backlog_p0} P0, ${stats.investigation_backlog_p1} P1); ${stats.investigation_backlog_propagation_readiness_items} propagation readiness items; ${stats.investigation_backlog_corroboration_reviews} corroboration reviews (${stats.investigation_backlog_corroboration_review_runnable_targets} runnable targets, ${stats.investigation_backlog_corroboration_review_need_sync} need sync, ${stats.investigation_backlog_corroboration_review_need_enable} need enable, ${stats.investigation_backlog_corroboration_review_due} due, ${stats.investigation_backlog_corroboration_review_failed_preflight} failed preflight, ${stats.investigation_backlog_corroboration_review_explicit_disposition_only} disposition-only)`,
    `- Corroboration source plan: ${stats.corroboration_source_plan_targets} runnable targets across ${stats.corroboration_source_plan_edges} review edges (${stats.corroboration_source_plan_need_sync} need sync, ${stats.corroboration_source_plan_need_enable} need enable, ${stats.corroboration_source_plan_due} due, ${stats.corroboration_source_plan_failed_preflight} failed preflight; next actions ${formatStatsCountMap(stats.corroboration_source_plan_next_actions)})`,
    mode === "truth_store"
      ? `- Source target coverage: ${stats.source_target_synced_targets}/${stats.source_target_expected_targets} synced; ${stats.source_target_due_targets} due; ${stats.source_target_retry_wait} retry_wait; ${stats.source_target_source_failed_targets} source_failed; ${stats.source_target_targets_with_observations} targets with ${stats.source_target_total_observations} observations across ${stats.source_target_observed_subject_entities} subjects; observations by source ${formatStatsCountMap(stats.source_target_observations_by_source)}; observations by metric ${formatStatsCountMap(stats.source_target_observations_by_metric)}; review seeds ${stats.source_target_observation_review_items} (${stats.source_target_observation_review_p0} P0, ${stats.source_target_observation_review_p1} P1, ${stats.source_target_observation_review_p2} P2); calibration candidates ${stats.source_target_observation_calibration_candidates} (${formatStatsCountMap(stats.source_target_observation_calibration_by_label)} recommended, ${stats.source_target_observation_calibration_labeled_candidates} labeled, ${stats.source_target_observation_calibration_unlabeled_candidates} unlabeled, persisted ${formatStatsCountMap(stats.source_target_observation_calibration_by_persisted_label)}, next labeling batch ${stats.source_target_observation_calibration_next_labeling_batch} with priority ${formatStatsCountMap(stats.source_target_observation_calibration_next_labeling_batch_by_priority)} and metric ${formatStatsCountMap(stats.source_target_observation_calibration_next_labeling_batch_by_metric)}); failures ${formatStatsCountMap(stats.source_target_failure_kinds)}`
      : `- Source target coverage: ${stats.source_target_synced_targets}/${stats.source_target_expected_targets} synced; ${stats.source_target_not_synced} not synced`,
    `- Source target preflight: ${stats.source_target_preflight_checked_targets}/${stats.source_target_preflight_selected_targets} checked; ${stats.source_target_preflight_failed_targets} failed; ${stats.source_target_preflight_degraded_documents} degraded documents; ${stats.source_target_preflight_observation_drafts} observation drafts; ${stats.source_target_preflight_semantic_sections} semantic sections; issues ${formatStatsCountMap(stats.source_target_preflight_issue_kinds)}`,
    `- Source plan items: ${stats.source_plan_items}`,
    `- Runnable suggested source targets: ${stats.runnable_suggested_targets}`
  ];
  if (mode === "workbench_snapshot") return commonLines;
  return [...commonLines, `- Data quality errors: ${stats.data_quality_errors}`, `- Data quality warnings: ${stats.data_quality_warnings}`];
}

function formatReadmePercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function renderAttentionQueueMarkdown(workbench: WorkbenchModel): string {
  const lines = [
    "# Attention Queue",
    "",
    `Generated at: ${workbench.generated_at}`,
    `Company: ${workbench.chain.root.name} [${workbench.selected_company_id}]`,
    "",
    "This queue is derived from existing backend context. It does not create fact edges and does not resolve conflicts automatically.",
    "",
    "## Items",
    ""
  ];
  if (workbench.attention_queue.length === 0) {
    lines.push("No open attention items.");
    return lines.join("\n");
  }
  for (const item of workbench.attention_queue) {
    lines.push(`### ${item.priority} ${item.title}`);
    lines.push("");
    lines.push(`- ID: ${item.attention_id}`);
    lines.push(`- Kind: ${item.kind}`);
    lines.push(`- Status: ${item.status}`);
    lines.push(`- Scope: ${item.scope_kind}:${item.scope_id}`);
    lines.push(`- Detected at: ${item.detected_at ?? "unknown"}`);
    lines.push(`- Summary: ${item.summary}`);
    lines.push(`- Action: ${item.action}`);
    lines.push(`- Refs: ${item.refs.length === 0 ? "none" : item.refs.join(", ")}`);
    lines.push("");
  }
  return lines.join("\n");
}

function formatStatsCountMap(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return "none";
  return entries.map(([key, count]) => `${key}=${count}`).join(", ");
}

async function corroborationSourcePlanActionBatchFiles(outDir: string, plan: CorroborationSourcePlan): Promise<ResearchPackFile[]> {
  const files: ResearchPackFile[] = [];
  for (const definition of CORROBORATION_SOURCE_PLAN_ACTION_BATCHES) {
    const batch = buildCorroborationSourcePlanActionBatch(plan, definition);
    if (batch.summary.runnable_targets === 0) continue;
    files.push(await writeJsonFile(outDir, definition.file_name, batch, definition.description));
  }
  return files;
}

async function gate1DataDepthActionBatchFiles(outDir: string, workbench: Gate1DataDepthWorkbench): Promise<ResearchPackFile[]> {
  const files: ResearchPackFile[] = [];
  for (const definition of GATE1_DATA_DEPTH_ACTION_BATCHES) {
    const batch = buildGate1DataDepthActionBatch(workbench, definition);
    if (batch.summary.items === 0) continue;
    files.push(await writeJsonFile(outDir, definition.file_name, batch, definition.description));
  }
  return files;
}

async function sourceTargetPreflightFiles(outDir: string, report: SourceTargetPreflightReport | null): Promise<ResearchPackFile[]> {
  if (report === null) return [];
  return [
    await writeJsonFile(outDir, "source-target-preflight.json", report, "No-database source-plan smoke preflight report"),
    await writeMarkdownFile(
      outDir,
      "source-target-preflight.md",
      renderSourceTargetPreflightMarkdown(report),
      "No-database source-plan smoke preflight markdown"
    )
  ];
}

async function writeJsonFile(outDir: string, relativePath: string, value: unknown, description: string): Promise<ResearchPackFile> {
  await writeFile(join(outDir, relativePath), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return { path: relativePath, kind: "json", description };
}

async function writeMarkdownFile(outDir: string, relativePath: string, value: string, description: string): Promise<ResearchPackFile> {
  await writeFile(join(outDir, relativePath), `${value.trimEnd()}\n`, "utf8");
  return { path: relativePath, kind: "markdown", description };
}

function sortFiles(files: readonly ResearchPackFile[]): ResearchPackFile[] {
  return [...files].sort((left, right) => left.path.localeCompare(right.path));
}
