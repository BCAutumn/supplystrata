import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("SCBOM viewer landing order", () => {
  it("keeps the local viewer evidence-first with graph as the final overview", async () => {
    const source = await readFile("apps/web/src/main.ts", "utf8");

    expect(componentOrder(source)).toEqual(["scbom-evidence-view", "scbom-unknown-map", "scbom-supply-chain-graph"]);
  });
});

function componentOrder(source: string): string[] {
  const matches = source.matchAll(/<(?<tag>scbom-(?:evidence-view|unknown-map|supply-chain-graph))>/gu);
  return [...matches].flatMap((match) => {
    const tag = match.groups?.["tag"];
    return tag === undefined ? [] : [tag];
  });
}
