import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();
const forbiddenFrameworkPackages = new Set(["react", "react-dom", "vue", "svelte", "@sveltejs/kit"]);

describe("web package boundary", () => {
  it("allows Lit but does not depend on React, Vue, or Svelte", () => {
    const manifest = readJsonRecord(join(rootDir, "packages/web/package.json"));
    const dependencyNames = Object.keys({
      ...readRecord(manifest, "dependencies"),
      ...readRecord(manifest, "devDependencies"),
      ...readRecord(manifest, "peerDependencies")
    });

    expect(dependencyNames).toContain("lit");
    expect(dependencyNames.filter((name) => forbiddenFrameworkPackages.has(name))).toEqual([]);
  });
});

function readJsonRecord(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed)) throw new Error(`Expected JSON object in ${path}`);
  return parsed;
}

function readRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error(`Expected ${key} to be an object`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
