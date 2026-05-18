export interface SourceCheckTargetRow {
  check_target_id: string;
  source_adapter_id: string;
  target_kind: string;
  target_config: Record<string, unknown>;
}

export interface SourceCheckConnector<TStore, TResult, TTarget extends SourceCheckTargetRow = SourceCheckTargetRow> {
  readonly source_adapter_id: string;
  readonly target_kind: string;
  run(store: TStore, target: TTarget): Promise<TResult[]>;
}

export function connectorKey(input: Pick<SourceCheckTargetRow, "source_adapter_id" | "target_kind">): string {
  return `${input.source_adapter_id}/${input.target_kind}`;
}

export function listSourceCheckConnectorKeys(connectors: readonly SourceCheckConnector<unknown, unknown>[]): string[] {
  return connectors.map((connector) => connectorKey(connector)).sort();
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
