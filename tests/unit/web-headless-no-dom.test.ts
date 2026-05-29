import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();
const headlessEntry = join(rootDir, "packages/web/src/index.ts");
const bannedImportSpecifiers = ["lit", "sigma", "react", "react-dom", "vue", "svelte"];
const bannedRuntimePatterns = [/\bwindow\./u, /\bglobalThis\.document\b/u, /\bfetch\s*\(/u, /\bXMLHttpRequest\b/u, /\bcustomElements\b/u, /\bHTMLElement\b/u];

describe("web headless boundary", () => {
  it("keeps the L0 entry free of DOM, network, and UI framework imports", () => {
    const files = collectHeadlessFiles(headlessEntry);
    const violations = files.flatMap((file) => headlessViolations(file));

    expect(violations).toEqual([]);
  });
});

function collectHeadlessFiles(entry: string): string[] {
  const visited = new Set<string>();
  const pending = [entry];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    for (const specifier of relativeImports(readFileSync(current, "utf8"))) {
      pending.push(resolveRelativeImport(current, specifier));
    }
  }

  return [...visited].sort();
}

function relativeImports(source: string): string[] {
  const result: string[] = [];
  const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gu;
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    if (specifier !== undefined && specifier.startsWith(".")) result.push(specifier);
  }
  return result;
}

function resolveRelativeImport(fromFile: string, specifier: string): string {
  const resolved = normalize(join(dirname(fromFile), specifier));
  if (resolved.endsWith(".js")) return `${resolved.slice(0, -3)}.ts`;
  if (resolved.endsWith(".ts")) return resolved;
  return `${resolved}.ts`;
}

function headlessViolations(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const importViolations = importSpecifiers(source)
    .filter((specifier) => bannedImportSpecifiers.includes(specifier) || bannedImportSpecifiers.some((banned) => specifier.startsWith(`${banned}/`)))
    .map((specifier) => `${file} imports ${specifier}`);
  const runtimeViolations = bannedRuntimePatterns.filter((pattern) => pattern.test(source)).map((pattern) => `${file} matches ${pattern.source}`);
  return [...importViolations, ...runtimeViolations];
}

function importSpecifiers(source: string): string[] {
  const result: string[] = [];
  const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gu;
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    if (specifier !== undefined) result.push(specifier);
  }
  return result;
}
