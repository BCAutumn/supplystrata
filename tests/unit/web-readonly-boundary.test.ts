import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const WEB_ROOTS = ["packages/web/src", "apps/web/src"] as const;
const FORBIDDEN_WRITE_SURFACE_REFS = ["run_source_check", "review.approve", "review.reject", "start_research_session", "confirm_research_session"] as const;

describe("SCBOM web readonly boundary", () => {
  it("does not reference MCP write tools or write-session flows", async () => {
    const matches: string[] = [];
    for (const file of await listTextFiles(WEB_ROOTS)) {
      const text = await readFile(file, "utf8");
      for (const forbidden of FORBIDDEN_WRITE_SURFACE_REFS) {
        if (text.includes(forbidden)) matches.push(`${relative(ROOT, file)} -> ${forbidden}`);
      }
    }

    expect(matches).toEqual([]);
  });
});

async function listTextFiles(roots: readonly string[]): Promise<string[]> {
  const files: string[] = [];
  for (const root of roots) files.push(...(await listTextFilesUnder(join(ROOT, root))));
  return files;
}

async function listTextFilesUnder(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(path, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTextFilesUnder(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) files.push(fullPath);
  }
  return files;
}
