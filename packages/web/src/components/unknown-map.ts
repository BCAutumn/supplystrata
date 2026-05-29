import { css, html, type CSSResultGroup, type TemplateResult } from "lit";
import type { ScbomViewUnknown } from "../definitions/scbom-view.js";
import { ScbomBaseElement } from "./base.js";

export class ScbomUnknownMapElement extends ScbomBaseElement {
  static override styles: CSSResultGroup = [
    ScbomBaseElement.styles,
    css`
      [part="unknown-item"] {
        border-top: 1px solid var(--scbom-color-border);
        padding: 14px 0;
      }

      [part="unknown-question"] {
        margin: 0 0 8px;
        font-size: 14px;
      }

      [part="unknown-scope"],
      [part="unknown-reason"] {
        margin: 4px 0;
      }
    `
  ];

  protected override render(): TemplateResult {
    const unknowns = this.view?.unknowns ?? [];
    return this.renderSurface(
      "Unknown map",
      html`
        <p part="status">Open questions are first-class SCBOM objects, kept separate from relationship assertions.</p>
        ${unknowns.length === 0
          ? html`<p part="empty">No open questions in this SCBOM document.</p>`
          : html`${unknowns.map((unknown) => this.renderUnknown(unknown))}`}
      `
    );
  }

  private renderUnknown(unknown: ScbomViewUnknown): TemplateResult {
    return html`
      <article part="unknown-item" data-status=${unknown.status}>
        <h3 part="unknown-question">${unknown.question}</h3>
        <p part="unknown-scope">Scope: ${unknown.scope_ref}</p>
        ${unknown.reason === undefined ? html`` : html`<p part="unknown-reason">${unknown.reason}</p>`}
      </article>
    `;
  }
}

export function defineScbomUnknownMapElement(registry: CustomElementRegistry = defaultRegistry()): void {
  if (registry.get("scbom-unknown-map") === undefined) registry.define("scbom-unknown-map", ScbomUnknownMapElement);
}

function defaultRegistry(): CustomElementRegistry {
  if (globalThis.customElements === undefined) throw new Error("customElements registry is not available");
  return globalThis.customElements;
}
