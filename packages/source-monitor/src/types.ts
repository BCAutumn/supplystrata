import type pg from "pg";

export type SourceDocumentChangeType = "DOCUMENT_NEW" | "DOCUMENT_UNCHANGED" | "DOCUMENT_CHANGED";

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

export type SourceCheckJobStatus = "pending" | "in_progress" | "failed" | "succeeded" | "dead";

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

export interface SourcePolicyInput {
  source_adapter_id: string;
  enabled: boolean;
  check_cadence_minutes: number;
  jitter_minutes?: number;
  priority?: number;
  next_check_at?: string;
  max_attempts?: number;
  backoff_base_minutes?: number;
  backoff_max_minutes?: number;
  notes?: string;
}

export interface SourceCheckTargetInput {
  check_target_id: string;
  source_adapter_id: string;
  target_kind: string;
  enabled: boolean;
  priority?: number;
  next_check_at?: string;
  check_cadence_minutes?: number;
  jitter_minutes?: number;
  max_attempts?: number;
  backoff_base_minutes?: number;
  backoff_max_minutes?: number;
  subject_entity_id?: string;
  target_config: Record<string, unknown>;
  notes?: string;
}

export interface SourcePolicyConfig {
  schema_version: "1.0.0";
  policies: SourcePolicyInput[];
  check_targets: SourceCheckTargetInput[];
}

export interface SourceCheckTargetSelection {
  check_target_ids?: readonly string[];
  source_adapter_ids?: readonly string[];
}

export interface SourceCheckTargetEnableInput {
  check_target_ids: readonly string[];
  config_source: string;
  next_check_at?: string;
  check_cadence_minutes?: number;
  jitter_minutes?: number;
  max_attempts?: number;
  backoff_base_minutes?: number;
  backoff_max_minutes?: number;
  notes?: string;
}

export interface SourceCheckTargetEnableResult {
  requested_targets: number;
  updated_targets: number;
  missing_targets: number;
  blocked_targets: number;
  credential_required_targets: number;
  enabled_check_target_ids: string[];
  missing_check_target_ids: string[];
  blocked_check_target_ids: string[];
  credential_required_check_target_ids: string[];
}

export interface DocumentObservationInput {
  source_adapter_id: string;
  source_url: string;
  doc_id: string;
  bytes_sha256: string;
  storage_key: string;
  observed_at?: string;
  item_key?: string;
  check_target_id?: string;
  caused_by?: string;
}

export interface SourceFailureInput {
  source_adapter_id: string;
  error_message: string;
  failed_at?: string;
  task_id?: string;
  url?: string;
  check_target_id?: string;
  caused_by?: string;
}

export interface SourceDegradedInput {
  source_adapter_id: string;
  error_message: string;
  degraded_at?: string;
  task_id?: string;
  url?: string;
  check_target_id?: string;
  caused_by?: string;
}

export interface DocumentObservationResult {
  source_item_id: string;
  event_id: string;
  change_type: SourceDocumentChangeType;
  previous_doc_id: string | null;
  previous_bytes_sha256: string | null;
}
