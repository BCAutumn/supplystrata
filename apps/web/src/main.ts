#!/usr/bin/env node
import { createReadStream, existsSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { readScbomCompanyResource, StreamableHttpScbomResourceTransport } from "@supplystrata/web/mcp-http-client";

interface WebCliOptions {
  readonly port: number;
  readonly bind: "127.0.0.1" | "localhost";
  readonly mcpUrl: string;
  readonly companyId: string;
  readonly scbomDocument?: unknown;
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
    void handleViewerRequest(request, response, options);
  });
}

async function handleViewerRequest(request: IncomingMessage, response: ServerResponse, options: WebCliOptions): Promise<void> {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  if (path === "/") {
    try {
      const scbomDocument = options.scbomDocument ?? (await readViewerScbomDocument(options));
      writeHtml(response, viewerHtml(options, scbomDocument));
    } catch (error) {
      writePlain(response, 502, error instanceof Error ? error.message : "SCBOM viewer could not read MCP resource.");
    }
    return;
  }
  if (path === "/theme-demo") {
    try {
      const scbomDocument = options.scbomDocument ?? (await readViewerScbomDocument(options));
      writeHtml(response, themeDemoHtml(options, scbomDocument));
    } catch (error) {
      writePlain(response, 502, error instanceof Error ? error.message : "SCBOM theme demo could not read MCP resource.");
    }
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
}

async function readViewerScbomDocument(options: WebCliOptions): Promise<unknown> {
  return readScbomCompanyResource({
    companyId: options.companyId,
    transport: new StreamableHttpScbomResourceTransport({ endpoint: options.mcpUrl })
  });
}

function viewerHtml(options: WebCliOptions, scbomDocument: unknown): string {
  const configJson = JSON.stringify({ mcpUrl: options.mcpUrl, companyId: options.companyId });
  const documentJson = JSON.stringify(scbomDocument);
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
      <scbom-evidence-view></scbom-evidence-view>
      <scbom-unknown-map></scbom-unknown-map>
      <scbom-supply-chain-graph></scbom-supply-chain-graph>
    </main>
    <script type="application/json" id="viewer-config">${escapeScriptJson(configJson)}</script>
    <script type="application/json" id="scbom-document">${escapeScriptJson(documentJson)}</script>
    <script type="module">
      const config = JSON.parse(document.getElementById("viewer-config").textContent);
      window.ScbomViewer.registerScbomComponents();
      await Promise.all([
        customElements.whenDefined("scbom-supply-chain-graph"),
        customElements.whenDefined("scbom-evidence-view"),
        customElements.whenDefined("scbom-unknown-map")
      ]);
      const documentModel = JSON.parse(document.getElementById("scbom-document").textContent);
      for (const element of document.querySelectorAll("scbom-evidence-view, scbom-unknown-map, scbom-supply-chain-graph")) {
        element.loadScbomDocument(documentModel);
      }
    </script>
  </body>
</html>`;
}

function themeDemoHtml(options: WebCliOptions, scbomDocument: unknown): string {
  const configJson = JSON.stringify({ mcpUrl: options.mcpUrl, companyId: options.companyId });
  const documentJson = JSON.stringify(scbomDocument);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>SCBOM Theme Demo</title>
    <script src="/components.iife.js"></script>
    <style>
      body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #f8fafc; color: #18202a; }
      main { max-width: 1440px; margin: 0 auto; padding: 24px; display: grid; gap: 16px; }
      header { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; }
      code { color: #2563eb; }
      .theme-demo-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; align-items: start; }
      .theme-demo-panel { display: grid; gap: 12px; min-width: 0; }
      .theme-demo-panel-title { margin: 0; font-size: 16px; line-height: 1.35; }
      .theme-demo-custom {
        --scbom-color-surface: #fbfcfd;
        --scbom-color-text: #111827;
        --scbom-color-muted: #475467;
        --scbom-color-border: #b8c4d2;
        --scbom-color-accent: #0f766e;
        --scbom-radius: 4px;
        --scbom-evidence-level-5: #166534;
        --scbom-evidence-level-4: #075985;
        --scbom-evidence-level-3: #92400e;
        --scbom-graph-background: #ffffff;
        --scbom-graph-edge: #64748b;
        --scbom-graph-node: #0f766e;
      }
      .theme-demo-custom scbom-evidence-view::part(surface),
      .theme-demo-custom scbom-unknown-map::part(surface),
      .theme-demo-custom scbom-supply-chain-graph::part(surface) { border-width: 2px; box-shadow: none; }
      .theme-demo-custom scbom-evidence-view::part(relationship-row),
      .theme-demo-custom scbom-unknown-map::part(unknown-item) { border-top-style: dashed; }
      .theme-demo-custom scbom-evidence-view::part(evidence-level) { font-weight: 700; }
      @media (max-width: 900px) { .theme-demo-grid { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>SCBOM Theme Demo</h1>
        <code>${escapeHtml(options.companyId)}</code>
      </header>
      <section class="theme-demo-grid" aria-label="Default and custom SCBOM themes">
        <div class="theme-demo-panel" data-theme-demo="default">
          <h2 class="theme-demo-panel-title">Default neutral theme</h2>
          <scbom-evidence-view></scbom-evidence-view>
          <scbom-unknown-map></scbom-unknown-map>
          <scbom-supply-chain-graph></scbom-supply-chain-graph>
        </div>
        <div class="theme-demo-panel theme-demo-custom" data-theme-demo="custom">
          <h2 class="theme-demo-panel-title">Custom host theme</h2>
          <scbom-evidence-view></scbom-evidence-view>
          <scbom-unknown-map></scbom-unknown-map>
          <scbom-supply-chain-graph></scbom-supply-chain-graph>
        </div>
      </section>
    </main>
    <script type="application/json" id="viewer-config">${escapeScriptJson(configJson)}</script>
    <script type="application/json" id="scbom-document">${escapeScriptJson(documentJson)}</script>
    <script type="module">
      const config = JSON.parse(document.getElementById("viewer-config").textContent);
      window.ScbomViewer.registerScbomComponents();
      await Promise.all([
        customElements.whenDefined("scbom-supply-chain-graph"),
        customElements.whenDefined("scbom-evidence-view"),
        customElements.whenDefined("scbom-unknown-map")
      ]);
      const documentModel = JSON.parse(document.getElementById("scbom-document").textContent);
      for (const element of document.querySelectorAll("scbom-evidence-view, scbom-unknown-map, scbom-supply-chain-graph")) {
        element.loadScbomDocument(documentModel);
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
