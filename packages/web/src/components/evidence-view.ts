import { css, html, type CSSResultGroup, type TemplateResult } from "lit";
import type { ScbomViewEvidenceRef, ScbomViewRelationship } from "../definitions/scbom-view.js";
import { ScbomBaseElement } from "./base.js";

const DEPRECATED_VALIDITY_STATUSES = new Set(["historical", "superseded", "withdrawn"]);

export class ScbomEvidenceViewElement extends ScbomBaseElement {
  static override styles: CSSResultGroup = [
    ScbomBaseElement.styles,
    css`
      :host {
        --scbom-evidence-level-5: #14532d;
        --scbom-evidence-level-4: #166534;
        --scbom-evidence-level-3: #854d0e;
        --scbom-evidence-level-2: #9a3412;
        --scbom-evidence-level-1: #991b1b;
        --scbom-evidence-level-unknown: var(--scbom-color-muted);
      }

      [part="relationship-row"] {
        border-top: 1px solid var(--scbom-color-border);
        padding: 14px 0;
      }

      [part="relationship-title"] {
        margin: 0 0 8px;
        font-size: 14px;
        line-height: 1.35;
      }

      [part="relationship-meta"] {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      [part="evidence-level"],
      [part="validity"] {
        border: 1px solid var(--scbom-color-border);
        border-radius: 999px;
        padding: 2px 8px;
        font-size: 12px;
      }

      [part="evidence-level"][data-weight="level_5"] {
        color: var(--scbom-evidence-level-5);
      }

      [part="evidence-level"][data-weight="level_4"] {
        color: var(--scbom-evidence-level-4);
      }

      [part="evidence-level"][data-weight="level_3"] {
        color: var(--scbom-evidence-level-3);
      }

      [part="evidence-level"][data-weight="level_2"] {
        color: var(--scbom-evidence-level-2);
      }

      [part="evidence-level"][data-weight="level_1"] {
        color: var(--scbom-evidence-level-1);
      }

      [part~="deprecated"] {
        border-color: var(--scbom-evidence-level-1);
        color: var(--scbom-evidence-level-1);
      }

      [part="evidence-list"] {
        margin: 12px 0 0;
        padding-left: 24px;
      }

      [part="citation"] {
        margin: 0 0 6px;
      }
    `
  ];

  protected override render(): TemplateResult {
    const relationships = this.view?.relationships ?? [];
    return this.renderSurface(
      "Evidence view",
      html`
        <p part="status">Citation-backed relationship assertions, grouped by relationship.</p>
        ${relationships.length === 0
          ? html`<p part="empty">No relationship assertions in this SCBOM document.</p>`
          : html`${relationships.map((relationship) => this.renderRelationship(relationship))}`}
      `
    );
  }

  private renderRelationship(relationship: ScbomViewRelationship): TemplateResult {
    const deprecated = DEPRECATED_VALIDITY_STATUSES.has(relationship.validity_status);
    return html`
      <article part="relationship-row" data-validity=${relationship.validity_status}>
        <h3 part="relationship-title">${relationship.subject_name} -${relationship.predicate}-> ${relationship.object_name}</h3>
        <div part="relationship-meta">
          <span part="evidence-level" data-weight=${relationship.visual_weight}>${evidenceLevelLabel(relationship.evidence_level)}</span>
          <span part=${deprecated ? "validity deprecated" : "validity"}>${relationship.validity_status}</span>
        </div>
        <ol part="evidence-list">
          ${relationship.evidence_trail.map((ref) => this.renderEvidenceRef(ref))}
        </ol>
      </article>
    `;
  }

  private renderEvidenceRef(ref: ScbomViewEvidenceRef): TemplateResult {
    if (ref.evidence === undefined) return html`<li part="evidence-ref unresolved">${ref.evidence_id}</li>`;
    return html`
      <li part="evidence-ref">
        <blockquote part="citation">${ref.evidence.citation_text}</blockquote>
        <a part="source-link" href=${ref.evidence.source_url} target="_blank" rel="noreferrer">${ref.evidence.source_title}</a>
        <span part="locator">${ref.evidence.locator_label}</span>
      </li>
    `;
  }
}

export function defineScbomEvidenceViewElement(registry: CustomElementRegistry = defaultRegistry()): void {
  if (registry.get("scbom-evidence-view") === undefined) registry.define("scbom-evidence-view", ScbomEvidenceViewElement);
}

function evidenceLevelLabel(level: number | undefined): string {
  return level === undefined ? "evidence level unknown" : `evidence level ${level}`;
}

function defaultRegistry(): CustomElementRegistry {
  if (globalThis.customElements === undefined) throw new Error("customElements registry is not available");
  return globalThis.customElements;
}
