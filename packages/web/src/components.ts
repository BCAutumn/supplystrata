import { ScbomPingElement } from "./components/scbom-ping.js";

export { ScbomBaseElement } from "./components/base.js";
export { defineScbomPingElement, ScbomPingElement } from "./components/scbom-ping.js";
export interface ScbomComponentRegistry {
  readonly registered: readonly string[];
}

export function registerScbomComponents(registry: CustomElementRegistry = defaultRegistry()): ScbomComponentRegistry {
  if (registry.get("scbom-ping") === undefined) {
    registry.define("scbom-ping", ScbomPingElement);
  }
  return { registered: ["scbom-ping"] };
}

export { createScbomView } from "./index.js";

function defaultRegistry(): CustomElementRegistry {
  if (globalThis.customElements === undefined) throw new Error("customElements registry is not available");
  return globalThis.customElements;
}
