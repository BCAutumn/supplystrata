/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { toScbomDocument } from "@supplystrata/workbench-export";
import { registerScbomComponents, ScbomUnknownMapElement } from "@supplystrata/web/components";
import { workbenchScbomFixture } from "./workbench-scbom-fixture.js";

describe("scbom-unknown-map", () => {
  it("renders unknowns as first-class open questions", async () => {
    registerScbomComponents();
    const element = document.createElement("scbom-unknown-map");
    if (!(element instanceof ScbomUnknownMapElement)) throw new Error("Expected scbom-unknown-map to be registered");
    element.scbomDocument = toScbomDocument(workbenchScbomFixture());

    document.body.append(element);
    await element.updateComplete;

    const shadow = element.shadowRoot;
    if (shadow === null) throw new Error("Expected Shadow DOM");
    const text = shadow.textContent ?? "";
    expect(text).toContain("Open questions are first-class SCBOM objects");
    expect(text).toContain("Does this draft claim remain valid?");
    expect(text.toLowerCase()).not.toContain("error");
    expect(text.toLowerCase()).not.toContain("missing");
  });
});
