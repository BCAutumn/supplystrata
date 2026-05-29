import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const PRODUCTION_ROOTS = ["apps", "packages", "scripts"] as const;
const REMOVABLE_PREFIXES = ["apps/web", "packages/web", "apps/agent-cli"] as const;
const FORBIDDEN_WEB_REFS = ['"@supplystrata/web"', "'@supplystrata/web'", "packages/web/src"] as const;

describe("SCBOM web removable boundary", () => {
  it("keeps core production source free of web package imports", async () => {
    const matches: string[] = [];
    for (const file of await listTextFiles(PRODUCTION_ROOTS)) {
      const relativePath = relative(ROOT, file);
      if (isRemovablePath(relativePath)) continue;
      const text = await readFile(file, "utf8");
      for (const forbidden of FORBIDDEN_WEB_REFS) {
        if (text.includes(forbidden)) matches.push(`${relativePath} -> ${forbidden}`);
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
    if (entry.name === "dist" || entry.name === "node_modules") continue;
    const fullPath = join(path, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTextFilesUnder(fullPath)));
      continue;
    }
    if (/\.(cjs|js|json|mjs|ts|tsx)$/u.test(entry.name)) files.push(fullPath);
  }
  return files;
}

function isRemovablePath(path: string): boolean {
  return REMOVABLE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
