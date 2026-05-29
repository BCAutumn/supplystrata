import { describe, expect, it } from "vitest";
import { toScbomDocument } from "@supplystrata/workbench-export";
import { renderAgentHtmlArtifact } from "../../apps/agent-cli/src/html-artifact.js";
import { workbenchScbomFixture } from "../unit/workbench-scbom-fixture.js";

describe("agent SCBOM HTML artifact", () => {
  it("renders a self-contained HTML artifact with inline SCBOM and component bundle", () => {
    const html = renderAgentHtmlArtifact({
      title: "SupplyStrata Agent Report: NVIDIA",
      markdown: "## cannot_conclude\n\nNo unsupported claims.",
      scbomDocument: toScbomDocument(workbenchScbomFixture()),
      componentBundle: "window.ScbomViewer={registerScbomComponents(){}};"
    });

    expect(html).toContain("<scbom-evidence-view>");
    expect(html).toContain("<scbom-unknown-map>");
    expect(html).toContain("<scbom-supply-chain-graph>");
    expect(html).toContain('"schema_version":"0.0.1"');
    expect(html).toContain("window.ScbomViewer={registerScbomComponents(){}");
    expect(html).not.toContain('src="/components.iife.js"');
    const documentJson = html.match(/<script type="application\/json" id="scbom-document">(?<json>.*?)<\/script>/u)?.groups?.["json"];
    expect(documentJson).toBeDefined();
    expect(JSON.parse(documentJson ?? "{}")).toMatchObject({ schema_version: "0.0.1" });
  });
});
