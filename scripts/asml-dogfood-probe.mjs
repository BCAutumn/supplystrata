#!/usr/bin/env node
// Focused probes to confirm read-surface scope inconsistencies and resolver robustness.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const transport = new StdioClientTransport({
  command: pnpmBin,
  args: ["--silent", "tsx", "apps/mcp/src/main.ts", "--transport=stdio", "--runtime=db"],
  cwd: process.cwd(),
  stderr: "pipe",
  env: { ...process.env, NODE_OPTIONS: ["--conditions=development", process.env.NODE_OPTIONS ?? ""].join(" ").trim() }
});
const client = new Client({ name: "asml-probe", version: "0.1.0" });

async function call(name, args) {
  try {
    const r = await client.callTool({ name, arguments: args });
    const status = r.isError ? "ERROR" : "ok";
    const text = (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join(" ").slice(0, 240);
    console.log(`\n${name}(${JSON.stringify(args)}) -> ${status}\n  ${text}`);
    return r;
  } catch (e) {
    console.log(`\n${name}(${JSON.stringify(args)}) -> THREW ${e.message}`);
    return null;
  }
}

await client.connect(transport);
await call("list_unknowns", { scope: "company:ENT-ASML" });
await call("list_unknowns", { scope: "ENT-ASML" });
await call("resolve_company", { query: "ASML Holding N.V." });
await call("resolve_company", { query: "ASML" });
await call("resolve_company", { query: "Acme Nonexistent Corp 99" });
await call("traverse_chain", { scope: "ENT-ASML", depth: 1 });
await client.close();
