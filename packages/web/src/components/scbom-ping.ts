import { html, type TemplateResult } from "lit";
import { ScbomBaseElement } from "./base.js";

export class ScbomPingElement extends ScbomBaseElement {
  protected override render(): TemplateResult {
    const entityCount = this.view?.entities.length ?? 0;
    return this.renderSurface(
      "SCBOM viewer",
      html`
        <p part="status"><slot name="label">SCBOM viewer ready</slot></p>
        <p part="meta">
          <span part="accent">${entityCount}</span>
          entities normalized by the headless core.
        </p>
      `
    );
  }
}

export function defineScbomPingElement(registry: CustomElementRegistry = defaultRegistry()): void {
  if (registry.get("scbom-ping") === undefined) registry.define("scbom-ping", ScbomPingElement);
}

function defaultRegistry(): CustomElementRegistry {
  if (globalThis.customElements === undefined) throw new Error("customElements registry is not available");
  return globalThis.customElements;
}
