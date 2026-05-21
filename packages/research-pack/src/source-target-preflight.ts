export type SourceTargetPreflightStatus = "checked" | "failed" | "skipped";

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
  error_message?: string;
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
  const summary = parseSummary(root["summary"]);
  const itemsValue = root["items"];
  if (!Array.isArray(itemsValue)) throw new Error("source target preflight report items must be an array");
  return {
    schema_version: "1.0.0",
    summary,
    items: itemsValue.map((item, index) => parseItem(item, `source target preflight item[${index}]`))
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
  lines.push("", "## Targets", "");
  for (const item of report.items) {
    lines.push(`- ${item.status} ${item.check_target_id} (${item.source_adapter_id}/${item.target_kind})`);
    lines.push(
      `  Tasks: ${item.planned_tasks}; fetched: ${item.fetched_documents}; normalized: ${item.normalized_documents}; degraded: ${item.degraded_documents}`
    );
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

function parseSummary(value: unknown): SourceTargetPreflightSummary {
  const summary = requireRecord(value, "source target preflight summary");
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
    by_source: parseCountMap(summary["by_source"], "source target preflight summary by_source")
  };
}

function parseItem(value: unknown, label: string): SourceTargetPreflightItem {
  const item = requireRecord(value, label);
  const documentsValue = item["documents"];
  if (!Array.isArray(documentsValue)) throw new Error(`${label} documents must be an array`);
  const errorMessage = optionalString(item["error_message"]);
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
    ...(errorMessage === undefined ? {} : { error_message: errorMessage })
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

function requireStatus(value: unknown, label: string): SourceTargetPreflightStatus {
  if (value === "checked" || value === "failed" || value === "skipped") return value;
  throw new Error(`${label} must be checked, failed, or skipped`);
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
