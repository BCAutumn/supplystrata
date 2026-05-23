import type { RelationType } from "@supplystrata/core";
import type { AppleSuppliersPreview, NvidiaResearchReportPreview, SupplyChainPreview } from "@supplystrata/source-workflows";
import type { OutputFormat } from "@supplystrata/render";
import type { PreviewFormat } from "./cli-utils.js";
import { renderAppleSupplierCandidatesCsv } from "./preview-csv.js";
import { renderResearchReportZh } from "./preview-report-zh.js";

export function renderAppleSuppliersPreview(result: AppleSuppliersPreview, format: PreviewFormat, limit: number): string {
  if (format === "json") return JSON.stringify({ schema_version: "1.0.0", preview: result }, null, 2);
  if (format === "csv") return renderAppleSupplierCandidatesCsv(result);
  const sourceDate = result.source_date === undefined ? "" : ` ${result.source_date}`;
  const lines = [
    "# Apple Supplier List Semi-auto Preview",
    "",
    `Document: supplier_list${sourceDate}`,
    `URL: ${result.fetched_url}`,
    `Chunks: ${result.chunks}`,
    `Candidate rows: ${result.candidates.length}`,
    "",
    "## Review Required",
    "",
    "这些是 PDF 表格解析出的候选行，只能进入人工 review，不能直接自动 apply 到图谱。",
    "",
    "## Sample Candidates",
    ""
  ];
  for (const candidate of result.candidates.slice(0, limit)) {
    lines.push(`- Apple -> ${candidate.supplier_name}; ${candidate.location_text}; ${candidate.country_or_region}`);
  }
  if (result.candidates.length > limit)
    lines.push(``, `... ${result.candidates.length - limit} more rows omitted; use --format csv for the full review sheet.`);
  return lines.join("\n");
}

export function renderPreview(result: SupplyChainPreview, format: OutputFormat): string {
  if (format === "json") return JSON.stringify({ schema_version: "1.0.0", preview: result }, null, 2);
  const sourceDate = result.source_date === undefined ? "" : ` ${result.source_date}`;
  const lines = [
    "# NVIDIA Supply Chain Research Preview",
    "",
    `Document: ${result.document_type}${sourceDate}`,
    `URL: ${result.fetched_url}`,
    `Chunks: ${result.chunks}`,
    `Directly supported relations: ${result.candidates.length}`,
    "",
    "## Known Upstream From Public Disclosure",
    ""
  ];
  if (result.candidates.length === 0) {
    lines.push("(no relation candidates found)", "");
  }
  for (const candidate of sortPreviewCandidates(result.candidates)) {
    const component = candidate.component === undefined ? "" : ` (${candidate.component})`;
    const subject = candidate.subject_name ?? candidate.subject_surface;
    const object = candidate.object_name ?? candidate.object_surface;
    const subjectId = candidate.subject_entity_id === undefined ? "" : ` [${candidate.subject_entity_id}]`;
    const objectId = candidate.object_entity_id === undefined ? "" : ` [${candidate.object_entity_id}]`;
    lines.push(`- ${subject}${subjectId} -${candidate.relation}${component}-> ${object}${objectId}`);
    lines.push(`  Level ${candidate.evidence_level}, confidence ${candidate.confidence.toFixed(3)}, review ${candidate.needs_review ? "yes" : "no"}`);
    lines.push(`  Resolve: subject=${candidate.subject_resolution}, object=${candidate.object_resolution}`);
    lines.push(`  "${candidate.cite_text}"`);
    lines.push("");
  }
  lines.push("## Unknown Map", "");
  for (const item of defaultNvidiaUnknownMap()) {
    lines.push(`- ${item}`);
  }
  lines.push(
    "",
    "## Reading Rule",
    "",
    "This preview only states relationships supported by quoted public filing text. It does not estimate allocation, pricing, volume, or investment impact."
  );
  return lines.join("\n");
}

export function renderResearchReport(result: NvidiaResearchReportPreview, format: OutputFormat, language: "en" | "zh"): string {
  if (format === "json") return JSON.stringify({ schema_version: "1.0.0", report: result }, null, 2);
  if (language === "zh") return renderResearchReportZh(result);
  const nvidiaDate = result.nvidia.source_date === undefined ? "" : ` ${result.nvidia.source_date}`;
  const tsmcDate = result.tsmc.source_date === undefined ? "" : ` ${result.tsmc.source_date}`;
  const lines = [
    "# NVIDIA Supply Chain Research Memo",
    "",
    "## Scope",
    "",
    `Primary source: NVIDIA ${result.nvidia.document_type}${nvidiaDate}`,
    `Corroborating source: TSMC 2025 Annual Report${tsmcDate}`,
    "",
    "## Directly Supported Upstream",
    ""
  ];
  for (const candidate of sortPreviewCandidates(result.nvidia.candidates)) {
    const component = candidate.component === undefined ? "" : ` (${candidate.component})`;
    const object = candidate.object_name ?? candidate.object_surface;
    const objectId = candidate.object_entity_id === undefined ? "" : ` [${candidate.object_entity_id}]`;
    lines.push(`- ${candidate.relation}${component} -> ${object}${objectId} [Level ${candidate.evidence_level}, conf ${candidate.confidence.toFixed(3)}]`);
    lines.push(`  Evidence: "${candidate.cite_text}"`);
    lines.push("");
  }
  lines.push("## TSMC Context", "");
  lines.push(
    result.tsmc.mentions_nvidia
      ? "- TSMC annual report mentions NVIDIA by name."
      : "- TSMC annual report context was parsed, but this preview did not find NVIDIA mentioned by name. Treat it as capability/context evidence, not a bilateral confirmation."
  );
  for (const signal of result.tsmc.signals) {
    lines.push(`- ${signal.title} [Level ${signal.evidence_level}, conf ${signal.confidence.toFixed(3)}]`);
    lines.push(`  Evidence: "${signal.cite_text}"`);
  }
  appendOfficialSignals(lines, "Samsung Context", result.samsung.signals);
  appendOfficialSignals(lines, "SK hynix Context", result.skhynix.signals);
  appendOfficialSignals(lines, "ASML Context", result.asml.signals);
  lines.push("", "## Unknown Map", "");
  for (const item of defaultNvidiaUnknownMap()) {
    lines.push(`- ${item}`);
  }
  lines.push(
    "",
    "## Bottom Line",
    "",
    "The current evidence supports a first-hop upstream map for foundry, memory, and manufacturing-services relationships. It does not support customer allocation, pricing, shipment volume, or investment conclusions."
  );
  return lines.join("\n");
}

function appendOfficialSignals(lines: string[], title: string, signals: NvidiaResearchReportPreview["skhynix"]["signals"]): void {
  lines.push("", `## ${title}`, "");
  if (signals.length === 0) {
    lines.push("- No high-confidence preview signals extracted yet.");
    return;
  }
  for (const signal of signals) {
    lines.push(`- ${signal.title} [Level ${signal.evidence_level}, conf ${signal.confidence.toFixed(3)}]`);
    lines.push(`  Evidence: "${signal.cite_text}"`);
  }
}

function sortPreviewCandidates(candidates: SupplyChainPreview["candidates"]): SupplyChainPreview["candidates"] {
  const relationRank: ReadonlyMap<RelationType, number> = new Map([
    ["USES_FOUNDRY", 1],
    ["BUYS_FROM", 2],
    ["SUPPLIES_TO", 3]
  ]);
  return [...candidates].sort((left, right) => {
    const relationDelta = (relationRank.get(left.relation) ?? 99) - (relationRank.get(right.relation) ?? 99);
    if (relationDelta !== 0) return relationDelta;
    return (left.object_name ?? left.object_surface).localeCompare(right.object_name ?? right.object_surface);
  });
}

function defaultNvidiaUnknownMap(): string[] {
  return [
    "Exact HBM allocation by customer is not publicly disclosed.",
    "Contract pricing, rebates, and capacity reservation terms are not publicly disclosed.",
    "Quarterly shipment volume by upstream supplier is not available from this filing.",
    "Specific facility-level production split is not disclosed.",
    "Shipping routes, carriers, and inventory positions are outside this SEC-only preview."
  ];
}
