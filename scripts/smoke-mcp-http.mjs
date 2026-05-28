#!/usr/bin/env node
import { spawn } from "node:child_process";
import { once } from "node:events";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const ROOT_DIR = process.cwd();
const TIMEOUT_MS = 30_000;
const PORT = Number(process.env["SUPPLYSTRATA_MCP_HTTP_SMOKE_PORT"] ?? "48123");
const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const server = spawn(pnpmBin, ["--silent", "tsx", "apps/mcp/src/main.ts", "--transport=http", "--runtime=fixture", `--port=${PORT}`, "--bind=127.0.0.1"], {
  cwd: ROOT_DIR,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    NODE_OPTIONS: nodeOptionsWithDevelopmentCondition(process.env["NODE_OPTIONS"])
  }
});

const stdoutChunks = [];
const stderrChunks = [];

server.stdout.on("data", (chunk) => {
  stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
});
server.stderr.on("data", (chunk) => {
  stderrChunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
});

try {
  await withTimeout(runSmoke(), TIMEOUT_MS);
} catch (error) {
  const stderr = stderrChunks.join("").trim();
  const stdout = stdoutChunks.join("").trim();
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write([`MCP HTTP smoke failed: ${message}`, stderr, stdout].filter((item) => item.length > 0).join("\n"));
  process.stderr.write("\n");
  process.exitCode = 1;
} finally {
  await closeServer();
}

async function runSmoke() {
  await waitForServerReady();

  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`));
  const client = new Client({
    name: "supplystrata-mcp-http-smoke-client",
    version: "0.1.0"
  });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assertToolNames(tools, ["resolve_company", "run_source_check", "review.approve", "review.reject"]);

    const resolved = await callStructuredTool(client, "resolve_company", { query: "NVIDIA" });
    assertPath(resolved, ["data", "operation_id"], "getCompanyCard");

    const pendingSourceCheck = await callStructuredTool(client, "run_source_check", { check_target_ids: ["target-sec-edgar-nvidia"] });
    assertPath(pendingSourceCheck, ["status"], "requires_confirmation");
    const confirmedSourceCheck = await callStructuredTool(client, "run_source_check", {
      pending_id: readStringPath(pendingSourceCheck, ["pending_id"]),
      confirmation_token: readStringPath(pendingSourceCheck, ["confirmation_token"])
    });
    assertPath(confirmedSourceCheck, ["status"], "executed");

    const sourceHealth = await client.readResource({ uri: "supplystrata://source-health" });
    if (sourceHealth.contents.length === 0) throw new Error("Expected source-health resource to return content.");

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          transport: "http",
          checked: ["listTools", "resolve_company", "run_source_check", "source-health resource"]
        },
        null,
        2
      )}\n`
    );
  } finally {
    await client.close();
  }
}

async function waitForServerReady() {
  while (!stderrChunks.join("").includes("SupplyStrata MCP HTTP listening")) {
    if (server.exitCode !== null) throw new Error(`MCP HTTP server exited before listening with code ${server.exitCode}.`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function callStructuredTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError === true) throw new Error(`${name} returned MCP error: ${toolErrorText(result)}`);
  if (!isRecord(result.structuredContent)) throw new Error(`${name} did not return structuredContent.`);
  return result.structuredContent;
}

function assertToolNames(tools, expectedNames) {
  const names = tools.tools.map((tool) => tool.name);
  for (const expectedName of expectedNames) {
    if (!names.includes(expectedName)) throw new Error(`MCP HTTP server did not list expected tool: ${expectedName}`);
  }
}

function toolErrorText(result) {
  const messages = result.content
    .filter((item) => isRecord(item) && item.type === "text" && typeof item.text === "string")
    .map((item) => item.text.trim())
    .filter((text) => text.length > 0);
  return messages.length > 0 ? messages.join("\n") : JSON.stringify(result);
}

function assertPath(root, path, expected) {
  const value = readPath(root, path);
  if (value !== expected) throw new Error(`Expected ${path.join(".")} to equal ${JSON.stringify(expected)}, got ${JSON.stringify(value)}.`);
}

function readStringPath(root, path) {
  const value = readPath(root, path);
  if (typeof value !== "string" || value.length === 0) throw new Error(`Expected ${path.join(".")} to be a non-empty string.`);
  return value;
}

function readPath(root, path) {
  let current = root;
  for (const segment of path) {
    if (!isRecord(current) || !(segment in current)) throw new Error(`Missing structuredContent path: ${path.join(".")}`);
    current = current[segment];
  }
  return current;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nodeOptionsWithDevelopmentCondition(current) {
  const parts = current === undefined || current.trim().length === 0 ? [] : current.split(/\s+/);
  return parts.includes("--conditions=development") ? parts.join(" ") : ["--conditions=development", ...parts].join(" ");
}

function withTimeout(promise, timeoutMs) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms.`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeout);
  });
}

async function closeServer() {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await once(server, "exit");
}
