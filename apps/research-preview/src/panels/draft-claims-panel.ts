import type { WorkbenchModel } from "@supplystrata/workbench-export";

export function renderDraftClaimsPanel(container: HTMLElement, model: WorkbenchModel | null): void {
  if (model === null) {
    container.innerHTML = `<h2>Draft Claims</h2><p class="muted">No report loaded.</p>`;
    return;
  }
  const items = model.draft_claims.slice(0, 6);
  container.innerHTML = `<h2>Draft Claims</h2>${
    items.length === 0
      ? `<p class="muted">No reviewed semantic-change drafts.</p>`
      : `<ul class="stack-list">${items
          .map(
            (item) =>
              `<li><strong>${escapeHtml(item.claim_type)}</strong><span>${escapeHtml(item.claim_text)}</span><span>${escapeHtml(
                item.review_id ?? item.claim_id
              )} · confidence ${item.confidence.toFixed(2)}</span></li>`
          )
          .join("")}</ul>`
  }`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
