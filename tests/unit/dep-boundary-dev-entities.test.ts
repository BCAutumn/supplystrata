import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { listSources } from "@supplystrata/source-registry";
import { readdir } from "node:fs/promises";

const ROOT = process.cwd();
const SCANNED_ROOTS = ["apps", "packages", "scripts"] as const;
const FORBIDDEN_PRODUCTION_STRINGS = ["seeds/entities.csv", "seeds/aliases.csv", "admin seed"] as const;

describe("dev entity fixture boundary", () => {
  it("keeps old company seed CSV paths out of production code", async () => {
    const matches: string[] = [];
    for (const file of await listTextFiles(SCANNED_ROOTS)) {
      const text = await readFile(file, "utf8");
      for (const forbidden of FORBIDDEN_PRODUCTION_STRINGS) {
        if (text.includes(forbidden)) matches.push(`${relative(ROOT, file)} -> ${forbidden}`);
      }
    }

    expect(matches).toEqual([]);
  });

  it("marks seed-entities as removed from source registry coverage", () => {
    const seedEntities = listSources().find((source) => source.id === "seed-entities");
    expect(seedEntities).toMatchObject({
      status: "removed",
      official_url: "file://tests/fixtures/dev-entities/entities.csv"
    });
  });
});

async function listTextFiles(roots: readonly string[]): Promise<string[]> {
  const files: string[] = [];
  for (const root of roots) {
    files.push(...(await listTextFilesUnder(join(ROOT, root))));
  }
  return files;
}

async function listTextFilesUnder(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === "dist" || entry.name === "node_modules") continue;
    const fullPath = join(path, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTextFilesUnder(fullPath)));
      continue;
    }
    if (/\.(cjs|js|json|md|mjs|ts|tsx)$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}
