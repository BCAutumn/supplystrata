import type { WorkbenchModel } from "@supplystrata/workbench-export";

export function renderChangesTimeline(container: HTMLElement, model: WorkbenchModel | null): void {
  if (model === null) {
    container.innerHTML = `<h2>Changes</h2><p class="muted">No timeline loaded.</p>`;
    return;
  }
  const rows = model.changes.slice(0, 8);
  container.innerHTML = `<h2>Changes</h2>${
    rows.length === 0
      ? `<p class="muted">No recent changes in this export.</p>`
      : `<ul class="stack-list compact">${rows
          .map(
            (row) =>
              `<li><strong>${escapeHtml(row.event_type)}</strong><span>${escapeHtml(row.occurred_at.slice(0, 19))} · ${escapeHtml(
                row.event_family
              )}</span></li>`
          )
          .join("")}</ul>`
  }`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
