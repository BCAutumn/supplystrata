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
  const evidences = evidencesForSegment(model, segment);
  const evidenceHtml =
    evidences.length === 0
      ? `<p class="muted">No evidence attached to this context segment.</p>`
      : evidences.map((evidence, index) => renderEvidenceItem(evidence, index === 0)).join("");
  const sourceHintsHtml = renderSourceHints(segment);
  container.innerHTML = `<h2>${escapeHtml(segment.semantic_layer)} segment</h2>
    <dl>
      <dt>Relation</dt><dd>${escapeHtml(segment.relation)}</dd>
      <dt>From</dt><dd>${escapeHtml(segment.from.name)} [${escapeHtml(segment.from.id)}]</dd>
      <dt>To</dt><dd>${escapeHtml(segment.to.name)} [${escapeHtml(segment.to.id)}]</dd>
      <dt>Confidence</dt><dd>${segment.confidence.toFixed(3)}</dd>
      <dt>Label</dt><dd>${escapeHtml(segment.label)}</dd>
    </dl>
    ${sourceHintsHtml}
    ${evidenceHtml}`;
}

function evidencesForSegment(model: WorkbenchModel, segment: ChainViewSegmentModel): WorkbenchModel["evidences"] {
  const explicitIds = new Set(segment.evidence_ids);
  const byEdge = segment.edge_id === undefined ? [] : model.evidences.filter((item) => item.edge_id === segment.edge_id);
  const explicit = model.evidences.filter((item) => explicitIds.has(item.evidence_id));
  const byId = new Map<string, WorkbenchModel["evidences"][number]>();
  for (const item of [...byEdge, ...explicit]) byId.set(item.evidence_id, item);
  return [...byId.values()].sort(compareEvidence);
}

function compareEvidence(left: WorkbenchModel["evidences"][number], right: WorkbenchModel["evidences"][number]): number {
  const activeOrder = Number(left.superseded_by !== null) - Number(right.superseded_by !== null);
  if (activeOrder !== 0) return activeOrder;
  return right.evidence_level - left.evidence_level || right.confidence - left.confidence || left.evidence_id.localeCompare(right.evidence_id);
}

function renderEvidenceItem(evidence: WorkbenchModel["evidences"][number], primary: boolean): string {
  const state = evidence.superseded_by === null ? "active" : `superseded by ${evidence.superseded_by}`;
  return `<dl>
    <dt>Evidence</dt><dd>${escapeHtml(evidence.evidence_id)} · Level ${evidence.evidence_level}${primary ? " · primary view" : ""}</dd>
    <dt>Status</dt><dd>${escapeHtml(state)}</dd>
    <dt>Source</dt><dd><a href="${escapeAttribute(evidence.source_url)}" target="_blank" rel="noreferrer">${escapeHtml(evidence.source_adapter_id)}</a></dd>
    <dt>Locator</dt><dd>${escapeHtml(evidence.cite_locator ?? "(not recorded)")}</dd>
    <dt>Cite</dt><dd>${escapeHtml(evidence.cite_text)}</dd>
  </dl>`;
}

function renderSourceHints(segment: ChainViewSegmentModel): string {
  if (segment.source_hints === undefined || segment.source_hints.length === 0) return "";
  const items = segment.source_hints
    .slice(0, 5)
    .map(
      (hint) =>
        `<li><strong>${escapeHtml(hint.source_id)}</strong> · ${escapeHtml(hint.expected_output_layer)} · ${escapeHtml(
          hint.relation_policy
        )} · key ${hint.requires_key ? "yes" : "no"}</li>`
    )
    .join("");
  return `<h3>Next source hints</h3><ul>${items}</ul>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
