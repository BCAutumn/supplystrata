import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("SCBOM viewer landing order", () => {
  it("keeps the local viewer evidence-first with graph as the final overview", async () => {
    const source = await readFile("apps/web/src/main.ts", "utf8");

    expect(componentOrder(viewerHtmlSource(source))).toEqual(["scbom-evidence-view", "scbom-unknown-map", "scbom-supply-chain-graph"]);
  });
});

function viewerHtmlSource(source: string): string {
  const start = source.indexOf("function viewerHtml(");
  const end = source.indexOf("function themeDemoHtml(");
  if (start === -1 || end === -1 || end <= start) throw new Error("Expected apps/web/src/main.ts to keep viewerHtml before themeDemoHtml");
  return source.slice(start, end);
}

function componentOrder(source: string): string[] {
  const matches = source.matchAll(/<(?<tag>scbom-(?:evidence-view|unknown-map|supply-chain-graph))>/gu);
  return [...matches].flatMap((match) => {
    const tag = match.groups?.["tag"];
    return tag === undefined ? [] : [tag];
  });
}
