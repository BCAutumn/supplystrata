import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createWebViewerServer } from "../../apps/web/src/main.js";

let closeServer: (() => Promise<void>) | undefined;

describe("local SCBOM viewer app", () => {
  afterEach(async () => {
    if (closeServer !== undefined) await closeServer();
    closeServer = undefined;
  });

  it("serves a localhost viewer shell wired to the configured MCP endpoint", async () => {
    const server = createWebViewerServer({
      port: 0,
      bind: "127.0.0.1",
      companyId: "ENT-NVIDIA",
      mcpUrl: "http://127.0.0.1:7474/mcp"
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    closeServer = () => new Promise((resolve) => server.close(() => resolve()));
    const address = server.address();
    if (!isAddressInfo(address)) throw new Error("Expected HTTP server address info");

    const html = await getText(`http://127.0.0.1:${address.port}/`);

    expect(html).toContain("<scbom-evidence-view>");
    expect(html).toContain("<scbom-unknown-map>");
    expect(html).toContain("<scbom-supply-chain-graph>");
    expect(html).toContain("http://127.0.0.1:7474/mcp");
    const configJson = html.match(/<script type="application\/json" id="viewer-config">(?<json>.*?)<\/script>/u)?.groups?.["json"];
    expect(configJson).toBeDefined();
    expect(JSON.parse(configJson ?? "{}")).toEqual({ companyId: "ENT-NVIDIA", mcpUrl: "http://127.0.0.1:7474/mcp" });
  });
});

function getText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request(url, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: unknown) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      });
      response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    req.on("error", reject);
    req.end();
  });
}

function isAddressInfo(value: unknown): value is AddressInfo {
  return typeof value === "object" && value !== null && "port" in value;
}
