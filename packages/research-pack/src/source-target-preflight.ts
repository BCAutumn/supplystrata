export type SourceTargetPreflightStatus = "checked" | "failed" | "skipped";
export type SourceTargetPreflightIssueKind =
  | "missing_credentials"
  | "target_config_invalid"
  | "connector_unsupported"
  | "source_unreachable"
  | "source_response_error"
  | "adapter_error";

export interface SourceTargetPreflightDocument {
  task_id: string;
  source_url: string;
  doc_id: string;
  document_type?: string;
  source_date?: string;
  source_fetch_status?: "live" | "fallback";
  text_chars?: number;
  chunks?: number;
}

export interface SourceTargetPreflightMissingCredential {
  env_key: string;
  description: string;
  required: boolean;
}

export interface SourceTargetPreflightItem {
  check_target_id: string;
  source_adapter_id: string;
  target_kind: string;
  status: SourceTargetPreflightStatus;
  planned_tasks: number;
  fetched_documents: number;
  normalized_documents: number;
  degraded_documents: number;
  documents: readonly SourceTargetPreflightDocument[];
  issue_kind?: SourceTargetPreflightIssueKind;
  error_message?: string;
  missing_credentials?: readonly SourceTargetPreflightMissingCredential[];
}

export interface SourceTargetPreflightSummary {
  requested_targets: number;
  selected_targets: number;
  checked_targets: number;
  failed_targets: number;
  skipped_targets: number;
  planned_tasks: number;
  fetched_documents: number;
  normalized_documents: number;
  degraded_documents: number;
  by_source: Record<string, number>;
  by_source_status: Record<string, SourceTargetPreflightSourceSummary>;
}

export interface SourceTargetPreflightSourceSummary {
  selected_targets: number;
  checked_targets: number;
  failed_targets: number;
  skipped_targets: number;
  planned_tasks: number;
  fetched_documents: number;
  normalized_documents: number;
  degraded_documents: number;
  target_kinds: Record<string, number>;
  issue_kinds: Record<string, number>;
}

export interface SourceTargetPreflightReport {
  schema_version: "1.0.0";
  summary: SourceTargetPreflightSummary;
  items: readonly SourceTargetPreflightItem[];
}

export function parseSourceTargetPreflightReport(text: string): SourceTargetPreflightReport {
  const parsed: unknown = JSON.parse(text);
  const root = requireRecord(parsed, "source target preflight report");
  if (root["schema_version"] !== "1.0.0") throw new Error("source target preflight report schema_version must be 1.0.0");
  const itemsValue = root["items"];
  if (!Array.isArray(itemsValue)) throw new Error("source target preflight report items must be an array");
  const items = itemsValue.map((item, index) => parseItem(item, `source target preflight item[${index}]`));
  const summary = parseSummary(root["summary"], items);
  return {
    schema_version: "1.0.0",
    summary,
    items
  };
}

export function renderSourceTargetPreflightMarkdown(report: SourceTargetPreflightReport): string {
  const lines = [
    "# Source Target Preflight",
    "",
    "This report is an explicit no-database source-plan smoke result. It proves only plan/fetch/normalize reachability; it does not write source monitor events, observations, or fact edges.",
    "",
    "## Summary",
    "",
    `- Requested targets: ${report.summary.requested_targets}`,
    `- Selected targets: ${report.summary.selected_targets}`,
    `- Checked targets: ${report.summary.checked_targets}`,
    `- Failed targets: ${report.summary.failed_targets}`,
    `- Skipped targets: ${report.summary.skipped_targets}`,
    `- Planned tasks: ${report.summary.planned_tasks}`,
    `- Fetched documents: ${report.summary.fetched_documents}`,
    `- Normalized documents: ${report.summary.normalized_documents}`,
    `- Degraded documents: ${report.summary.degraded_documents}`,
    "",
    "## By Source",
    ""
  ];
  for (const [source, count] of Object.entries(report.summary.by_source)) lines.push(`- ${source}: ${count}`);
  lines.push("", "## Source Readiness Matrix", "");
  for (const [source, summary] of Object.entries(report.summary.by_source_status)) {
    const targetKinds = Object.entries(summary.target_kinds)
      .map(([targetKind, count]) => `${targetKind}:${count}`)
      .join(", ");
    const issueKinds = Object.entries(summary.issue_kinds)
      .map(([issueKind, count]) => `${issueKind}:${count}`)
      .join(", ");
    lines.push(
      `- ${source}: checked=${summary.checked_targets}; failed=${summary.failed_targets}; skipped=${summary.skipped_targets}; normalized=${summary.normalized_documents}; degraded=${summary.degraded_documents}; target_kinds=${targetKinds.length === 0 ? "none" : targetKinds}; issue_kinds=${issueKinds.length === 0 ? "none" : issueKinds}`
    );
  }
  lines.push("", "## Targets", "");
  for (const item of report.items) {
    lines.push(`- ${item.status} ${item.check_target_id} (${item.source_adapter_id}/${item.target_kind})`);
    lines.push(
      `  Tasks: ${item.planned_tasks}; fetched: ${item.fetched_documents}; normalized: ${item.normalized_documents}; degraded: ${item.degraded_documents}`
    );
    if (item.issue_kind !== undefined) lines.push(`  Issue kind: ${item.issue_kind}`);
    if (item.missing_credentials !== undefined && item.missing_credentials.length > 0) {
      lines.push(`  Missing credentials: ${item.missing_credentials.map((credential) => credential.env_key).join(", ")}`);
    }
    if (item.error_message !== undefined) lines.push(`  Error: ${item.error_message}`);
    for (const document of item.documents.slice(0, 3)) {
      lines.push(
        `  - ${document.task_id}: ${document.document_type ?? "raw"}${document.source_date === undefined ? "" : ` @ ${document.source_date}`} (${document.text_chars ?? 0} chars)`
      );
      lines.push(`    URL: ${document.source_url}`);
    }
    if (item.documents.length > 3) lines.push(`  More documents: ${item.documents.length - 3}`);
  }
  return lines.join("\n");
}

function parseSummary(value: unknown, items: readonly SourceTargetPreflightItem[]): SourceTargetPreflightSummary {
  const summary = requireRecord(value, "source target preflight summary");
  const bySourceStatus = optionalSourceSummaryMap(summary["by_source_status"]) ?? summarizeItemsBySource(items);
  return {
    requested_targets: requireNonNegativeInteger(summary["requested_targets"], "source target preflight summary requested_targets"),
    selected_targets: requireNonNegativeInteger(summary["selected_targets"], "source target preflight summary selected_targets"),
    checked_targets: requireNonNegativeInteger(summary["checked_targets"], "source target preflight summary checked_targets"),
    failed_targets: requireNonNegativeInteger(summary["failed_targets"], "source target preflight summary failed_targets"),
    skipped_targets: requireNonNegativeInteger(summary["skipped_targets"], "source target preflight summary skipped_targets"),
    planned_tasks: requireNonNegativeInteger(summary["planned_tasks"], "source target preflight summary planned_tasks"),
    fetched_documents: requireNonNegativeInteger(summary["fetched_documents"], "source target preflight summary fetched_documents"),
    normalized_documents: requireNonNegativeInteger(summary["normalized_documents"], "source target preflight summary normalized_documents"),
    degraded_documents: requireNonNegativeInteger(summary["degraded_documents"], "source target preflight summary degraded_documents"),
    by_source: parseCountMap(summary["by_source"], "source target preflight summary by_source"),
    by_source_status: bySourceStatus
  };
}

function optionalSourceSummaryMap(value: unknown): Record<string, SourceTargetPreflightSourceSummary> | undefined {
  if (value === undefined) return undefined;
  const record = requireRecord(value, "source target preflight summary by_source_status");
  const entries = Object.entries(record).map(
    ([source, summary]) => [source, parseSourceSummary(summary, `source target preflight summary by_source_status ${source}`)] as const
  );
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

function parseSourceSummary(value: unknown, label: string): SourceTargetPreflightSourceSummary {
  const summary = requireRecord(value, label);
  return {
    selected_targets: requireNonNegativeInteger(summary["selected_targets"], `${label} selected_targets`),
    checked_targets: requireNonNegativeInteger(summary["checked_targets"], `${label} checked_targets`),
    failed_targets: requireNonNegativeInteger(summary["failed_targets"], `${label} failed_targets`),
    skipped_targets: requireNonNegativeInteger(summary["skipped_targets"], `${label} skipped_targets`),
    planned_tasks: requireNonNegativeInteger(summary["planned_tasks"], `${label} planned_tasks`),
    fetched_documents: requireNonNegativeInteger(summary["fetched_documents"], `${label} fetched_documents`),
    normalized_documents: requireNonNegativeInteger(summary["normalized_documents"], `${label} normalized_documents`),
    degraded_documents: requireNonNegativeInteger(summary["degraded_documents"], `${label} degraded_documents`),
    target_kinds: parseCountMap(summary["target_kinds"], `${label} target_kinds`),
    issue_kinds: parseOptionalCountMap(summary["issue_kinds"], `${label} issue_kinds`)
  };
}

function parseItem(value: unknown, label: string): SourceTargetPreflightItem {
  const item = requireRecord(value, label);
  const documentsValue = item["documents"];
  if (!Array.isArray(documentsValue)) throw new Error(`${label} documents must be an array`);
  const errorMessage = optionalString(item["error_message"]);
  const issueKind = optionalIssueKind(item["issue_kind"], `${label} issue_kind`);
  const missingCredentials = optionalMissingCredentials(item["missing_credentials"], `${label} missing_credentials`);
  return {
    check_target_id: requireString(item["check_target_id"], `${label} check_target_id`),
    source_adapter_id: requireString(item["source_adapter_id"], `${label} source_adapter_id`),
    target_kind: requireString(item["target_kind"], `${label} target_kind`),
    status: requireStatus(item["status"], `${label} status`),
    planned_tasks: requireNonNegativeInteger(item["planned_tasks"], `${label} planned_tasks`),
    fetched_documents: requireNonNegativeInteger(item["fetched_documents"], `${label} fetched_documents`),
    normalized_documents: requireNonNegativeInteger(item["normalized_documents"], `${label} normalized_documents`),
    degraded_documents: requireNonNegativeInteger(item["degraded_documents"], `${label} degraded_documents`),
    documents: documentsValue.map((document, index) => parseDocument(document, `${label} documents[${index}]`)),
    ...(issueKind === undefined ? {} : { issue_kind: issueKind }),
    ...(errorMessage === undefined ? {} : { error_message: errorMessage }),
    ...(missingCredentials === undefined ? {} : { missing_credentials: missingCredentials })
  };
}

function optionalMissingCredentials(value: unknown, label: string): readonly SourceTargetPreflightMissingCredential[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => parseMissingCredential(item, `${label}[${index}]`));
}

function parseMissingCredential(value: unknown, label: string): SourceTargetPreflightMissingCredential {
  const credential = requireRecord(value, label);
  return {
    env_key: requireString(credential["env_key"], `${label} env_key`),
    description: requireString(credential["description"], `${label} description`),
    required: requireBoolean(credential["required"], `${label} required`)
  };
}

function parseDocument(value: unknown, label: string): SourceTargetPreflightDocument {
  const document = requireRecord(value, label);
  const documentType = optionalString(document["document_type"]);
  const sourceDate = optionalString(document["source_date"]);
  const sourceFetchStatus = optionalSourceFetchStatus(document["source_fetch_status"], `${label} source_fetch_status`);
  const textChars = optionalNonNegativeInteger(document["text_chars"], `${label} text_chars`);
  const chunks = optionalNonNegativeInteger(document["chunks"], `${label} chunks`);
  return {
    task_id: requireString(document["task_id"], `${label} task_id`),
    source_url: requireString(document["source_url"], `${label} source_url`),
    doc_id: requireString(document["doc_id"], `${label} doc_id`),
    ...(documentType === undefined ? {} : { document_type: documentType }),
    ...(sourceDate === undefined ? {} : { source_date: sourceDate }),
    ...(sourceFetchStatus === undefined ? {} : { source_fetch_status: sourceFetchStatus }),
    ...(textChars === undefined ? {} : { text_chars: textChars }),
    ...(chunks === undefined ? {} : { chunks })
  };
}

function parseCountMap(value: unknown, label: string): Record<string, number> {
  const record = requireRecord(value, label);
  const entries: [string, number][] = Object.entries(record).map(([key, count]) => [key, requireNonNegativeInteger(count, `${label} ${key}`)]);
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

function parseOptionalCountMap(value: unknown, label: string): Record<string, number> {
  if (value === undefined) return {};
  return parseCountMap(value, label);
}

function summarizeItemsBySource(items: readonly SourceTargetPreflightItem[]): Record<string, SourceTargetPreflightSourceSummary> {
  const bySource = new Map<string, SourceTargetPreflightItem[]>();
  for (const item of items) {
    const sourceItems = bySource.get(item.source_adapter_id);
    if (sourceItems === undefined) bySource.set(item.source_adapter_id, [item]);
    else sourceItems.push(item);
  }
  const summaries: Record<string, SourceTargetPreflightSourceSummary> = {};
  for (const [source, sourceItems] of [...bySource.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    summaries[source] = {
      selected_targets: sourceItems.length,
      checked_targets: sourceItems.filter((item) => item.status === "checked").length,
      failed_targets: sourceItems.filter((item) => item.status === "failed").length,
      skipped_targets: sourceItems.filter((item) => item.status === "skipped").length,
      planned_tasks: sumItems(sourceItems, (item) => item.planned_tasks),
      fetched_documents: sumItems(sourceItems, (item) => item.fetched_documents),
      normalized_documents: sumItems(sourceItems, (item) => item.normalized_documents),
      degraded_documents: sumItems(sourceItems, (item) => item.degraded_documents),
      target_kinds: countItemsBy(sourceItems, (item) => item.target_kind),
      issue_kinds: countItemsBy(
        sourceItems.filter((item) => item.issue_kind !== undefined),
        (item) => item.issue_kind ?? "adapter_error"
      )
    };
  }
  return summaries;
}

function sumItems(items: readonly SourceTargetPreflightItem[], valueForItem: (item: SourceTargetPreflightItem) => number): number {
  return items.reduce((sum, item) => sum + valueForItem(item), 0);
}

function countItemsBy(items: readonly SourceTargetPreflightItem[], keyForItem: (item: SourceTargetPreflightItem) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyForItem(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function requireStatus(value: unknown, label: string): SourceTargetPreflightStatus {
  if (value === "checked" || value === "failed" || value === "skipped") return value;
  throw new Error(`${label} must be checked, failed, or skipped`);
}

function optionalIssueKind(value: unknown, label: string): SourceTargetPreflightIssueKind | undefined {
  if (value === undefined) return undefined;
  if (
    value === "missing_credentials" ||
    value === "target_config_invalid" ||
    value === "connector_unsupported" ||
    value === "source_unreachable" ||
    value === "source_response_error" ||
    value === "adapter_error"
  )
    return value;
  throw new Error(`${label} must be a supported source target preflight issue kind`);
}

function optionalSourceFetchStatus(value: unknown, label: string): "live" | "fallback" | undefined {
  if (value === undefined) return undefined;
  if (value === "live" || value === "fallback") return value;
  throw new Error(`${label} must be live or fallback`);
}

function optionalNonNegativeInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  return requireNonNegativeInteger(value, label);
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
