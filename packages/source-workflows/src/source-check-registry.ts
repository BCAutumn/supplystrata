import type { DatabaseStore } from "@supplystrata/db/write";
import {
  connectorKey,
  listSourceCheckConnectorCapabilities,
  runSourceCheckConnector,
  unsupportedSourceCheckTargetMessage,
  type SourceCheckConnector,
  type SourceCheckConnectorCapability,
  type SourceCheckConnectorRunContext,
  type SourceCheckTargetRow
} from "@supplystrata/source-connectors";
import { SOURCE_CHECK_CATALOG } from "./source-check-catalog.js";
import type { SourceCheckSummary } from "./source-check-runner.js";

export const SOURCE_CHECK_CONNECTORS: readonly SourceCheckConnector<DatabaseStore, SourceCheckSummary, SourceCheckTargetRow>[] = SOURCE_CHECK_CATALOG.map(
  (entry) => entry.connector
);

export function runRegisteredSourceCheckConnector(
  store: DatabaseStore,
  target: SourceCheckTargetRow,
  context: SourceCheckConnectorRunContext
): Promise<SourceCheckSummary[]> {
  return runSourceCheckConnector(store, target, SOURCE_CHECK_CONNECTORS, context);
}

export function listSourceCheckConnectorIds(): string[] {
  return SOURCE_CHECK_CONNECTORS.map((connector) => connectorKey(connector)).sort();
}

export function listRegisteredSourceCheckConnectorCapabilities(): SourceCheckConnectorCapability[] {
  return listSourceCheckConnectorCapabilities(SOURCE_CHECK_CONNECTORS);
}

export function inferUniqueTargetKind(sourceAdapterId: string): string {
  const matches = SOURCE_CHECK_CONNECTORS.filter((connector) => connector.source_adapter_id === sourceAdapterId);
  const onlyMatch = matches[0];
  if (matches.length === 1 && onlyMatch !== undefined) return onlyMatch.target_kind;
  if (matches.length === 0) {
    throw new Error(unsupportedSourceCheckTargetMessage({ source_adapter_id: sourceAdapterId, target_kind: "(unspecified)" }, SOURCE_CHECK_CONNECTORS));
  }
  throw new Error(`Source check target kind is required for ${sourceAdapterId}; supported: ${matches.map((item) => connectorKey(item)).join(", ")}`);
}
