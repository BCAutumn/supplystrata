export interface SourceCheckTargetRow {
  check_target_id: string;
  source_adapter_id: string;
  target_kind: string;
  target_config: Record<string, unknown>;
}

export type SourceCheckConfigFieldType = "string" | "string_array" | "positive_integer";

export interface SourceCheckConfigField {
  key: string;
  type: SourceCheckConfigFieldType;
  required: boolean;
  description: string;
  allowed_values?: readonly string[];
}

export interface SourceCheckConfigSchema {
  fields: readonly SourceCheckConfigField[];
  allow_extra_keys?: boolean;
}

export interface SourceCheckCredentialRequirement {
  env_key: string;
  description: string;
  required: boolean;
}

export interface SourceCheckConnector<TStore, TResult, TTarget extends SourceCheckTargetRow = SourceCheckTargetRow> {
  readonly source_adapter_id: string;
  readonly target_kind: string;
  readonly config_schema?: SourceCheckConfigSchema;
  readonly credential_requirements?: readonly SourceCheckCredentialRequirement[];
  run(store: TStore, target: TTarget): Promise<TResult[]>;
}

export interface SourceCheckConnectorCapability {
  source_adapter_id: string;
  target_kind: string;
  key: string;
  config_schema?: SourceCheckConfigSchema;
  credential_requirements?: readonly SourceCheckCredentialRequirement[];
}

export function connectorKey(input: Pick<SourceCheckTargetRow, "source_adapter_id" | "target_kind">): string {
  return `${input.source_adapter_id}/${input.target_kind}`;
}

export function listSourceCheckConnectorKeys(connectors: readonly SourceCheckConnector<unknown, unknown>[]): string[] {
  return connectors.map((connector) => connectorKey(connector)).sort();
}

export function listSourceCheckConnectorCapabilities(connectors: readonly SourceCheckConnector<unknown, unknown>[]): SourceCheckConnectorCapability[] {
  return connectors
    .map((connector) => ({
      source_adapter_id: connector.source_adapter_id,
      target_kind: connector.target_kind,
      key: connectorKey(connector),
      ...(connector.config_schema === undefined ? {} : { config_schema: connector.config_schema }),
      ...(connector.credential_requirements === undefined || connector.credential_requirements.length === 0
        ? {}
        : { credential_requirements: connector.credential_requirements })
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

export async function runSourceCheckConnector<TStore, TResult, TTarget extends SourceCheckTargetRow>(
  store: TStore,
  target: TTarget,
  connectors: readonly SourceCheckConnector<TStore, TResult, TTarget>[]
): Promise<TResult[]> {
  const connector = findSourceCheckConnector(target, connectors);
  if (connector === undefined) {
    throw new Error(unsupportedSourceCheckTargetMessage(target, connectors));
  }
  return connector.run(store, target);
}

export function findSourceCheckConnector<TStore, TResult, TTarget extends SourceCheckTargetRow>(
  target: TTarget,
  connectors: readonly SourceCheckConnector<TStore, TResult, TTarget>[]
): SourceCheckConnector<TStore, TResult, TTarget> | undefined {
  const key = connectorKey(target);
  return connectors.find((connector) => connectorKey(connector) === key);
}

export function unsupportedSourceCheckTargetMessage(
  target: Pick<SourceCheckTargetRow, "source_adapter_id" | "target_kind">,
  connectors: readonly SourceCheckConnector<unknown, unknown>[]
): string {
  const supported = listSourceCheckConnectorKeys(connectors);
  const suffix = supported.length === 0 ? "no source check connectors are registered" : `supported: ${supported.join(", ")}`;
  return `Unsupported due source target: ${connectorKey(target)} (${suffix})`;
}

export function requireConfigString(config: Record<string, unknown>, key: string, label: string): string {
  const value = config[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} ${key} must be a non-empty string`);
  }
  return value;
}

export function optionalConfigPositiveInteger(config: Record<string, unknown>, key: string, label: string): number | undefined {
  const value = config[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`${label} ${key} must be a positive integer`);
  }
  return value;
}

export function requireConfigStringArray(config: Record<string, unknown>, key: string, label: string): string[] {
  const value = config[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} ${key} must be a non-empty array`);
  }
  return value.map((item) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error(`${label} ${key} contains a non-string item`);
    }
    return item;
  });
}

export function validateSourceCheckTargetConfig(input: { config: Record<string, unknown>; schema: SourceCheckConfigSchema; label: string }): string[] {
  const errors: string[] = [];
  const knownKeys = new Set(input.schema.fields.map((field) => field.key));
  for (const field of input.schema.fields) {
    const value = input.config[field.key];
    if (value === undefined) {
      if (field.required) errors.push(`${input.label} ${field.key} is required`);
      continue;
    }
    errors.push(...validateConfigFieldValue(value, field, input.label));
  }
  if (input.schema.allow_extra_keys !== true) {
    for (const key of Object.keys(input.config)) {
      if (!knownKeys.has(key)) errors.push(`${input.label} ${key} is not supported`);
    }
  }
  return errors;
}

function validateConfigFieldValue(value: unknown, field: SourceCheckConfigField, label: string): string[] {
  if (field.type === "string") return validateStringField(value, field, label);
  if (field.type === "string_array") return validateStringArrayField(value, field, label);
  return validatePositiveIntegerField(value, field, label);
}

function validateStringField(value: unknown, field: SourceCheckConfigField, label: string): string[] {
  if (typeof value !== "string" || value.trim().length === 0) return [`${label} ${field.key} must be a non-empty string`];
  if (field.allowed_values !== undefined && !field.allowed_values.includes(value)) {
    return [`${label} ${field.key} must be one of: ${field.allowed_values.join(", ")}`];
  }
  return [];
}

function validateStringArrayField(value: unknown, field: SourceCheckConfigField, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) return [`${label} ${field.key} must be a non-empty string array`];
  const errors: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) {
      errors.push(`${label} ${field.key} contains a non-string item`);
      continue;
    }
    if (field.allowed_values !== undefined && !field.allowed_values.includes(item)) {
      errors.push(`${label} ${field.key} item must be one of: ${field.allowed_values.join(", ")}`);
    }
  }
  return errors;
}

function validatePositiveIntegerField(value: unknown, field: SourceCheckConfigField, label: string): string[] {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return [`${label} ${field.key} must be a positive integer`];
  return [];
}
