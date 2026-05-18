import type { DatabaseStore } from "@supplystrata/db";
import { listDueSourceChecks, type DueSourceCheckRow } from "@supplystrata/source-monitor";
import { runSourceCheckConnector, type SourceCheckConnector } from "@supplystrata/source-connectors";
import { censusTradeSourceCheckConnector } from "./census-trade-checks.js";
import { officialIrSourceCheckConnectors } from "./official-ir-checks.js";
import { oshSourceCheckConnector } from "./osh-checks.js";
import { secEdgarSourceCheckConnector } from "./sec-edgar.js";
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
  oshSourceCheckConnector
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
