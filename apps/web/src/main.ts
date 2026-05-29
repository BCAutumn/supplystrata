#!/usr/bin/env node
import { createReadStream, existsSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";

interface WebCliOptions {
  readonly port: number;
  readonly bind: "127.0.0.1" | "localhost";
  readonly mcpUrl: string;
  readonly companyId: string;
}

const ROOT = process.cwd();
const COMPONENT_BUNDLE_PATH = join(ROOT, "packages/web/dist/components.iife.js");
const MCP_CLIENT_PATH = join(ROOT, "packages/web/dist/functions/mcp-http-client.js");

export async function runWebViewerCli(argv: readonly string[], io: { stderr: Pick<NodeJS.WriteStream, "write"> }): Promise<number> {
  try {
    const options = parseWebCliOptions(argv);
    const server = createWebViewerServer(options);
    await listen(server, options.port, options.bind);
    io.stderr.write(`SupplyStrata SCBOM viewer listening on http://${options.bind}:${options.port}\n`);
    return 0;
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : "Unknown web viewer startup error."}\n`);
    return 1;
  }
}

export function createWebViewerServer(options: WebCliOptions): Server {
  return createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
      writeHtml(response, viewerHtml(options));
      return;
    }
    if (path === "/components.iife.js") {
      writeFile(response, COMPONENT_BUNDLE_PATH, "application/javascript; charset=utf-8");
      return;
    }
    if (path === "/mcp-http-client.js") {
      writeFile(response, MCP_CLIENT_PATH, "application/javascript; charset=utf-8");
      return;
    }
    writePlain(response, 404, "Not Found");
  });
}

function viewerHtml(options: WebCliOptions): string {
  const configJson = JSON.stringify({ mcpUrl: options.mcpUrl, companyId: options.companyId });
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>SCBOM Viewer</title>
    <script src="/components.iife.js"></script>
    <style>
      body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #f8fafc; color: #18202a; }
      main { max-width: 1180px; margin: 0 auto; padding: 24px; display: grid; gap: 16px; }
      header { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; }
      code { color: #2563eb; }
      scbom-evidence-view, scbom-unknown-map, scbom-supply-chain-graph { --scbom-color-surface: #ffffff; }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>SCBOM Viewer</h1>
        <code>${escapeHtml(options.companyId)}</code>
      </header>
      <scbom-supply-chain-graph></scbom-supply-chain-graph>
      <scbom-evidence-view></scbom-evidence-view>
      <scbom-unknown-map></scbom-unknown-map>
    </main>
    <script type="application/json" id="viewer-config">${escapeScriptJson(configJson)}</script>
    <script type="module">
      import { readScbomCompanyResource, StreamableHttpScbomResourceTransport } from "/mcp-http-client.js";
      const config = JSON.parse(document.getElementById("viewer-config").textContent);
      window.ScbomViewer.registerScbomComponents();
      const transport = new StreamableHttpScbomResourceTransport({ endpoint: config.mcpUrl });
      const documentModel = await readScbomCompanyResource({ companyId: config.companyId, transport });
      for (const element of document.querySelectorAll("scbom-evidence-view, scbom-unknown-map, scbom-supply-chain-graph")) {
        element.scbomDocument = documentModel;
      }
    </script>
  </body>
</html>`;
}

function parseWebCliOptions(argv: readonly string[]): WebCliOptions {
  const raw = parseRawOptions(argv);
  return {
    port: parsePort(raw["port"] ?? "8787"),
    bind: parseBind(raw["bind"] ?? "127.0.0.1"),
    mcpUrl: raw["mcp-url"] ?? "http://127.0.0.1:7474/mcp",
    companyId: raw["company"] ?? "ENT-NVIDIA"
  };
}

function parseRawOptions(argv: readonly string[]): Record<string, string> {
  const output: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (!arg.startsWith("--")) throw new Error(`Unsupported web viewer argument: ${arg}`);
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    output[key] = value;
    index += 1;
  }
  return output;
}

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid web viewer port: ${value}`);
  return port;
}

function parseBind(value: string): WebCliOptions["bind"] {
  if (value === "127.0.0.1" || value === "localhost") return value;
  throw new Error("Web viewer binds to localhost only; expose it through your own reverse proxy if needed.");
}

function writeHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
}

function writePlain(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(body);
}

function writeFile(response: ServerResponse, path: string, contentType: string): void {
  if (!existsSync(path)) {
    writePlain(response, 500, `Missing built asset: ${path}`);
    return;
  }
  response.writeHead(200, { "content-type": contentType });
  createReadStream(path).pipe(response);
}

function listen(server: Server, port: number, bind: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, bind, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function escapeHtml(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
}

function escapeScriptJson(value: string): string {
  return value
    .replace(/</gu, "\\u003c")
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const code = await runWebViewerCli(process.argv.slice(2), { stderr: process.stderr });
  process.exitCode = code;
}
