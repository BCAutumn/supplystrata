export type SourceDocumentChangeType = "DOCUMENT_NEW" | "DOCUMENT_UNCHANGED" | "DOCUMENT_CHANGED";

export type SourceCheckJobStatus = "pending" | "in_progress" | "failed" | "succeeded" | "dead";

export type { DueSourceCheckRow, SourceCheckJobRow, SourceCheckJobStateRow, SourceHealthRow, SourcePolicyRow } from "./db-rows.js";

export interface SourcePolicyInput {
  source_adapter_id: string;
  enabled: boolean;
  check_cadence_minutes: number;
  jitter_minutes?: number;
  priority?: number;
  next_check_at?: string | null;
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
  next_check_at?: string | null;
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
