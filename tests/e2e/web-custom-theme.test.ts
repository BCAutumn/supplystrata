import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { toScbomDocument } from "@supplystrata/workbench-export";
import { createWebViewerServer } from "../../apps/web/src/main.js";
import { workbenchScbomFixture } from "../unit/workbench-scbom-fixture.js";

let closeServer: (() => Promise<void>) | undefined;

describe("SCBOM viewer custom theme demo", () => {
  afterEach(async () => {
    if (closeServer !== undefined) await closeServer();
    closeServer = undefined;
  });

  it("renders the same SCBOM in default and custom themes using only host CSS hooks", async () => {
    const server = createWebViewerServer({
      port: 0,
      bind: "127.0.0.1",
      companyId: "ENT-NVIDIA",
      mcpUrl: "http://127.0.0.1:7474/mcp",
      scbomDocument: toScbomDocument(workbenchScbomFixture())
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

    const html = await getText(`http://127.0.0.1:${address.port}/theme-demo`);

    expect(html).toContain('data-theme-demo="default"');
    expect(html).toContain('data-theme-demo="custom"');
    expect(html).toContain("--scbom-color-accent: #0f766e");
    expect(html).toContain("--scbom-graph-node: #0f766e");
    expect(html).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(html).toContain("@media (max-width: 900px)");
    expect(html).toContain("scbom-evidence-view::part(relationship-row)");
    expect(html).toContain("scbom-unknown-map::part(unknown-item)");
    expect(html).toContain("scbom-evidence-view::part(evidence-level)");
    expect(countOccurrences(html, "<scbom-evidence-view>")).toBe(2);
    expect(countOccurrences(html, "<scbom-unknown-map>")).toBe(2);
    expect(countOccurrences(html, "<scbom-supply-chain-graph>")).toBe(2);
    expect(html.indexOf("<scbom-evidence-view>")).toBeLessThan(html.indexOf("<scbom-supply-chain-graph>"));
    expect(html).not.toContain("@supplystrata");
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

function countOccurrences(value: string, search: string): number {
  return value.split(search).length - 1;
}
