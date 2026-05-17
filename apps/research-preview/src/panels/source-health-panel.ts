import type { WorkbenchModel } from "@supplystrata/workbench-export";

export function renderSourceHealthPanel(container: HTMLElement, model: WorkbenchModel | null): void {
  if (model === null) {
    container.innerHTML = `<h2>Source Health</h2><p class="muted">No source health loaded.</p>`;
    return;
  }
  const rows = model.sources.slice(0, 8);
  const plan = selectRepresentativeSourcePlanRows(model.source_plan);
  container.innerHTML = `<h2>Source Health</h2>${renderHealthRows(rows)}<h2>Source Plan</h2>${renderSourcePlanRows(plan)}`;
}

function renderHealthRows(rows: WorkbenchModel["sources"]): string {
  if (rows.length === 0) return `<p class="muted">No source rows exported yet.</p>`;
  return `<ul class="stack-list compact">${rows
    .map(
      (row) =>
        `<li><strong>${escapeHtml(row.source_adapter_id)}</strong><span>${escapeHtml(row.registry_status)} · next ${escapeHtml(
          formatNullableDate(row.next_check_at)
        )}</span></li>`
    )
    .join("")}</ul>`;
}

function renderSourcePlanRows(rows: WorkbenchModel["source_plan"]): string {
  if (rows.length === 0) return `<p class="muted">No component source plan exported yet.</p>`;
  return `<ul class="stack-list compact">${rows
    .map(
      (row) =>
        `<li><strong>${escapeHtml(row.source_id)}</strong><span>${escapeHtml(row.expected_output_layer)} · ${escapeHtml(
          row.relation_policy
        )} · ${escapeHtml(row.status)}</span></li>`
    )
    .join("")}</ul>`;
}

function selectRepresentativeSourcePlanRows(rows: WorkbenchModel["source_plan"]): WorkbenchModel["source_plan"] {
  const edgeRows = rows.filter((row) => row.expected_output_layer === "edge").slice(0, 4);
  const observationRows = rows.filter((row) => row.expected_output_layer === "observation").slice(0, 4);
  const leadRows = rows.filter((row) => row.expected_output_layer === "lead").slice(0, 3);
  const entityRows = rows.filter((row) => row.expected_output_layer === "entity").slice(0, 1);
  return [...edgeRows, ...observationRows, ...leadRows, ...entityRows];
}

function formatNullableDate(value: Date | string | null): string {
  if (value === null) return "unknown";
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
