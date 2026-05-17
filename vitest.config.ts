import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

interface TsconfigAliases {
  baseUrl: string;
  paths: Record<string, string[]>;
}

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: loadTsconfigAliases()
  },
  test: {
    environment: "node"
  }
});

function loadTsconfigAliases(): Record<string, string> {
  const tsconfig = readTsconfigAliases(resolve(rootDir, "tsconfig.base.json"));
  const aliases: Record<string, string> = {};
  for (const [packageName, targets] of Object.entries(tsconfig.paths)) {
    const firstTarget = targets[0];
    if (firstTarget === undefined) throw new Error(`tsconfig path alias has no target: ${packageName}`);
    aliases[packageName] = resolve(rootDir, tsconfig.baseUrl, firstTarget);
  }
  return aliases;
}

function readTsconfigAliases(path: string): TsconfigAliases {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed)) throw new Error("tsconfig.base.json must contain a JSON object.");
  const compilerOptions = parsed["compilerOptions"];
  if (!isRecord(compilerOptions)) throw new Error("tsconfig.base.json compilerOptions must be an object.");
  const baseUrl = compilerOptions["baseUrl"];
  if (typeof baseUrl !== "string") throw new Error("tsconfig.base.json compilerOptions.baseUrl must be a string.");
  return {
    baseUrl,
    paths: parsePaths(compilerOptions["paths"])
  };
}

function parsePaths(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) throw new Error("tsconfig.base.json compilerOptions.paths must be an object.");
  const paths: Record<string, string[]> = {};
  for (const [packageName, targets] of Object.entries(value)) {
    if (!Array.isArray(targets)) throw new Error(`tsconfig path alias must be an array: ${packageName}`);
    const parsedTargets: string[] = [];
    for (const target of targets) {
      if (typeof target !== "string") throw new Error(`tsconfig path alias target must be a string: ${packageName}`);
      parsedTargets.push(target);
    }
    paths[packageName] = parsedTargets;
  }
  return paths;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
