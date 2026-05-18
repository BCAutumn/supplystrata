import { connectorKey, validateSourceCheckTargetConfig, type SourceCheckConnectorCapability, type SourceCheckTargetRow } from "@supplystrata/source-connectors";
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
  target_config: Record<string, unknown>;
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
  target_config_schemas: Record<string, NonNullable<SourceCheckConnectorCapability["config_schema"]>>;
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

    if (target.enabled && source.requires_key) {
      issues.push({
        severity: "warning",
        code: "SOURCE_REQUIRES_KEY",
        source_adapter_id: target.source_adapter_id,
        target_kind: target.target_kind,
        check_target_id: target.check_target_id,
        message: `Source check target ${target.check_target_id} needs credentials for ${target.source_adapter_id}`
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
    target_config_schemas: targetConfigSchemasForConnectors(matchingConnectors),
    can_run_checks: canRunChecks,
    config_mode: configModeForSource(source, canRunChecks)
  };
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
