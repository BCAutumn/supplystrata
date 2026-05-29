import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const componentFiles = [
  "packages/web/src/components/base.ts",
  "packages/web/src/components/evidence-view.ts",
  "packages/web/src/components/unknown-map.ts",
  "packages/web/src/components/supply-chain-graph.ts",
  "packages/web/src/components/scbom-ping.ts"
];

const documentedCssVariables = [
  "--scbom-color-surface",
  "--scbom-color-text",
  "--scbom-color-muted",
  "--scbom-color-border",
  "--scbom-color-accent",
  "--scbom-radius",
  "--scbom-font-family",
  "--scbom-evidence-level-5",
  "--scbom-evidence-level-4",
  "--scbom-evidence-level-3",
  "--scbom-evidence-level-2",
  "--scbom-evidence-level-1",
  "--scbom-evidence-level-unknown",
  "--scbom-graph-background",
  "--scbom-graph-edge",
  "--scbom-graph-node",
  "--scbom-graph-node-stroke",
  "--scbom-graph-label-stroke"
];

const documentedParts = [
  "surface",
  "header",
  "title",
  "status",
  "meta",
  "accent",
  "relationship-row",
  "relationship-title",
  "relationship-meta",
  "evidence-level",
  "validity",
  "deprecated",
  "evidence-list",
  "citation",
  "empty",
  "evidence-ref",
  "unresolved",
  "source-link",
  "locator",
  "unknown-item",
  "unknown-question",
  "unknown-scope",
  "unknown-reason",
  "graph-canvas",
  "graph-fallback",
  "graph-list-title",
  "graph-svg",
  "graph-svg-edge",
  "graph-svg-node",
  "graph-svg-label",
  "graph-node-list",
  "graph-edge-list"
];

const documentedSlots = ["toolbar", "label"];

describe("SCBOM viewer theming contract", () => {
  it("documents every supported CSS variable", () => {
    const readme = readPackageReadme();
    const componentSource = readComponentSource();
    for (const variable of documentedCssVariables) {
      expect(componentSource).toContain(variable);
      expect(readme).toContain(`\`${variable}\``);
    }
  });

  it("documents every exported part token", () => {
    const readme = readPackageReadme();
    const componentSource = readComponentSource();
    for (const part of documentedParts) {
      expect(componentSource).toContain(part);
      expect(readme).toContain(`\`${part}\``);
    }
  });

  it("documents every supported slot", () => {
    const readme = readPackageReadme();
    const componentSource = readComponentSource();
    for (const slot of documentedSlots) {
      expect(componentSource).toContain(`name="${slot}"`);
      expect(readme).toContain(`\`${slot}\``);
    }
  });

  it("documents the unstyled escape hatch", () => {
    const readme = readPackageReadme();
    const componentSource = readComponentSource();
    expect(componentSource).toContain(":host([unstyled])");
    expect(readme).toContain("`unstyled`");
  });
});

function readPackageReadme(): string {
  return readFileSync(join(root, "packages/web/README.md"), "utf8");
}

function readComponentSource(): string {
  return componentFiles.map((file) => readFileSync(join(root, file), "utf8")).join("\n");
}
