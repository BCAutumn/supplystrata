import { ScbomPingElement } from "./components/scbom-ping.js";
import { ScbomEvidenceViewElement } from "./components/evidence-view.js";
import { ScbomUnknownMapElement } from "./components/unknown-map.js";

export { ScbomBaseElement } from "./components/base.js";
export { defineScbomEvidenceViewElement, ScbomEvidenceViewElement } from "./components/evidence-view.js";
export { defineScbomPingElement, ScbomPingElement } from "./components/scbom-ping.js";
export { defineScbomUnknownMapElement, ScbomUnknownMapElement } from "./components/unknown-map.js";
export interface ScbomComponentRegistry {
  readonly registered: readonly string[];
}

export function registerScbomComponents(registry: CustomElementRegistry = defaultRegistry()): ScbomComponentRegistry {
  const definitions = [
    ["scbom-evidence-view", ScbomEvidenceViewElement],
    ["scbom-ping", ScbomPingElement],
    ["scbom-unknown-map", ScbomUnknownMapElement]
  ] as const;
  for (const [tagName, element] of definitions) {
    if (registry.get(tagName) === undefined) registry.define(tagName, element);
  }
  return { registered: definitions.map(([tagName]) => tagName) };
}

export { createScbomView } from "./index.js";

function defaultRegistry(): CustomElementRegistry {
  if (globalThis.customElements === undefined) throw new Error("customElements registry is not available");
  return globalThis.customElements;
}
