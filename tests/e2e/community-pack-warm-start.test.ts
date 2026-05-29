import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ScbomDocument } from "@scbom/spec";
import { buildCommunityPack, loadCommunityPackFromPath } from "@supplystrata/community-pack";
import {
  createMcpHttpNodeServer,
  createMcpRuntime,
  MCP_RUNTIME_FIXTURE,
  type SupplyStrataMcpServerOptions,
  withCommunityPackBaseline
} from "@supplystrata/mcp";
import { toScbomDocument, type WorkbenchModel } from "@supplystrata/workbench-export";
import { afterEach, describe, expect, it } from "vitest";

import { createWebViewerServer } from "../../apps/web/src/main.js";
import { workbenchScbomFixture } from "../unit/workbench-scbom-fixture.js";

interface ClosableServer {
  close(): Promise<void>;
}

const startedServers: ClosableServer[] = [];

describe("community-pack warm-start e2e", () => {
  afterEach(async () => {
    while (startedServers.length > 0) {
      const server = startedServers.pop();
      if (server !== undefined) await server.close();
    }
  });

  it("builds a pack, serves it through MCP HTTP, renders it in the viewer, and lets upstream re-verify win", async () => {
    const packPath = await writePackFixture();

    const warmStartRuntime = createMcpRuntime(MCP_RUNTIME_FIXTURE, { packPath });
    const warmStartMcp = await startMcpHttpServer(warmStartRuntime.serverOptions);
    const warmStartViewer = await startViewerServer({
      companyId: "ENT-NVIDIA",
      mcpUrl: warmStartMcp.endpoint
    });
    const warmStartHtml = await getText(warmStartViewer.url);
    const warmStartDocument = inlineScbomDocument(warmStartHtml);

    expect(JSON.stringify(warmStartDocument)).toContain("community-pack:pack-2026.Q2");
    expect(relationshipIds(warmStartDocument)).toEqual(["EDGE-NVIDIA-TSMC"]);

    const verifiedPack = loadCommunityPackFromPath(packPath);
    const verifiedMcp = await startMcpHttpServer({
      handlers: withCommunityPackBaseline(
        {
          getCompanyScbomDocument: async () => toScbomDocument(localVerifiedWorkbenchFixture())
        },
        verifiedPack
      )
    });
    const verifiedViewer = await startViewerServer({
      companyId: "ENT-NVIDIA",
      mcpUrl: verifiedMcp.endpoint
    });
    const verifiedHtml = await getText(verifiedViewer.url);
    const verifiedDocument = inlineScbomDocument(verifiedHtml);

    expect(relationshipIds(verifiedDocument)).toEqual(["EDGE-LOCAL-UPSTREAM"]);
    expect(JSON.stringify(verifiedDocument)).not.toContain("community-pack:pack-2026.Q2");

    await warmStartRuntime.close();
  });
});

async function writePackFixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "supplystrata-community-pack-e2e-"));
  const pack = buildCommunityPack({
    packVersion: "pack-2026.Q2",
    generatedAt: "2026-05-29T00:00:00.000Z",
    license: "CC-BY-4.0",
    sourceInstanceFingerprint: "1".repeat(64),
    workbenchModels: [workbenchScbomFixture()]
  });

  await mkdir(join(dir, "scbom"), { recursive: true });
  await writeFile(join(dir, "manifest.json"), `${JSON.stringify(pack.manifest, null, 2)}\n`, "utf8");
  await writeFile(join(dir, "scbom", "companies.jsonl"), String(pack.files[0]?.content ?? ""), "utf8");
  return dir;
}

async function startMcpHttpServer(mcp: SupplyStrataMcpServerOptions): Promise<{ endpoint: string }> {
  const server = await createMcpHttpNodeServer({ mcp });
  await listen(server.nodeServer);
  startedServers.push({ close: server.close });
  const address = server.nodeServer.address();
  if (!isAddressInfo(address)) throw new Error("Expected MCP HTTP server address info.");
  return { endpoint: `http://127.0.0.1:${address.port}${server.endpointPath}` };
}

async function startViewerServer(input: { companyId: string; mcpUrl: string }): Promise<{ url: string }> {
  const server = createWebViewerServer({
    port: 0,
    bind: "127.0.0.1",
    companyId: input.companyId,
    mcpUrl: input.mcpUrl
  });
  await listen(server);
  startedServers.push({ close: () => closeNodeServer(server) });
  const address = server.address();
  if (!isAddressInfo(address)) throw new Error("Expected web viewer server address info.");
  return { url: `http://127.0.0.1:${address.port}/` };
}

function inlineScbomDocument(html: string): ScbomDocument {
  const documentJson = html.match(/<script type="application\/json" id="scbom-document">(?<json>.*?)<\/script>/u)?.groups?.["json"];
  if (documentJson === undefined) throw new Error("Expected viewer HTML to inline an SCBOM document.");
  const parsed: unknown = JSON.parse(documentJson);
  if (!isScbomDocument(parsed)) throw new Error("Expected viewer inline document to be an SCBOM document.");
  return parsed;
}

function relationshipIds(document: ScbomDocument): string[] {
  return document.objects.flatMap((object) => (object.object_type === "relationship" ? [object.id] : []));
}

function localVerifiedWorkbenchFixture(): WorkbenchModel {
  const model = workbenchScbomFixture();
  return {
    ...model,
    chain: {
      ...model.chain,
      segments: model.chain.segments.map((segment) => (segment.edge_id === undefined ? segment : { ...segment, edge_id: "EDGE-LOCAL-UPSTREAM" }))
    },
    chain_segments: model.chain_segments.map((segment) => (segment.edge_id === undefined ? segment : { ...segment, edge_id: "EDGE-LOCAL-UPSTREAM" })),
    edges: model.edges.map((edge) => ({ ...edge, edge_id: "EDGE-LOCAL-UPSTREAM" })),
    upstream_edges: model.upstream_edges.map((edge) => ({ ...edge, edge_id: "EDGE-LOCAL-UPSTREAM" })),
    evidences: model.evidences.map((evidence) => ({ ...evidence, edge_id: "EDGE-LOCAL-UPSTREAM" }))
  };
}

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

function listen(server: {
  listen(port: number, host: string, callback: () => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  off(event: "error", listener: (error: Error) => void): unknown;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeNodeServer(server: { close(callback: () => void): unknown }): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function isAddressInfo(value: unknown): value is AddressInfo {
  return typeof value === "object" && value !== null && "port" in value;
}

function isScbomDocument(value: unknown): value is ScbomDocument {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "schema_version" in value && "objects" in value;
}
