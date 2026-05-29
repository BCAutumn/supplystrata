import { describe, expect, it } from "vitest";
import { buildCommunityPack, loadCommunityPackFromPath } from "@supplystrata/community-pack";
import { withCommunityPackBaseline } from "@supplystrata/mcp";
import { toScbomDocument, type WorkbenchModel } from "@supplystrata/workbench-export";
import { workbenchScbomFixture } from "./workbench-scbom-fixture.js";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_OPERATION_ROUTES, type ApiRouteContract } from "@supplystrata/api-orchestration";

describe("community-pack MCP conflict strategy", () => {
  it("uses upstream/local SCBOM relationships over pack baseline when both exist", async () => {
    const pack = loadCommunityPackFromPath(await writePackFixture());
    const upstreamDocument = toScbomDocument(localWorkbenchFixture());
    const handlers = withCommunityPackBaseline(
      {
        getCompanyScbomDocument: async () => upstreamDocument
      },
      pack
    );

    const result = await handlers["getCompanyScbomDocument"]?.({
      path_params: { id: "ENT-NVIDIA" },
      query: new URLSearchParams(),
      body: undefined,
      now: "2026-05-29T00:00:00.000Z",
      route: scbomRoute()
    });

    expect(JSON.stringify(result)).toContain("EDGE-LOCAL-UPSTREAM");
    expect(JSON.stringify(result)).not.toContain("community-pack:pack-2026.Q2");
  });

  it("uses pack baseline when local runtime cannot produce a relationship-backed SCBOM document", async () => {
    const pack = loadCommunityPackFromPath(await writePackFixture());
    const handlers = withCommunityPackBaseline(
      {
        getCompanyScbomDocument: async () => ({ schema_version: "0.0.1", objects: [] })
      },
      pack
    );

    const result = await handlers["getCompanyScbomDocument"]?.({
      path_params: { id: "ENT-NVIDIA" },
      query: new URLSearchParams(),
      body: undefined,
      now: "2026-05-29T00:00:00.000Z",
      route: scbomRoute()
    });

    expect(JSON.stringify(result)).toContain("community-pack:pack-2026.Q2");
  });
});

async function writePackFixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "supplystrata-mcp-conflict-pack-"));
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

function scbomRoute(): ApiRouteContract {
  const route = API_OPERATION_ROUTES.find((candidate) => candidate.operation_id === "getCompanyScbomDocument");
  if (route === undefined) throw new Error("Expected getCompanyScbomDocument route");
  return route;
}

function localWorkbenchFixture(): WorkbenchModel {
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
