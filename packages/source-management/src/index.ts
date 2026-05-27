import { SOURCE_CREDENTIAL_DEFINITIONS } from "@supplystrata/config";
import {
  connectorKey,
  validateSourceCheckTargetConfig,
  type SourceCheckConnectorCapability,
  type SourceCheckCredentialRequirement,
  type SourceCheckTargetRow
} from "@supplystrata/source-connectors";
import { listSources, type SourceRegistryEntry } from "@supplystrata/source-registry";
import type {
  ManagedSource,
  ManagedSourcePlanItem,
  SourceManagementCatalog,
  SourceManagementConfig,
  SourceManagementInput,
  SourceManagementTargetInput,
  SourceManagementValidationIssue,
  SourceManagementValidationResult,
  SourcePlanTargetPreviewInput,
  SourcePlanTargetPreviewReport
} from "./definitions.js";
import { normalizeSourceTargetNamespace, buildSourceCheckTargetsFromPlan, buildSourcePolicyConfigFromPlanTargets } from "./source-plan-targets.js";

export type * from "./definitions.js";
export { parseManagedSourcePlanDocument } from "./source-plan-parser.js";
export { buildSourceCheckTargetIdsFromPlan, buildSourceCheckTargetsFromPlan, buildSourcePolicyConfigFromPlanTargets } from "./source-plan-targets.js";

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

export function previewSourceCheckTargetsFromPlan(input: SourcePlanTargetPreviewInput): SourcePlanTargetPreviewReport {
  const config = buildSourcePolicyConfigFromPlanTargets(input);
  const validation = validateSourceManagementConfig(config, {
    ...(input.sources === undefined ? {} : { sources: input.sources }),
    ...(input.connector_capabilities === undefined ? {} : { connector_capabilities: input.connector_capabilities })
  });
  const runnableSuggestions = countRunnableSuggestions(input.source_plan, input.source_adapter_ids, input.check_target_ids, input.namespace);
  return {
    schema_version: "1.0.0",
    namespace: normalizeSourceTargetNamespace(input.namespace),
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

function countRunnableSuggestions(
  sourcePlan: readonly ManagedSourcePlanItem[],
  sourceAdapterIds: readonly string[] | undefined,
  checkTargetIds: readonly string[] | undefined,
  namespace: string
): number {
  const sourceAdapterFilter = sourceAdapterIds === undefined ? null : new Set(sourceAdapterIds);
  if (checkTargetIds !== undefined) {
    return buildSourceCheckTargetsFromPlan({
      source_plan: sourcePlan,
      namespace,
      ...(sourceAdapterIds === undefined ? {} : { source_adapter_ids: sourceAdapterIds })
    }).filter((target) => checkTargetIds.includes(target.check_target_id)).length;
  }
  return sourcePlan.reduce(
    (count, item) =>
      count +
      item.suggested_check_targets.filter((target) => target.runnable && (sourceAdapterFilter === null || sourceAdapterFilter.has(target.source_adapter_id)))
        .length,
    0
  );
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
