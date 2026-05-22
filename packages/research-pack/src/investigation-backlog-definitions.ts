import type { ComponentCardModel } from "@supplystrata/render";
import type { SourcePlanCheckTargetSuggestion, SourcePlanItem } from "@supplystrata/source-plan";
import type { SourceTargetCoverageState } from "@supplystrata/source-monitor";
import type { WorkbenchModel } from "@supplystrata/workbench-export";
import type { ObservationCoverageReport } from "./observation-coverage.js";
import type { OfficialDisclosureReadinessReport } from "./official-disclosure-readiness.js";
import type { QuestionReadinessMatrix } from "./question-readiness.js";
import type { SourceTargetCoverageReport } from "./source-target-coverage.js";
import type { SupplyChainExpansionPlan } from "./supply-chain-expansion-plan.js";
import type { SourceTargetPreflightIssueKind, SourceTargetPreflightReport, SourceTargetPreflightStatus } from "./source-target-preflight.js";

export type InvestigationBacklogKind =
  | "readiness_gap"
  | "unknown_resolution"
  | "component_coverage"
  | "source_check"
  | "observation_series"
  | "official_disclosure_coverage"
  | "corroboration_review"
  | "profile_expansion"
  | "supply_chain_expansion";
export type InvestigationBacklogPriority = "P0" | "P1" | "P2" | "P3";

export interface InvestigationBacklogTarget {
  component_ids: string[];
  edge_ids: string[];
  unknown_ids: string[];
  source_ids: string[];
  question_ids: string[];
}

export interface InvestigationBacklogItem {
  backlog_id: string;
  kind: InvestigationBacklogKind;
  priority: InvestigationBacklogPriority;
  title: string;
  rationale: string;
  action: string;
  target: InvestigationBacklogTarget;
  supporting_refs: string[];
  runnable_check_targets: SourcePlanCheckTargetSuggestion[];
  source_target_coverage: InvestigationBacklogSourceTargetCoverage[];
}

export interface InvestigationBacklogSourceTargetCoverage {
  source_adapter_id: string;
  target_kind: string;
  target_config: Record<string, unknown>;
  check_target_id: string;
  state: SourceTargetCoverageState;
  synced: boolean;
  observations: number;
  latest_job_id: string | null;
  latest_job_status: string | null;
  latest_event_id: string | null;
  latest_event_type: string | null;
  preflight_status: SourceTargetPreflightStatus | null;
  preflight_issue_kind: SourceTargetPreflightIssueKind | null;
  preflight_error_message: string | null;
  preflight_missing_credential_env_keys: readonly string[];
  preflight_normalized_documents: number;
  preflight_degraded_documents: number;
}

export interface InvestigationBacklog {
  schema_version: "1.0.0";
  generated_at: string;
  company_id: string;
  summary: {
    open_items: number;
    p0: number;
    p1: number;
    p2: number;
    p3: number;
    runnable_check_targets: number;
    source_target_coverage_items: number;
    corroboration_reviews: number;
    corroboration_review_runnable_targets: number;
    corroboration_review_with_source_target_coverage: number;
    corroboration_review_explicit_disposition_only: number;
    corroboration_review_need_sync: number;
    corroboration_review_need_enable: number;
    corroboration_review_due: number;
    corroboration_review_failed_preflight: number;
    corroboration_review_missing_credentials: number;
    corroboration_review_invalid_config: number;
    corroboration_review_unsupported_connector: number;
    corroboration_review_source_unreachable: number;
  };
  items: InvestigationBacklogItem[];
}

export interface InvestigationBacklogInput {
  generated_at: string;
  company_id: string;
  workbench: WorkbenchModel;
  components: readonly ComponentCardModel[];
  source_plan: readonly SourcePlanItem[];
  question_readiness: QuestionReadinessMatrix;
  observation_coverage?: ObservationCoverageReport;
  official_disclosure_readiness?: OfficialDisclosureReadinessReport;
  supply_chain_expansion_plan?: SupplyChainExpansionPlan;
  source_target_coverage?: SourceTargetCoverageReport;
  source_target_preflight?: SourceTargetPreflightReport;
}

export interface BacklogDraft {
  kind: InvestigationBacklogKind;
  priority: InvestigationBacklogPriority;
  title: string;
  rationale: string;
  action: string;
  target: InvestigationBacklogTarget;
  supporting_refs: string[];
  runnable_check_targets: SourcePlanCheckTargetSuggestion[];
  source_target_coverage: InvestigationBacklogSourceTargetCoverage[];
}
