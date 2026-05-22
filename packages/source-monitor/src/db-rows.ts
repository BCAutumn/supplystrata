import type pg from "pg";
import type { SourceCheckJobStatus } from "./types.js";

export interface SourceHealthRow extends pg.QueryResultRow {
  source_adapter_id: string;
  tier: string;
  category: string;
  registry_status: string;
  automation: string;
  tos_url: string;
  official_url: string;
  requires_key: boolean;
  last_checked_at: Date | null;
  last_success_at: Date | null;
  last_failure_at: Date | null;
  failure_count: number;
  last_change_at: Date | null;
  last_error_message: string | null;
  policy_enabled: boolean | null;
  check_cadence_minutes: number | null;
  jitter_minutes: number | null;
  priority: number | null;
  next_check_at: Date | null;
  policy_config_source: string | null;
  policy_notes: string | null;
}

export interface SourcePolicyRow extends pg.QueryResultRow {
  source_adapter_id: string;
  enabled: boolean;
  check_cadence_minutes: number;
  jitter_minutes: number;
  priority: number;
  config_source: string;
  next_check_at: Date | null;
  notes: string | null;
}

export interface DueSourceCheckRow extends pg.QueryResultRow {
  check_target_id: string;
  source_adapter_id: string;
  target_kind: string;
  subject_entity_id: string | null;
  target_config: Record<string, unknown>;
  target_enabled: boolean;
  target_priority: number;
  target_config_source: string;
  target_notes: string | null;
  policy_enabled: boolean;
  check_cadence_minutes: number;
  jitter_minutes: number;
  effective_check_cadence_minutes: number;
  effective_jitter_minutes: number;
  effective_max_attempts: number;
  effective_backoff_base_minutes: number;
  effective_backoff_max_minutes: number;
  policy_priority: number;
  policy_config_source: string;
  next_check_at: Date | null;
  policy_notes: string | null;
}

export interface SourceCheckJobRow extends DueSourceCheckRow {
  job_id: string;
  job_status: SourceCheckJobStatus;
  attempts: number;
  max_attempts: number;
  backoff_base_minutes: number;
  backoff_max_minutes: number;
  last_error: string | null;
  next_attempt_at: Date;
  claimed_at: Date | null;
  lease_expires_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface SourceCheckJobStateRow extends pg.QueryResultRow {
  job_id: string;
  status: SourceCheckJobStatus;
  attempts: number;
  max_attempts: number;
  backoff_base_minutes: number;
  backoff_max_minutes: number;
  last_error: string | null;
  next_attempt_at: Date;
  completed_at: Date | null;
}

export interface SourceItemRow extends pg.QueryResultRow {
  source_item_id: string;
  latest_doc_id: string | null;
  latest_bytes_sha256: string | null;
  latest_storage_key: string | null;
}

export interface NextCheckPolicyRow extends pg.QueryResultRow {
  check_cadence_minutes: number;
  jitter_minutes: number;
}

export interface SourceCheckTargetEnableRow extends pg.QueryResultRow {
  check_target_id: string;
  status: "enabled" | "missing" | "blocked_unregistered" | "blocked_manual_only" | "blocked_rejected" | "blocked_unupdated";
  requires_key: boolean | null;
}

export interface SourceTargetCoverageRow extends pg.QueryResultRow {
  check_target_id: string;
  target_enabled: boolean;
  policy_enabled: boolean;
  next_check_at: Date | null;
  effective_check_cadence_minutes: number;
  effective_jitter_minutes: number;
  job_id: string | null;
  job_status: SourceCheckJobStatus | null;
  job_attempts: number | null;
  job_last_error: string | null;
  job_next_attempt_at: Date | null;
  job_completed_at: Date | null;
  job_created_at: Date | null;
  job_updated_at: Date | null;
  event_id: string | null;
  event_type: string | null;
  event_doc_id: string | null;
  event_detected_at: Date | null;
  event_caused_by: string | null;
  observation_count: string | number;
  latest_observation_at: Date | null;
  match_rank: number;
}

export interface SourceHealthStateRow extends pg.QueryResultRow {
  failure_count: number;
  last_failure_at: Date | null;
  last_error_message: string | null;
}
