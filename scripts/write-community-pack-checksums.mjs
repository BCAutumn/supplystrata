#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const rootDir = process.cwd();
const packDir = process.argv[2] ?? "reports/community-pack";

const files = (await listFiles(packDir)).sort();
if (!files.some((file) => relative(packDir, file) === "manifest.json")) {
  throw new Error(`Community-pack directory must include manifest.json: ${packDir}`);
}

const lines = [];
for (const file of files) {
  if (relative(packDir, file) === "SHA256SUMS") continue;
  const content = await readFile(file);
  lines.push(`${createHash("sha256").update(content).digest("hex")}  ${relative(packDir, file)}`);
}

await writeFile(join(packDir, "SHA256SUMS"), `${lines.join("\n")}\n`, "utf8");
console.log(JSON.stringify({ ok: true, pack_dir: relative(rootDir, packDir), files: lines.length }, null, 2));

async function listFiles(dir) {
  const output = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await listFiles(path)));
      continue;
    }
    if (entry.isFile()) output.push(path);
  }
  return output;
}
