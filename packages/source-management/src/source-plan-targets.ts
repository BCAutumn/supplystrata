import { createHash } from "node:crypto";
import type {
  ManagedSourcePlanItem,
  ManagedSourcePlanTargetSuggestion,
  SourceManagementConfig,
  SourceManagementTargetInput,
  SourcePlanTargetIdInput,
  SourceTargetsFromPlanInput
} from "./definitions.js";

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

export function normalizeSourceTargetNamespace(value: string): string {
  return normalizeNamespace(value);
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
