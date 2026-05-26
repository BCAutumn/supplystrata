import type { ManagedSourcePlanDocument, ManagedSourcePlanItem, ManagedSourcePlanPriority, ManagedSourcePlanTargetSuggestion } from "./definitions.js";

export function parseManagedSourcePlanDocument(text: string): ManagedSourcePlanDocument {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error("source plan document must be an object");
  if (parsed["schema_version"] !== "1.0.0") throw new Error("source plan document schema_version must be 1.0.0");
  const sourcePlan = parsed["source_plan"];
  if (!Array.isArray(sourcePlan)) throw new Error("source plan document source_plan must be an array");
  const checkTargetIds = parseOptionalCheckTargetIds(parsed["check_target_ids"]);
  return {
    schema_version: "1.0.0",
    ...(checkTargetIds === undefined ? {} : { check_target_ids: checkTargetIds }),
    source_plan: sourcePlan.map((item, index) => parseManagedSourcePlanItem(item, `source_plan[${index}]`))
  };
}

function parseOptionalCheckTargetIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("source plan document check_target_ids must be a string array when provided");
  const ids: string[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.trim().length === 0) throw new Error(`source plan document check_target_ids[${index}] must be a non-empty string`);
    ids.push(item);
  }
  return [...new Set(ids)].sort();
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
