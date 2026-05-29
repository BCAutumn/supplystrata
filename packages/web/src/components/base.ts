import { LitElement, css, html, type CSSResultGroup, type PropertyValues, type TemplateResult } from "lit";
import type { ScbomDocument } from "@scbom/spec";
import type { ScbomView } from "../definitions/scbom-view.js";
import { createScbomView } from "../functions/scbom-to-view.js";

export abstract class ScbomBaseElement extends LitElement {
  static override properties = {
    scbomDocument: { attribute: false },
    view: { state: true }
  };

  static override styles: CSSResultGroup = css`
    :host {
      --scbom-color-surface: #ffffff;
      --scbom-color-text: #18202a;
      --scbom-color-muted: #667085;
      --scbom-color-border: #d9e2ec;
      --scbom-color-accent: #2563eb;
      --scbom-radius: 8px;
      --scbom-font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      display: block;
      color: var(--scbom-color-text);
      font-family: var(--scbom-font-family);
    }

    [part="surface"] {
      box-sizing: border-box;
      width: 100%;
      border: 1px solid var(--scbom-color-border);
      border-radius: var(--scbom-radius);
      background: var(--scbom-color-surface);
      color: var(--scbom-color-text);
      padding: 16px;
    }

    [part="header"] {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin: 0 0 12px;
    }

    [part="title"] {
      margin: 0;
      color: var(--scbom-color-text);
      font-size: 16px;
      font-weight: 650;
      line-height: 1.3;
    }

    [part="status"],
    [part="meta"] {
      color: var(--scbom-color-muted);
      font-size: 13px;
      line-height: 1.45;
    }

    [part="accent"] {
      color: var(--scbom-color-accent);
    }
  `;

  scbomDocument: ScbomDocument | undefined = undefined;
  protected view: ScbomView | undefined = undefined;

  protected override willUpdate(changedProperties: PropertyValues<this>): void {
    if (changedProperties.has("scbomDocument")) {
      this.view = this.scbomDocument === undefined ? undefined : createScbomView(this.scbomDocument);
    }
  }

  protected renderSurface(title: string, body: TemplateResult): TemplateResult {
    return html`
      <section part="surface">
        <header part="header">
          <h2 part="title">${title}</h2>
          <slot name="toolbar"></slot>
        </header>
        ${body}
      </section>
    `;
  }
}
