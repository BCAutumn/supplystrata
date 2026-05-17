import type { ChainViewSegmentModel } from "@supplystrata/chain-view";
import type { WorkbenchModel } from "@supplystrata/workbench-export";

export function renderEvidencePanel(container: HTMLElement, model: WorkbenchModel | null, segment: ChainViewSegmentModel | null): void {
  if (model === null) {
    container.innerHTML = `<h2>Inspector</h2><p class="muted">Load a workbench JSON export to inspect chain segments.</p>`;
    return;
  }
  if (segment === null) {
    container.innerHTML = `<h2>Inspector</h2><p class="muted">Click a fact edge, observation, lead, or unknown boundary on the canvas.</p>`;
    return;
  }
  const evidence = segment.evidence_ids.length === 0 ? null : model.evidences.find((item) => item.evidence_id === segment.evidence_ids[0]);
  const evidenceHtml =
    evidence === null || evidence === undefined
      ? `<p class="muted">No primary evidence attached to this context segment.</p>`
      : `<dl>
          <dt>Evidence</dt><dd>${escapeHtml(evidence.evidence_id)} · Level ${evidence.evidence_level}</dd>
          <dt>Source</dt><dd><a href="${escapeAttribute(evidence.source_url)}" target="_blank" rel="noreferrer">${escapeHtml(evidence.source_adapter_id)}</a></dd>
          <dt>Locator</dt><dd>${escapeHtml(evidence.cite_locator ?? "(not recorded)")}</dd>
          <dt>Cite</dt><dd>${escapeHtml(evidence.cite_text)}</dd>
        </dl>`;
  container.innerHTML = `<h2>${escapeHtml(segment.semantic_layer)} segment</h2>
    <dl>
      <dt>Relation</dt><dd>${escapeHtml(segment.relation)}</dd>
      <dt>From</dt><dd>${escapeHtml(segment.from.name)} [${escapeHtml(segment.from.id)}]</dd>
      <dt>To</dt><dd>${escapeHtml(segment.to.name)} [${escapeHtml(segment.to.id)}]</dd>
      <dt>Confidence</dt><dd>${segment.confidence.toFixed(3)}</dd>
      <dt>Label</dt><dd>${escapeHtml(segment.label)}</dd>
    </dl>
    ${evidenceHtml}`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
