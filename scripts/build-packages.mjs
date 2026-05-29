#!/usr/bin/env node
import { chmodSync, cpSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { evaluateBundleSizeGate } from "./browser-bundle-policy.mjs";

const rootDir = process.cwd();
const tscBin = process.platform === "win32" ? "tsc.cmd" : "tsc";
const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const packageDirs = findPackageDirs(["packages", "apps"]);
const packageByName = new Map(packageDirs.map((dir) => [readPackageJson(dir).name, dir]));
const ordered = topologicalPackageDirs(packageDirs);

for (const dir of ordered) {
  buildPackage(dir);
}

console.log(`Built ${ordered.length} workspace packages.`);

function findPackageDirs(roots) {
  const result = [];
  for (const root of roots) {
    const abs = join(rootDir, root);
    if (!existsSync(abs)) continue;
    walk(abs, result);
  }
  return result.sort();
}

function walk(dir, result) {
  if (existsSync(join(dir, "package.json"))) {
    result.push(dir);
    return;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === "dist") continue;
    walk(join(dir, entry.name), result);
  }
}

function topologicalPackageDirs(dirs) {
  const sorted = [];
  const permanent = new Set();
  const visiting = new Set();
  for (const dir of dirs) visit(dir, sorted, permanent, visiting);
  return sorted;
}

function visit(dir, sorted, permanent, visiting) {
  const name = readPackageJson(dir).name;
  if (permanent.has(name)) return;
  if (visiting.has(name)) throw new Error(`Workspace dependency cycle includes ${name}`);
  visiting.add(name);
  for (const depName of workspaceDependencies(readPackageJson(dir))) {
    const depDir = packageByName.get(depName);
    if (depDir !== undefined) visit(depDir, sorted, permanent, visiting);
  }
  visiting.delete(name);
  permanent.add(name);
  sorted.push(dir);
}

function workspaceDependencies(pkg) {
  return Object.entries({ ...pkg.dependencies, ...pkg.peerDependencies })
    .filter(([, version]) => version === "workspace:*")
    .map(([name]) => name);
}

function buildPackage(dir) {
  const srcDir = join(dir, "src");
  if (!existsSync(srcDir)) return;
  const files = sourceFiles(srcDir);
  if (files.length === 0) return;
  const outDir = join(dir, "dist");
  rmSync(outDir, { recursive: true, force: true });
  const result = spawnSync(
    pnpmBin,
    [
      "exec",
      tscBin,
      "--target",
      "ES2023",
      "--module",
      "ESNext",
      "--moduleResolution",
      "Bundler",
      "--strict",
      "--noUncheckedIndexedAccess",
      "--exactOptionalPropertyTypes",
      "--noImplicitOverride",
      "--noFallthroughCasesInSwitch",
      "--noPropertyAccessFromIndexSignature",
      "--isolatedModules",
      "--skipLibCheck",
      "--esModuleInterop",
      "--declaration",
      "--sourceMap",
      "false",
      "--declarationMap",
      "false",
      "--rootDir",
      srcDir,
      "--outDir",
      outDir,
      ...files
    ],
    { cwd: rootDir, encoding: "utf8", stdio: "pipe" }
  );
  if (result.status !== 0) {
    throw new Error([`Build failed for ${relative(rootDir, dir)}`, result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n"));
  }
  copyExecutableModeIfNeeded(dir);
  copyPackageAssets(dir, outDir);
  buildBrowserBundles(dir, readPackageJson(dir));
  console.log(`Built ${relative(rootDir, dir)}`);
}

function sourceFiles(srcDir) {
  const result = [];
  collectTs(srcDir, result);
  return result.sort();
}

function collectTs(dir, result) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTs(path, result);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) result.push(path);
  }
}

function copyExecutableModeIfNeeded(dir) {
  const sourceMain = join(dir, "src", "main.ts");
  const builtMain = join(dir, "dist", "main.js");
  if (existsSync(sourceMain) && existsSync(builtMain)) {
    // 入口文件保留可执行位，方便 `bin` 指向 dist/main.js。
    chmodSync(builtMain, 0o755);
  }
}

function copyPackageAssets(dir, outDir) {
  const patternsDir = join(dir, "patterns");
  const targetDir = join(outDir, "..", "patterns");
  if (existsSync(patternsDir) && patternsDir !== targetDir) cpSync(patternsDir, targetDir, { recursive: true });
}

function buildBrowserBundles(dir, pkg) {
  const config = browserBundleConfig(pkg);
  if (config.length === 0) return;
  for (const bundle of config) {
    const outfile = join(dir, bundle.outfile);
    const result = spawnSync(
      pnpmBin,
      [
        "--dir",
        dir,
        "exec",
        "esbuild",
        bundle.entry,
        "--bundle",
        "--minify",
        "--platform=browser",
        "--target=es2022",
        `--format=${bundle.format}`,
        `--global-name=${bundle.globalName}`,
        `--outfile=${bundle.outfile}`
      ],
      { cwd: rootDir, encoding: "utf8", stdio: "pipe" }
    );
    if (result.status !== 0) {
      throw new Error([`Browser bundle failed for ${relative(rootDir, dir)}`, result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n"));
    }
    const size = evaluateBundleSizeGate({
      path: relative(rootDir, outfile),
      content: readFileSync(outfile),
      maxGzipBytes: bundle.maxGzipBytes
    });
    if (!size.ok) {
      throw new Error(`Browser bundle ${size.path} is ${size.gzipBytes} gzip bytes, above limit ${size.maxGzipBytes}`);
    }
  }
}

function browserBundleConfig(pkg) {
  const build = pkg.supplystrataBuild;
  if (!isRecord(build)) return [];
  const bundles = build.browserBundles;
  if (!Array.isArray(bundles)) return [];
  return bundles.map((bundle, index) => readBrowserBundleConfig(bundle, `${pkg.name}.supplystrataBuild.browserBundles[${index}]`));
}

function readBrowserBundleConfig(value, path) {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  return {
    entry: readString(value, "entry", path),
    outfile: readString(value, "outfile", path),
    format: readBrowserFormat(value, path),
    globalName: readString(value, "globalName", path),
    maxGzipBytes: readPositiveInteger(value, "maxGzipBytes", path)
  };
}

function readBrowserFormat(value, path) {
  const format = readString(value, "format", path);
  if (format !== "iife") throw new Error(`${path}.format must be iife`);
  return format;
}

function readString(value, key, path) {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) throw new Error(`${path}.${key} must be a non-empty string`);
  return field;
}

function readPositiveInteger(value, key, path) {
  const field = value[key];
  if (!Number.isInteger(field) || field <= 0) throw new Error(`${path}.${key} must be a positive integer`);
  return field;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPackageJson(dir) {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
}
