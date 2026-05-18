import type { SourceCheckTargetInput, SourcePolicyConfig, SourcePolicyInput } from "./types.js";

export function parseSourcePolicyConfig(text: string): SourcePolicyConfig {
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed)) throw new Error("source policy config must be an object");
  if (parsed["schema_version"] !== "1.0.0") throw new Error("source policy config schema_version must be 1.0.0");
  const policies = parsed["policies"];
  if (!Array.isArray(policies)) throw new Error("source policy config policies must be an array");
  const checkTargets = parsed["check_targets"];
  if (!Array.isArray(checkTargets)) throw new Error("source policy config check_targets must be an array");
  return {
    schema_version: "1.0.0",
    policies: policies.map(parseSourcePolicyInput),
    check_targets: checkTargets.map(parseSourceCheckTargetInput)
  };
}

function parseSourcePolicyInput(value: unknown): SourcePolicyInput {
  if (!isRecord(value)) throw new Error("source policy entry must be an object");
  const sourceAdapterId = requireString(value, "source_adapter_id");
  const enabled = requireBoolean(value, "enabled");
  const checkCadenceMinutes = requirePositiveInteger(value, "check_cadence_minutes");
  const jitterMinutes = optionalNonNegativeInteger(value, "jitter_minutes");
  const priority = optionalNonNegativeInteger(value, "priority");
  const notes = optionalString(value, "notes");
  return {
    source_adapter_id: sourceAdapterId,
    enabled,
    check_cadence_minutes: checkCadenceMinutes,
    ...(jitterMinutes === undefined ? {} : { jitter_minutes: jitterMinutes }),
    ...(priority === undefined ? {} : { priority }),
    ...(notes === undefined ? {} : { notes })
  };
}

function parseSourceCheckTargetInput(value: unknown): SourceCheckTargetInput {
  if (!isRecord(value)) throw new Error("source check target entry must be an object");
  const checkTargetId = requireString(value, "check_target_id");
  const sourceAdapterId = requireString(value, "source_adapter_id");
  const targetKind = requireString(value, "target_kind");
  const enabled = requireBoolean(value, "enabled");
  const priority = optionalNonNegativeInteger(value, "priority");
  const subjectEntityId = optionalString(value, "subject_entity_id");
  const targetConfig = requireRecord(value, "target_config");
  const notes = optionalString(value, "notes");
  return {
    check_target_id: checkTargetId,
    source_adapter_id: sourceAdapterId,
    target_kind: targetKind,
    enabled,
    target_config: targetConfig,
    ...(priority === undefined ? {} : { priority }),
    ...(subjectEntityId === undefined ? {} : { subject_entity_id: subjectEntityId }),
    ...(notes === undefined ? {} : { notes })
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: Record<string, unknown>, key: string): string {
  const item = value[key];
  if (typeof item !== "string" || item.trim().length === 0) throw new Error(`source policy ${key} must be a non-empty string`);
  return item;
}

function requireBoolean(value: Record<string, unknown>, key: string): boolean {
  const item = value[key];
  if (typeof item !== "boolean") throw new Error(`source policy ${key} must be a boolean`);
  return item;
}

function requireRecord(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const item = value[key];
  if (!isRecord(item)) throw new Error(`source policy ${key} must be an object`);
  return item;
}

function requirePositiveInteger(value: Record<string, unknown>, key: string): number {
  const item = value[key];
  if (typeof item !== "number" || !Number.isInteger(item) || item < 1) throw new Error(`source policy ${key} must be a positive integer`);
  return item;
}

function optionalNonNegativeInteger(value: Record<string, unknown>, key: string): number | undefined {
  const item = value[key];
  if (item === undefined) return undefined;
  if (typeof item !== "number" || !Number.isInteger(item) || item < 0) throw new Error(`source policy ${key} must be a non-negative integer`);
  return item;
}

function optionalString(value: Record<string, unknown>, key: string): string | undefined {
  const item = value[key];
  if (item === undefined) return undefined;
  if (typeof item !== "string") throw new Error(`source policy ${key} must be a string`);
  return item;
}
