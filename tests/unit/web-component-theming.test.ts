/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { toScbomDocument } from "@supplystrata/workbench-export";
import { registerScbomComponents, ScbomPingElement } from "@supplystrata/web/components";
import { workbenchScbomFixture } from "./workbench-scbom-fixture.js";

describe("SCBOM Web Component base", () => {
  it("registers a themed custom element with shadow parts and slots", async () => {
    const registry = registerScbomComponents();
    expect(registry.registered).toEqual(["scbom-evidence-view", "scbom-ping", "scbom-unknown-map"]);

    const element = document.createElement("scbom-ping");
    if (!(element instanceof ScbomPingElement)) throw new Error("Expected scbom-ping to be registered");
    element.scbomDocument = toScbomDocument(workbenchScbomFixture());
    element.style.setProperty("--scbom-color-surface", "rgb(1, 2, 3)");
    element.innerHTML = `<span slot="label">Ready from slot</span><button slot="toolbar">Inspect</button>`;

    document.body.append(element);
    await element.updateComplete;

    const shadow = element.shadowRoot;
    if (shadow === null) throw new Error("Expected scbom-ping to use Shadow DOM");
    expect(shadow.querySelector('[part="surface"]')).not.toBeNull();
    expect(shadow.querySelector('[part="title"]')?.textContent).toBe("SCBOM viewer");
    expect(shadow.querySelector('[part="accent"]')?.textContent).toBe("3");
    expect(element.style.getPropertyValue("--scbom-color-surface")).toBe("rgb(1, 2, 3)");
    expect(shadow.querySelector('slot[name="label"]')).not.toBeNull();
    expect(shadow.querySelector('slot[name="toolbar"]')).not.toBeNull();
  });
});
