/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import type { ScbomDocument, ScbomObject, ScbomRelationship } from "@scbom/spec";
import { toScbomDocument } from "@supplystrata/workbench-export";
import { registerScbomComponents, ScbomEvidenceViewElement } from "@supplystrata/web/components";
import { workbenchScbomFixture } from "./workbench-scbom-fixture.js";

describe("scbom-evidence-view", () => {
  it("renders citation-backed relationships as the primary view", async () => {
    registerScbomComponents();
    const element = document.createElement("scbom-evidence-view");
    if (!(element instanceof ScbomEvidenceViewElement)) throw new Error("Expected scbom-evidence-view to be registered");
    element.scbomDocument = toScbomDocument(workbenchScbomFixture());

    document.body.append(element);
    await element.updateComplete;

    const shadow = element.shadowRoot;
    if (shadow === null) throw new Error("Expected Shadow DOM");
    expect(shadow.querySelector('[part="relationship-title"]')?.textContent).toContain("NVIDIA -USES_FOUNDRY-> TSMC");
    expect(shadow.querySelector('[part="citation"]')?.textContent).toContain("NVIDIA uses TSMC for wafer fabrication.");
    expect(shadow.querySelector('[part="source-link"]')?.getAttribute("href")).toBe("https://www.sec.gov/fixture");
    expect(shadow.querySelector('[part="evidence-level"]')?.getAttribute("data-weight")).toBe("level_5");
    expect(shadow.querySelector('[part="evidence-level"]')?.textContent).toBe("Filed Disclosure");
  });

  it("visually distinguishes deprecated relationship assertions", async () => {
    registerScbomComponents();
    const element = document.createElement("scbom-evidence-view");
    if (!(element instanceof ScbomEvidenceViewElement)) throw new Error("Expected scbom-evidence-view to be registered");
    element.scbomDocument = replaceRelationshipValidity(toScbomDocument(workbenchScbomFixture()), "superseded");

    document.body.append(element);
    await element.updateComplete;

    const shadow = element.shadowRoot;
    if (shadow === null) throw new Error("Expected Shadow DOM");
    expect(shadow.querySelector('[part~="deprecated"]')?.textContent).toBe("superseded");
  });
});

function replaceRelationshipValidity(document: ScbomDocument, status: ScbomRelationship["validity"]["status"]): ScbomDocument {
  const objects: ScbomObject[] = document.objects.map((object) => {
    if (object.object_type !== "relationship") return object;
    const relationship: ScbomRelationship = { ...object, validity: { ...object.validity, status } };
    return relationship;
  });
  return { ...document, objects };
}
