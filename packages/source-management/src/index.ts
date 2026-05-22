import { createHash } from "node:crypto";
import { SOURCE_CREDENTIAL_DEFINITIONS } from "@supplystrata/config";
import {
  connectorKey,
  validateSourceCheckTargetConfig,
  type SourceCheckConnectorCapability,
  type SourceCheckCredentialRequirement,
  type SourceCheckTargetRow
} from "@supplystrata/source-connectors";
import { listSources, type SourceRegistryEntry } from "@supplystrata/source-registry";

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

// 统一数据源管理面的核心入口：只汇总能力，不抓取、不写库，方便 CLI、宿主 App 和后续 UI 复用。
export function buildSourceManagementCatalog(input: SourceManagementInput = {}): SourceManagementCatalog {
  const sources = input.sources ?? listSources();
  const connectors = input.connector_capabilities ?? [];
  const sourceIds = new Set(sources.map((source) => source.id));
  return {
    schema_version: "1.0.0",
    sources: sources.map((source) => toManagedSource(source, connectors)).sort(compareManagedSources),
    unregistered_connector_keys: connectors
      .filter((connector) => !sourceIds.has(connector.source_adapter_id))
      .map((connector) => connector.key)
      .sort()
  };
}

export function parseManagedSourcePlanDocument(text: string): ManagedSourcePlanDocument {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error("source plan document must be an object");
  if (parsed["schema_version"] !== "1.0.0") throw new Error("source plan document schema_version must be 1.0.0");
  const sourcePlan = parsed["source_plan"];
  if (!Array.isArray(sourcePlan)) throw new Error("source plan document source_plan must be an array");
  return {
    schema_version: "1.0.0",
    source_plan: sourcePlan.map((item, index) => parseManagedSourcePlanItem(item, `source_plan[${index}]`))
  };
}

export function buildSourcePolicyConfigFromPlanTargets(input: SourceTargetsFromPlanInput): SourceManagementConfig {
  return {
    schema_version: "1.0.0",
    policies: [],
    check_targets: buildSourceCheckTargetsFromPlan(input)
  };
}

export function buildSourceCheckTargetIdsFromPlan(input: SourcePlanTargetIdInput): string[] {
  return buildSourceCheckTargetsFromPlan({
    source_plan: input.source_plan,
    namespace: input.namespace
  }).map((target) => target.check_target_id);
}

export function previewSourceCheckTargetsFromPlan(input: SourcePlanTargetPreviewInput): SourcePlanTargetPreviewReport {
  const config = buildSourcePolicyConfigFromPlanTargets(input);
  const validation = validateSourceManagementConfig(config, {
    ...(input.sources === undefined ? {} : { sources: input.sources }),
    ...(input.connector_capabilities === undefined ? {} : { connector_capabilities: input.connector_capabilities })
  });
  const runnableSuggestions = countRunnableSuggestions(input.source_plan);
  return {
    schema_version: "1.0.0",
    namespace: normalizeNamespace(input.namespace),
    config,
    validation,
    summary: {
      source_plan_items: input.source_plan.length,
      runnable_suggestions: runnableSuggestions,
      generated_targets: config.check_targets.length,
      duplicate_targets_skipped: runnableSuggestions - config.check_targets.length,
      enabled_targets: config.check_targets.filter((target) => target.enabled).length,
      targets_requiring_credentials: countTargetsRequiringCredentials(config.check_targets, input.sources ?? listSources(), input.connector_capabilities ?? []),
      validation_errors: validation.errors.length,
      validation_warnings: validation.warnings.length,
      by_source: countTargetsBy(config.check_targets, (target) => target.source_adapter_id),
      by_target_kind: countTargetsBy(config.check_targets, (target) => `${target.source_adapter_id}/${target.target_kind}`),
      by_priority: countTargetsBy(config.check_targets, (target) => String(target.priority ?? "default"))
    },
    target_ids: config.check_targets.map((target) => target.check_target_id)
  };
}

export function buildSourceCheckTargetsFromPlan(input: SourceTargetsFromPlanInput): SourceManagementTargetInput[] {
  const namespace = normalizeNamespace(input.namespace);
  const targets: SourceManagementTargetInput[] = [];
  const seen = new Set<string>();
  for (const item of input.source_plan) {
    for (const suggestion of item.suggested_check_targets) {
      if (!suggestion.runnable) continue;
      const target = toSourceCheckTargetInput(item, suggestion, {
        namespace,
        enabled: input.enabled ?? false,
        ...(input.next_check_at === undefined ? {} : { next_check_at: normalizeIsoDateTime(input.next_check_at, "next_check_at") }),
        ...(input.check_cadence_minutes === undefined
          ? {}
          : { check_cadence_minutes: requirePositiveInteger(input.check_cadence_minutes, "check_cadence_minutes") }),
        ...(input.jitter_minutes === undefined ? {} : { jitter_minutes: requireNonNegativeInteger(input.jitter_minutes, "jitter_minutes") }),
        ...(input.max_attempts === undefined ? {} : { max_attempts: requirePositiveInteger(input.max_attempts, "max_attempts") }),
        ...(input.backoff_base_minutes === undefined
          ? {}
          : { backoff_base_minutes: requirePositiveInteger(input.backoff_base_minutes, "backoff_base_minutes") }),
        ...(input.backoff_max_minutes === undefined ? {} : { backoff_max_minutes: requirePositiveInteger(input.backoff_max_minutes, "backoff_max_minutes") })
      });
      if (seen.has(target.check_target_id)) continue;
      seen.add(target.check_target_id);
      targets.push(target);
    }
  }
  return targets.sort(compareSourceManagementTargets);
}

export function validateSourceManagementConfig(config: SourceManagementConfig, input: SourceManagementInput = {}): SourceManagementValidationResult {
  const sources = input.sources ?? listSources();
  const connectors = input.connector_capabilities ?? [];
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const connectorByKey = new Map(connectors.map((connector) => [connector.key, connector]));
  const issues: SourceManagementValidationIssue[] = [];

  for (const policy of config.policies) {
    if (!sourceById.has(policy.source_adapter_id)) {
      issues.push({
        severity: "error",
        code: "UNKNOWN_POLICY_SOURCE",
        source_adapter_id: policy.source_adapter_id,
        message: `Source policy references unregistered source: ${policy.source_adapter_id}`
      });
    }
  }

  for (const target of config.check_targets) {
    const source = sourceById.get(target.source_adapter_id);
    if (source === undefined) {
      issues.push({
        severity: "error",
        code: "UNKNOWN_TARGET_SOURCE",
        source_adapter_id: target.source_adapter_id,
        target_kind: target.target_kind,
        check_target_id: target.check_target_id,
        message: `Source check target ${target.check_target_id} references unregistered source: ${target.source_adapter_id}`
      });
      continue;
    }

    const key = connectorKey(target);
    const connector = connectorByKey.get(key);
    if (connector === undefined) {
      issues.push({
        severity: "error",
        code: "UNSUPPORTED_TARGET_CONNECTOR",
        source_adapter_id: target.source_adapter_id,
        target_kind: target.target_kind,
        check_target_id: target.check_target_id,
        message: `Source check target ${target.check_target_id} is not runnable because connector ${key} is not registered`
      });
    } else if (connector.config_schema !== undefined) {
      for (const message of validateSourceCheckTargetConfig({
        config: target.target_config,
        schema: connector.config_schema,
        label: `Source check target ${target.check_target_id}`
      })) {
        issues.push({
          severity: "error",
          code: "INVALID_TARGET_CONFIG",
          source_adapter_id: target.source_adapter_id,
          target_kind: target.target_kind,
          check_target_id: target.check_target_id,
          message
        });
      }
    }

    if (target.enabled && source.automation === "manual_only") {
      issues.push({
        severity: "error",
        code: "MANUAL_ONLY_TARGET_ENABLED",
        source_adapter_id: target.source_adapter_id,
        target_kind: target.target_kind,
        check_target_id: target.check_target_id,
        message: `Source check target ${target.check_target_id} enables manual-only source ${target.source_adapter_id}`
      });
    }

    const credentialKeys = credentialKeysForTarget(target, source, connector);
    if (target.enabled && credentialKeys.length > 0) {
      issues.push({
        severity: "warning",
        code: "SOURCE_REQUIRES_KEY",
        source_adapter_id: target.source_adapter_id,
        target_kind: target.target_kind,
        check_target_id: target.check_target_id,
        message: `Source check target ${target.check_target_id} needs credentials for ${target.source_adapter_id}: ${credentialKeys.join(", ")}`
      });
    }
  }

  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  return { ok: errors.length === 0, errors, warnings };
}

export function assertValidSourceManagementConfig(config: SourceManagementConfig, input: SourceManagementInput = {}): SourceManagementValidationResult {
  const result = validateSourceManagementConfig(config, input);
  if (!result.ok) {
    throw new Error(["Invalid source management config:", ...result.errors.map((issue) => `- ${issue.message}`)].join("\n"));
  }
  return result;
}

function toManagedSource(source: SourceRegistryEntry, connectors: readonly SourceCheckConnectorCapability[]): ManagedSource {
  const matchingConnectors = connectors.filter((connector) => connector.source_adapter_id === source.id).sort(compareConnectorCapabilities);
  const canRunChecks = matchingConnectors.length > 0 && source.automation !== "manual_only";
  return {
    source,
    connector_keys: matchingConnectors.map((connector) => connector.key),
    executable_target_kinds: matchingConnectors.map((connector) => connector.target_kind),
    source_credential_requirements: sourceCredentialRequirementsForSource(source.id),
    target_config_schemas: targetConfigSchemasForConnectors(matchingConnectors),
    target_credential_requirements: targetCredentialRequirementsForConnectors(matchingConnectors),
    can_run_checks: canRunChecks,
    config_mode: configModeForSource(source, canRunChecks)
  };
}

function sourceCredentialRequirementsForSource(sourceAdapterId: string): readonly SourceCheckCredentialRequirement[] {
  return SOURCE_CREDENTIAL_DEFINITIONS.filter((definition) => definition.source_adapter_ids.includes(sourceAdapterId))
    .map((definition) => ({ env_key: definition.env_key, description: definition.description, required: definition.required }))
    .sort((left, right) => left.env_key.localeCompare(right.env_key));
}

function targetConfigSchemasForConnectors(
  connectors: readonly SourceCheckConnectorCapability[]
): Record<string, NonNullable<SourceCheckConnectorCapability["config_schema"]>> {
  const schemas: Record<string, NonNullable<SourceCheckConnectorCapability["config_schema"]>> = {};
  for (const connector of connectors) {
    if (connector.config_schema !== undefined) schemas[connector.target_kind] = connector.config_schema;
  }
  return schemas;
}

function targetCredentialRequirementsForConnectors(
  connectors: readonly SourceCheckConnectorCapability[]
): Record<string, readonly SourceCheckCredentialRequirement[]> {
  const requirements: Record<string, readonly SourceCheckCredentialRequirement[]> = {};
  for (const connector of connectors) {
    if (connector.credential_requirements !== undefined && connector.credential_requirements.length > 0) {
      requirements[connector.target_kind] = connector.credential_requirements;
    }
  }
  return requirements;
}

function configModeForSource(source: SourceRegistryEntry, canRunChecks: boolean): ManagedSource["config_mode"] {
  if (source.automation === "manual_only") return "manual_only";
  return canRunChecks ? "runnable" : "registered_only";
}

function compareManagedSources(left: ManagedSource, right: ManagedSource): number {
  return left.source.id.localeCompare(right.source.id);
}

function compareConnectorCapabilities(
  left: Pick<SourceCheckTargetRow, "source_adapter_id" | "target_kind">,
  right: Pick<SourceCheckTargetRow, "source_adapter_id" | "target_kind">
): number {
  return connectorKey(left).localeCompare(connectorKey(right));
}

function countRunnableSuggestions(sourcePlan: readonly ManagedSourcePlanItem[]): number {
  return sourcePlan.reduce((count, item) => count + item.suggested_check_targets.filter((target) => target.runnable).length, 0);
}

function countTargetsRequiringCredentials(
  targets: readonly SourceManagementTargetInput[],
  sources: readonly SourceRegistryEntry[],
  connectors: readonly SourceCheckConnectorCapability[]
): number {
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const connectorByKey = new Map(connectors.map((connector) => [connector.key, connector]));
  return targets.filter((target) => {
    const source = sourcesById.get(target.source_adapter_id);
    return source !== undefined && credentialKeysForTarget(target, source, connectorByKey.get(connectorKey(target))).length > 0;
  }).length;
}

function credentialKeysForTarget(
  target: Pick<SourceCheckTargetRow, "source_adapter_id" | "target_kind">,
  source: SourceRegistryEntry,
  connector: SourceCheckConnectorCapability | undefined
): string[] {
  const keys = connector?.credential_requirements?.filter((requirement) => requirement.required).map((requirement) => requirement.env_key) ?? [];
  if (keys.length > 0) return [...keys].sort();
  return source.requires_key ? ["source credential"] : [];
}

function countTargetsBy(
  targets: readonly SourceManagementTargetInput[],
  keyForTarget: (target: SourceManagementTargetInput) => string
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const target of targets) {
    const key = keyForTarget(target);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const sorted: Record<string, number> = {};
  for (const [key, count] of Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))) sorted[key] = count;
  return sorted;
}

function parseManagedSourcePlanItem(value: unknown, label: string): ManagedSourcePlanItem {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const sourceId = requireNonEmptyString(value, "source_id", label);
  const priority = requireSourcePlanPriority(value, "priority", label);
  const reasons = requireStringArray(value, "reasons", label);
  const suggestions = value["suggested_check_targets"];
  if (!Array.isArray(suggestions)) throw new Error(`${label}.suggested_check_targets must be an array`);
  return {
    source_id: sourceId,
    priority,
    reasons,
    suggested_check_targets: suggestions.map((item, index) => parseManagedSourcePlanTargetSuggestion(item, `${label}.suggested_check_targets[${index}]`))
  };
}

function parseManagedSourcePlanTargetSuggestion(value: unknown, label: string): ManagedSourcePlanTargetSuggestion {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return {
    source_adapter_id: requireNonEmptyString(value, "source_adapter_id", label),
    target_kind: requireNonEmptyString(value, "target_kind", label),
    runnable: requireBoolean(value, "runnable", label),
    target_config: requireTargetConfig(value, "target_config", label),
    reason: requireNonEmptyString(value, "reason", label)
  };
}

function toSourceCheckTargetInput(
  item: ManagedSourcePlanItem,
  suggestion: ManagedSourcePlanTargetSuggestion,
  options: {
    namespace: string;
    enabled: boolean;
    next_check_at?: string;
    check_cadence_minutes?: number;
    jitter_minutes?: number;
    max_attempts?: number;
    backoff_base_minutes?: number;
    backoff_max_minutes?: number;
  }
): SourceManagementTargetInput {
  const targetConfig = copyTargetConfig(suggestion.target_config);
  const subjectEntityId = subjectEntityIdFromConfig(targetConfig);
  return {
    check_target_id: buildPlanCheckTargetId({
      namespace: options.namespace,
      sourceAdapterId: suggestion.source_adapter_id,
      targetKind: suggestion.target_kind,
      targetConfig
    }),
    source_adapter_id: suggestion.source_adapter_id,
    target_kind: suggestion.target_kind,
    enabled: options.enabled,
    priority: priorityForSourcePlanItem(item),
    target_config: targetConfig,
    notes: buildPlanTargetNotes(item, suggestion),
    ...(subjectEntityId === undefined ? {} : { subject_entity_id: subjectEntityId }),
    ...(options.next_check_at === undefined ? {} : { next_check_at: options.next_check_at }),
    ...(options.check_cadence_minutes === undefined ? {} : { check_cadence_minutes: options.check_cadence_minutes }),
    ...(options.jitter_minutes === undefined ? {} : { jitter_minutes: options.jitter_minutes }),
    ...(options.max_attempts === undefined ? {} : { max_attempts: options.max_attempts }),
    ...(options.backoff_base_minutes === undefined ? {} : { backoff_base_minutes: options.backoff_base_minutes }),
    ...(options.backoff_max_minutes === undefined ? {} : { backoff_max_minutes: options.backoff_max_minutes })
  };
}

function buildPlanCheckTargetId(input: { namespace: string; sourceAdapterId: string; targetKind: string; targetConfig: Record<string, unknown> }): string {
  const key = `${input.namespace}:${input.sourceAdapterId}:${input.targetKind}:${stableUnknownConfigKey(input.targetConfig)}`;
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 16);
  return `plan:${input.namespace}:${input.sourceAdapterId}:${input.targetKind}:${digest}`;
}

function buildPlanTargetNotes(item: ManagedSourcePlanItem, suggestion: ManagedSourcePlanTargetSuggestion): string {
  const primaryReason = item.reasons[0] ?? "source-plan runnable target";
  return `Generated from source-plan. ${suggestion.reason} Plan reason: ${primaryReason}`;
}

function priorityForSourcePlanItem(item: ManagedSourcePlanItem): number {
  if (item.priority === "P0") return 10;
  if (item.priority === "P1") return 30;
  if (item.priority === "P2") return 60;
  return 100;
}

function subjectEntityIdFromConfig(config: Record<string, unknown>): string | undefined {
  const entityId = config["entity_id"];
  return typeof entityId === "string" && entityId.trim().length > 0 ? entityId : undefined;
}

function copyTargetConfig(config: Record<string, string | number | boolean | string[]>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config).sort(([left], [right]) => left.localeCompare(right))) {
    output[key] = Array.isArray(value) ? [...value] : value;
  }
  return output;
}

function compareSourceManagementTargets(left: SourceManagementTargetInput, right: SourceManagementTargetInput): number {
  return (
    left.source_adapter_id.localeCompare(right.source_adapter_id) ||
    left.target_kind.localeCompare(right.target_kind) ||
    left.check_target_id.localeCompare(right.check_target_id)
  );
}

function normalizeNamespace(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (normalized.length === 0) throw new Error("source target namespace must include at least one alphanumeric character");
  return normalized;
}

function normalizeIsoDateTime(value: string, label: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} must be an ISO date/time string`);
  return parsed.toISOString();
}

function stableUnknownConfigKey(config: Record<string, unknown>): string {
  return Object.entries(config)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${stableUnknownValue(value)}`)
    .join(";");
}

function stableUnknownValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableUnknownValue).join(",")}]`;
  if (isRecord(value)) return `{${stableUnknownConfigKey(value)}}`;
  return String(value);
}

function requireSourcePlanPriority(value: Record<string, unknown>, key: string, label: string): ManagedSourcePlanPriority {
  const item = requireNonEmptyString(value, key, label);
  if (item === "P0" || item === "P1" || item === "P2" || item === "manual") return item;
  throw new Error(`${label}.${key} must be one of P0, P1, P2, manual`);
}

function requireTargetConfig(value: Record<string, unknown>, key: string, label: string): Record<string, string | number | boolean | string[]> {
  const item = value[key];
  if (!isRecord(item)) throw new Error(`${label}.${key} must be an object`);
  const output: Record<string, string | number | boolean | string[]> = {};
  for (const [configKey, configValue] of Object.entries(item)) {
    if (typeof configValue === "string" || typeof configValue === "number" || typeof configValue === "boolean") {
      output[configKey] = configValue;
      continue;
    }
    if (Array.isArray(configValue) && configValue.every((entry) => typeof entry === "string")) {
      output[configKey] = configValue;
      continue;
    }
    throw new Error(`${label}.${key}.${configKey} must be a string, number, boolean, or string array`);
  }
  return output;
}

function requireStringArray(value: Record<string, unknown>, key: string, label: string): string[] {
  const item = value[key];
  if (!Array.isArray(item)) throw new Error(`${label}.${key} must be a string array`);
  const values: string[] = [];
  for (const entry of item) {
    if (typeof entry !== "string") throw new Error(`${label}.${key} must be a string array`);
    values.push(entry);
  }
  return values;
}

function requireNonEmptyString(value: Record<string, unknown>, key: string, label: string): string {
  const item = value[key];
  if (typeof item !== "string" || item.trim().length === 0) throw new Error(`${label}.${key} must be a non-empty string`);
  return item;
}

function requireBoolean(value: Record<string, unknown>, key: string, label: string): boolean {
  const item = value[key];
  if (typeof item !== "boolean") throw new Error(`${label}.${key} must be a boolean`);
  return item;
}

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
  return value;
}

function requireNonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
