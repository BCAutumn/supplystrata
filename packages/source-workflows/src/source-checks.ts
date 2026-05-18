import type { DatabaseStore } from "@supplystrata/db";
import { listDueSourceChecks, type DueSourceCheckRow } from "@supplystrata/source-monitor";
import {
  connectorKey,
  listSourceCheckConnectorCapabilities,
  runSourceCheckConnector,
  unsupportedSourceCheckTargetMessage,
  type SourceCheckConnectorCapability,
  type SourceCheckConnector,
  type SourceCheckTargetRow
} from "@supplystrata/source-connectors";
import { censusTradeSourceCheckConnector } from "./census-trade-checks.js";
import { officialIrSourceCheckConnectors } from "./official-ir-checks.js";
import { oshSourceCheckConnector } from "./osh-checks.js";
import { secEdgarSourceCheckConnector } from "./sec-edgar.js";
import { worldBankPinkSourceCheckConnector } from "./worldbank-pink-checks.js";
import type { SourceCheckSummary } from "./source-check-runner.js";

export interface DueSourceCheckRunItem {
  check_target_id: string;
  source_adapter_id: string;
  target_kind: string;
  subject_entity_id: string | null;
  status: "checked";
  checked_documents: number;
  summaries: SourceCheckSummary[];
}

export interface DueSourceCheckRunResult {
  due_targets: number;
  checked_targets: number;
  items: DueSourceCheckRunItem[];
}

export interface ManualSourceCheckInput {
  source_adapter_id: string;
  target_kind?: string;
  target_config: Record<string, unknown>;
  check_target_id?: string;
  subject_entity_id?: string;
}

export async function runDueSourceChecks(store: DatabaseStore, input: { now?: string; limit?: number } = {}): Promise<DueSourceCheckRunResult> {
  const due = await listDueSourceChecks(store, input);
  const items: DueSourceCheckRunItem[] = [];
  for (const target of due) {
    items.push(await runDueSourceCheckTarget(store, target));
  }
  return {
    due_targets: due.length,
    checked_targets: items.length,
    items
  };
}

const SOURCE_CHECK_CONNECTORS: readonly SourceCheckConnector<DatabaseStore, SourceCheckSummary, DueSourceCheckRow>[] = [
  secEdgarSourceCheckConnector,
  ...officialIrSourceCheckConnectors,
  censusTradeSourceCheckConnector,
  oshSourceCheckConnector,
  worldBankPinkSourceCheckConnector
];

async function runDueSourceCheckTarget(store: DatabaseStore, target: DueSourceCheckRow): Promise<DueSourceCheckRunItem> {
  const summaries = await runSourceCheckConnector(store, target, SOURCE_CHECK_CONNECTORS);
  return {
    check_target_id: target.check_target_id,
    source_adapter_id: target.source_adapter_id,
    target_kind: target.target_kind,
    subject_entity_id: target.subject_entity_id,
    status: "checked",
    checked_documents: summaries.length,
    summaries
  };
}

export async function runManualSourceCheck(store: DatabaseStore, input: ManualSourceCheckInput): Promise<SourceCheckSummary[]> {
  const target = manualSourceCheckTarget(input);
  return runSourceCheckConnector(store, target, SOURCE_CHECK_CONNECTORS);
}

export function listSourceCheckConnectorIds(): string[] {
  return SOURCE_CHECK_CONNECTORS.map((connector) => connectorKey(connector)).sort();
}

export function listRegisteredSourceCheckConnectorCapabilities(): SourceCheckConnectorCapability[] {
  return listSourceCheckConnectorCapabilities(SOURCE_CHECK_CONNECTORS);
}

function manualSourceCheckTarget(input: ManualSourceCheckInput): SourceCheckTargetRow {
  const targetKind = input.target_kind ?? inferUniqueTargetKind(input.source_adapter_id);
  return {
    check_target_id: input.check_target_id ?? `manual:${input.source_adapter_id}:${targetKind}`,
    source_adapter_id: input.source_adapter_id,
    target_kind: targetKind,
    target_config: input.target_config
  };
}

function inferUniqueTargetKind(sourceAdapterId: string): string {
  const matches = SOURCE_CHECK_CONNECTORS.filter((connector) => connector.source_adapter_id === sourceAdapterId);
  const onlyMatch = matches[0];
  if (matches.length === 1 && onlyMatch !== undefined) return onlyMatch.target_kind;
  if (matches.length === 0) {
    throw new Error(unsupportedSourceCheckTargetMessage({ source_adapter_id: sourceAdapterId, target_kind: "(unspecified)" }, SOURCE_CHECK_CONNECTORS));
  }
  throw new Error(`Source check target kind is required for ${sourceAdapterId}; supported: ${matches.map((item) => connectorKey(item)).join(", ")}`);
}
