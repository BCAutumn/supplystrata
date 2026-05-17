import type { WorkbenchModel } from "@supplystrata/workbench-export";

export function renderSourceHealthPanel(container: HTMLElement, model: WorkbenchModel | null): void {
  if (model === null) {
    container.innerHTML = `<h2>Source Health</h2><p class="muted">No source health loaded.</p>`;
    return;
  }
  const rows = model.sources.slice(0, 8);
  container.innerHTML = `<h2>Source Health</h2>${
    rows.length === 0
      ? `<p class="muted">No source rows exported yet.</p>`
      : `<ul class="stack-list compact">${rows
          .map(
            (row) =>
              `<li><strong>${escapeHtml(row.source_adapter_id)}</strong><span>${escapeHtml(row.registry_status)} · next ${escapeHtml(
                formatNullableDate(row.next_check_at)
              )}</span></li>`
          )
          .join("")}</ul>`
  }`;
}

function formatNullableDate(value: Date | string | null): string {
  if (value === null) return "unknown";
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
