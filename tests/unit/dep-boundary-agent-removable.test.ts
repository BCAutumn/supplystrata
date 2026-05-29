import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const PRODUCTION_ROOTS = ["apps", "packages", "scripts"] as const;
const REMOVABLE_PREFIXES = ["apps/agent-cli", "packages/agent"] as const;
const FORBIDDEN_AGENT_REFS = ['"@supplystrata/agent"', "'@supplystrata/agent'", "packages/agent/src", "apps/agent-cli/src"] as const;

describe("reference agent removable boundary", () => {
  it("keeps core production source free of reference-agent imports", async () => {
    const matches: string[] = [];
    for (const file of await listTextFiles(PRODUCTION_ROOTS)) {
      const relativePath = relative(ROOT, file);
      if (isRemovablePath(relativePath)) continue;
      const text = await readFile(file, "utf8");
      for (const forbidden of FORBIDDEN_AGENT_REFS) {
        if (text.includes(forbidden)) matches.push(`${relativePath} -> ${forbidden}`);
      }
    }

    expect(matches).toEqual([]);
  });

  it("keeps core workspace package manifests independent from the reference agent", async () => {
    const matches: string[] = [];
    for (const file of await listPackageJsonFiles(["apps", "packages"])) {
      const relativePath = relative(ROOT, file);
      if (isRemovablePath(relativePath)) continue;
      const manifest = parseManifest(await readFile(file, "utf8"), relativePath);
      for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const) {
        if (hasDependency(manifest, section, "@supplystrata/agent")) matches.push(`${relativePath} -> ${section}.@supplystrata/agent`);
      }
    }

    expect(matches).toEqual([]);
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
    if (/\.(cjs|js|json|mjs|ts|tsx)$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

async function listPackageJsonFiles(roots: readonly string[]): Promise<string[]> {
  return (await listTextFiles(roots)).filter((file) => file.endsWith("package.json"));
}

function parseManifest(text: string, label: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error(`Invalid package manifest: ${label}`);
  return parsed;
}

function hasDependency(manifest: Record<string, unknown>, section: string, dependencyName: string): boolean {
  const dependencies = manifest[section];
  return isRecord(dependencies) && dependencyName in dependencies;
}

function isRemovablePath(path: string): boolean {
  return REMOVABLE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
