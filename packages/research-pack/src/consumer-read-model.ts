import type { WorkbenchChangeTimelineItem, WorkbenchModel } from "@supplystrata/workbench-export";
import type { ConsumerChangeItem, ConsumerConstraintContextSummary, ConsumerReadModel, ConsumerUnknownItem } from "./consumer-read-model-definitions.js";
import type { ResearchPackManifest } from "./definitions.js";
import type { Gate1DataDepthWorkbench } from "./gate1-data-depth-workbench.js";
import type { InvestigationBacklog } from "./investigation-backlog.js";
import type { PropagationReadinessItem, PropagationReadinessReport } from "./propagation-readiness.js";

export interface ConsumerReadModelInput {
  manifest: ResearchPackManifest;
  workbench: WorkbenchModel;
  propagation_readiness: PropagationReadinessReport;
  gate1_data_depth_workbench: Gate1DataDepthWorkbench;
  investigation_backlog: InvestigationBacklog;
}

export function buildConsumerReadModel(pack: ConsumerReadModelInput): ConsumerReadModel {
  const policyContext = policyOrExportControlContext(pack.propagation_readiness);
  return {
    schema_version: "1.0.0",
    contract_id: "gate8_lite_consumer_read_model.v0",
    generated_at: pack.manifest.generated_at,
    company: {
      selected_company_id: pack.manifest.selected_company_id,
      name: selectedCompanyName(pack.workbench),
      visible_companies: pack.workbench.companies.length
    },
    research_pack: {
      mode: pack.manifest.mode,
      depth: pack.manifest.depth,
      components: [...pack.manifest.components],
      fact_edges: pack.manifest.stats.fact_edges,
      evidences: pack.manifest.stats.evidences,
      l4_l5_fact_edges: pack.manifest.stats.official_disclosure_l4_l5_edges,
      traceable_edges: pack.manifest.stats.official_disclosure_traceable_edges,
      cross_source_edges: pack.manifest.stats.official_disclosure_cross_source_edges,
      corroboration_or_disposition_edges: pack.manifest.stats.official_disclosure_corroboration_or_disposition_edges,
      readiness: {
        question_ready: pack.manifest.stats.question_readiness_ready,
        question_partial: pack.manifest.stats.question_readiness_partial,
        question_blocked: pack.manifest.stats.question_readiness_blocked,
        gate1_overall_progress: pack.manifest.stats.official_disclosure_gate1_overall_progress,
        gate1_data_progress: pack.manifest.stats.official_disclosure_gate1_data_progress,
        gate1_source_path_progress: pack.manifest.stats.official_disclosure_gate1_source_path_progress
      }
    },
    chain: {
      segments: pack.workbench.chain_segments.length,
      upstream_edges: pack.workbench.upstream_edges.length,
      downstream_edges: pack.workbench.downstream_edges.length,
      component_ids: uniqueSorted(pack.workbench.edges.flatMap((edge) => (edge.component_id === null ? [] : [edge.component_id]))),
      counterparty_company_ids: counterpartyCompanyIds(pack.workbench)
    },
    changes: {
      total: pack.workbench.changes.length,
      requires_attention: pack.workbench.changes.filter((change) => change.requires_attention).length,
      by_family: countBy(pack.workbench.changes, (change) => change.event_family),
      latest: pack.workbench.changes.slice(0, 10).map(toConsumerChangeItem)
    },
    derived_context: {
      edge_strengths: pack.workbench.intelligence.edge_strengths.length,
      edge_freshness: pack.workbench.intelligence.edge_freshness.length,
      stale_edges: pack.workbench.intelligence.edge_freshness.filter((item) => item.freshness_score < 0.7).length,
      component_risk_scope: pack.manifest.component_risk_refresh?.scope_kind ?? "not_refreshed",
      component_risk_global_edges: pack.manifest.stats.component_risk_global_edges,
      component_risk_visible_edges: pack.manifest.stats.component_risk_visible_edges,
      component_risk_metrics: pack.manifest.stats.component_risk_metrics_written,
      component_risk_changes: pack.manifest.stats.component_risk_changes_recorded
    },
    constraints: policyContext,
    unknowns: {
      total: pack.workbench.unknown_items.length,
      open: pack.workbench.unknown_items.filter((item) => item.status === "open").length,
      resolved: pack.workbench.unknown_items.filter((item) => item.status === "resolved").length,
      by_scope_kind: countBy(pack.workbench.unknown_items, (item) => item.scope_kind),
      top_open: pack.workbench.unknown_items
        .filter((item) => item.status === "open")
        .slice(0, 10)
        .map(toConsumerUnknownItem)
    },
    next_actions: {
      total: pack.gate1_data_depth_workbench.summary.items,
      p0: pack.gate1_data_depth_workbench.summary.p0,
      p1: pack.gate1_data_depth_workbench.summary.p1,
      p2: pack.gate1_data_depth_workbench.summary.p2,
      by_frontend_action: countBy(pack.gate1_data_depth_workbench.items, (item) => item.frontend_action_kind),
      top_items: pack.gate1_data_depth_workbench.items.slice(0, 12).map((item) => ({
        item_id: item.item_id,
        priority: item.priority,
        workstream: item.workstream,
        frontend_action_kind: item.frontend_action_kind,
        title: item.title,
        recommended_action: item.recommended_action,
        write_impact: item.write_impact,
        refs: item.refs.slice(0, 12)
      }))
    },
    source_monitoring: {
      expected_targets: pack.manifest.stats.source_target_expected_targets,
      synced_targets: pack.manifest.stats.source_target_synced_targets,
      not_synced: pack.manifest.stats.source_target_not_synced,
      due_targets: pack.manifest.stats.source_target_due_targets,
      active_jobs: pack.manifest.stats.source_target_active_jobs,
      degraded_targets: pack.manifest.stats.source_target_degraded_targets,
      dead_targets: pack.manifest.stats.source_target_dead_targets,
      missing_credentials: pack.manifest.stats.source_target_failure_kinds["missing_credentials"] ?? 0,
      invalid_config: pack.manifest.stats.source_target_failure_kinds["target_config_invalid"] ?? 0,
      source_unreachable: pack.manifest.stats.source_target_failure_kinds["source_unreachable"] ?? 0,
      targets_with_observations: pack.manifest.stats.source_target_targets_with_observations,
      total_observations: pack.manifest.stats.source_target_total_observations
    },
    policy: {
      read_policy: "read_only_no_truth_store_mutation",
      fact_mutation_allowed: false,
      intended_consumers: ["api", "host_app", "static_report", "future_safe_ai"]
    }
  };
}

function selectedCompanyName(workbench: Pick<WorkbenchModel, "companies" | "selected_company_id">): string {
  return workbench.companies.find((company) => company.entity_id === workbench.selected_company_id)?.name ?? workbench.selected_company_id;
}

function counterpartyCompanyIds(workbench: Pick<WorkbenchModel, "edges" | "selected_company_id">): string[] {
  return uniqueSorted(
    workbench.edges.flatMap((edge) => {
      const ids: string[] = [];
      if (edge.from_id !== workbench.selected_company_id) ids.push(edge.from_id);
      if (edge.to_id !== workbench.selected_company_id) ids.push(edge.to_id);
      return ids;
    })
  );
}

function toConsumerChangeItem(change: WorkbenchChangeTimelineItem): ConsumerChangeItem {
  return {
    event_id: change.event_id,
    event_family: change.event_family,
    event_type: change.event_type,
    occurred_at: change.occurred_at,
    requires_attention: change.requires_attention,
    scope_kind: change.scope_kind ?? null,
    scope_id: change.scope_id ?? null
  };
}

function toConsumerUnknownItem(item: { unknown_id: string; scope_kind: string; scope_id: string; question: string }): ConsumerUnknownItem {
  return {
    unknown_id: item.unknown_id,
    scope_kind: item.scope_kind,
    scope_id: item.scope_id,
    question: item.question
  };
}

function policyOrExportControlContext(report: PropagationReadinessReport): ConsumerConstraintContextSummary {
  const context = report.items.find((item) => item.context_kind === "policy_or_export_control_signal");
  if (context === undefined) {
    return {
      policy_or_export_control_status: "blocked",
      policy_or_export_control_sources: 0,
      policy_or_export_control_observations: 0,
      policy_or_export_control_missing_requirements: ["No policy/export-control propagation context is present in this research pack."],
      truth_store_write_policy: "constraint_context_only_no_fact_mutation"
    };
  }
  return {
    policy_or_export_control_status: context.status,
    policy_or_export_control_sources: context.source_plan_refs.length,
    policy_or_export_control_observations: context.observation_series_refs.length,
    policy_or_export_control_missing_requirements: [...context.missing_requirements],
    truth_store_write_policy: "constraint_context_only_no_fact_mutation"
  };
}

function countBy<T>(items: readonly T[], keyFor: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyFor(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
