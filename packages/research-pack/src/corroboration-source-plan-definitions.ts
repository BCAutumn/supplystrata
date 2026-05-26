import type { SourcePlanItem } from "@supplystrata/source-plan";
import type { InvestigationBacklog, InvestigationBacklogSourceTargetCoverage } from "./investigation-backlog.js";

export type CorroborationSourcePlanNextAction =
  | "configure_credentials"
  | "fix_target_config"
  | "retry_preflight"
  | "smoke_target"
  | "sync_target"
  | "enable_target"
  | "run_due_target"
  | "wait_for_job"
  | "investigate_source_failure"
  | "review_observations";

export type CorroborationSourcePlanActionBatchKind = "smoke" | "sync" | "enable" | "run_due";

export interface CorroborationSourcePlanActionBatchDefinition {
  kind: CorroborationSourcePlanActionBatchKind;
  file_name: string;
  description: string;
  next_actions: readonly CorroborationSourcePlanNextAction[];
}

export interface CorroborationSourcePlanActionBatch {
  schema_version: "1.0.0";
  generated_at: string;
  company_id: string;
  batch_kind: CorroborationSourcePlanActionBatchKind;
  next_actions: readonly CorroborationSourcePlanNextAction[];
  check_target_ids: readonly string[];
  summary: {
    source_plan_items: number;
    runnable_targets: number;
    target_refs: number;
    review_edges: number;
    by_source: Record<string, number>;
  };
  source_plan: SourcePlanItem[];
}

export const CORROBORATION_SOURCE_PLAN_ACTION_BATCHES = [
  {
    kind: "smoke",
    file_name: "corroboration-source-plan-smoke.json",
    description: "Corroboration source-plan targets whose next action is smoke_target",
    next_actions: ["smoke_target"]
  },
  {
    kind: "sync",
    file_name: "corroboration-source-plan-sync.json",
    description: "Corroboration source-plan targets whose next action is sync_target",
    next_actions: ["sync_target"]
  },
  {
    kind: "enable",
    file_name: "corroboration-source-plan-enable.json",
    description: "Corroboration source-plan targets whose next action is enable_target",
    next_actions: ["enable_target"]
  },
  {
    kind: "run_due",
    file_name: "corroboration-source-plan-run-due.json",
    description: "Corroboration source-plan targets whose next action is run_due_target",
    next_actions: ["run_due_target"]
  }
] as const satisfies readonly CorroborationSourcePlanActionBatchDefinition[];

export interface CorroborationSourcePlanTargetRef {
  backlog_id: string;
  edge_ids: string[];
  unknown_ids: string[];
  source_adapter_id: string;
  target_kind: string;
  target_config: Record<string, string | number | boolean | string[]>;
  coverage_state: InvestigationBacklogSourceTargetCoverage["state"] | null;
  check_target_id: string | null;
  preflight_status: InvestigationBacklogSourceTargetCoverage["preflight_status"];
  preflight_issue_kind: InvestigationBacklogSourceTargetCoverage["preflight_issue_kind"];
  preflight_missing_credential_env_keys: readonly string[];
  next_action: CorroborationSourcePlanNextAction;
  next_action_reason: string;
}

export interface CorroborationSourcePlan {
  schema_version: "1.0.0";
  generated_at: string;
  company_id: string;
  summary: {
    review_edges: number;
    disposition_only_edges: number;
    source_plan_items: number;
    runnable_targets: number;
    targets_need_sync: number;
    targets_need_enable: number;
    targets_due: number;
    targets_failed_preflight: number;
    targets_missing_credentials: number;
    by_next_action: Record<string, number>;
    by_source: Record<string, number>;
  };
  target_refs: CorroborationSourcePlanTargetRef[];
  source_plan: SourcePlanItem[];
}

export interface CorroborationSourcePlanInput {
  generated_at: string;
  company_id: string;
  source_plan: readonly SourcePlanItem[];
  investigation_backlog: InvestigationBacklog;
}
