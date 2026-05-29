/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { toScbomDocument } from "@supplystrata/workbench-export";
import { registerScbomComponents, ScbomSupplyChainGraphElement } from "@supplystrata/web/components";
import { workbenchScbomFixture } from "./workbench-scbom-fixture.js";

describe("scbom-supply-chain-graph", () => {
  it("renders a relationship overview without turning observations or unknowns into edges", async () => {
    registerScbomComponents();
    const element = document.createElement("scbom-supply-chain-graph");
    if (!(element instanceof ScbomSupplyChainGraphElement)) throw new Error("Expected scbom-supply-chain-graph to be registered");
    element.scbomDocument = toScbomDocument(workbenchScbomFixture());

    document.body.append(element);
    await element.updateComplete;

    const shadow = element.shadowRoot;
    if (shadow === null) throw new Error("Expected Shadow DOM");
    expect(shadow.querySelector('[part="graph-canvas"]')?.getAttribute("data-renderer")).toBe("fallback");
    expect(shadow.querySelector('[part="graph-svg"]')).not.toBeNull();
    expect(shadow.querySelectorAll('[part="graph-svg-node"]').length).toBe(3);
    expect(shadow.querySelectorAll('[part="graph-svg-edge"]').length).toBe(1);
    expect([...shadow.querySelectorAll("[data-node-id]")].map((node) => node.textContent)).toEqual(["GPU", "NVIDIA", "TSMC"]);
    expect([...shadow.querySelectorAll("[data-edge-id]")].map((edge) => edge.getAttribute("data-edge-id"))).toEqual(["EDGE-NVIDIA-TSMC"]);
    expect(shadow.textContent).not.toContain("OBS-GPU-1");
    expect(shadow.textContent).not.toContain("UNK-CONFLICT-1");
  });
});
