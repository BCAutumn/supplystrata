import type { SourceCheckConnectorCapability, SourceCheckCredentialRequirement } from "@supplystrata/source-connectors";
import type { SourceRegistryEntry } from "@supplystrata/source-registry";

export interface SourceManagementPolicyInput {
  source_adapter_id: string;
  enabled: boolean;
}

export interface SourceManagementTargetInput {
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

export interface SourceManagementConfig {
  schema_version: "1.0.0";
  policies: readonly SourceManagementPolicyInput[];
  check_targets: readonly SourceManagementTargetInput[];
}

export interface ManagedSource {
  source: SourceRegistryEntry;
  connector_keys: string[];
  executable_target_kinds: string[];
  source_credential_requirements: readonly SourceCheckCredentialRequirement[];
  target_config_schemas: Record<string, NonNullable<SourceCheckConnectorCapability["config_schema"]>>;
  target_credential_requirements: Record<string, readonly SourceCheckCredentialRequirement[]>;
  can_run_checks: boolean;
  config_mode: "runnable" | "registered_only" | "manual_only";
}

export interface SourceManagementCatalog {
  schema_version: "1.0.0";
  sources: ManagedSource[];
  unregistered_connector_keys: string[];
}

export interface SourceManagementValidationIssue {
  severity: "error" | "warning";
  code:
    | "UNKNOWN_POLICY_SOURCE"
    | "UNKNOWN_TARGET_SOURCE"
    | "UNSUPPORTED_TARGET_CONNECTOR"
    | "INVALID_TARGET_CONFIG"
    | "MANUAL_ONLY_TARGET_ENABLED"
    | "SOURCE_REQUIRES_KEY";
  message: string;
  source_adapter_id: string;
  target_kind?: string;
  check_target_id?: string;
}

export interface SourceManagementValidationResult {
  ok: boolean;
  errors: SourceManagementValidationIssue[];
  warnings: SourceManagementValidationIssue[];
}

export interface SourceManagementInput {
  sources?: readonly SourceRegistryEntry[];
  connector_capabilities?: readonly SourceCheckConnectorCapability[];
}

export type ManagedSourcePlanPriority = "P0" | "P1" | "P2" | "manual";

export interface ManagedSourcePlanTargetSuggestion {
  source_adapter_id: string;
  target_kind: string;
  runnable: boolean;
  target_config: Record<string, string | number | boolean | string[]>;
  reason: string;
}

export interface ManagedSourcePlanItem {
  source_id: string;
  priority: ManagedSourcePlanPriority;
  reasons: readonly string[];
  suggested_check_targets: readonly ManagedSourcePlanTargetSuggestion[];
}

export interface ManagedSourcePlanDocument {
  schema_version: "1.0.0";
  source_plan: readonly ManagedSourcePlanItem[];
}

export interface SourceTargetsFromPlanInput {
  source_plan: readonly ManagedSourcePlanItem[];
  namespace: string;
  source_adapter_ids?: readonly string[];
  enabled?: boolean;
  next_check_at?: string;
  check_cadence_minutes?: number;
  jitter_minutes?: number;
  max_attempts?: number;
  backoff_base_minutes?: number;
  backoff_max_minutes?: number;
}

export interface SourcePlanTargetIdInput {
  source_plan: readonly ManagedSourcePlanItem[];
  namespace: string;
  source_adapter_ids?: readonly string[];
}

export interface SourcePlanTargetPreviewInput extends SourceTargetsFromPlanInput, SourceManagementInput {}

export interface SourcePlanTargetPreviewSummary {
  source_plan_items: number;
  runnable_suggestions: number;
  generated_targets: number;
  duplicate_targets_skipped: number;
  enabled_targets: number;
  targets_requiring_credentials: number;
  validation_errors: number;
  validation_warnings: number;
  by_source: Record<string, number>;
  by_target_kind: Record<string, number>;
  by_priority: Record<string, number>;
}

export interface SourcePlanTargetPreviewReport {
  schema_version: "1.0.0";
  namespace: string;
  config: SourceManagementConfig;
  validation: SourceManagementValidationResult;
  summary: SourcePlanTargetPreviewSummary;
  target_ids: string[];
}
