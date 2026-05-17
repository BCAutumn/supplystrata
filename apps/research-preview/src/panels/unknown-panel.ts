import type { WorkbenchModel } from "@supplystrata/workbench-export";

export function renderUnknownPanel(container: HTMLElement, model: WorkbenchModel | null): void {
  if (model === null) {
    container.innerHTML = `<h2>Unknown Map</h2><p class="muted">No report loaded.</p>`;
    return;
  }
  const items = model.unknown_items.slice(0, 6);
  container.innerHTML = `<h2>Unknown Map</h2>${
    items.length === 0
      ? `<p class="muted">No open unknown items.</p>`
      : `<ul class="stack-list">${items
          .map((item) => `<li><strong>${escapeHtml(item.question)}</strong><span>${escapeHtml(item.why_unknown)}</span></li>`)
          .join("")}</ul>`
  }`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
