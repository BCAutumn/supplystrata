import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildCommunityPack } from "@supplystrata/community-pack";
import { callMcpApiReadOperation, createMcpRuntime, MCP_RUNTIME_FIXTURE, parseMcpCliOptions, requireMcpDbPostgresUrl } from "@supplystrata/mcp";
import { workbenchScbomFixture } from "./workbench-scbom-fixture.js";

describe("apps/mcp runtime modes", () => {
  it("defaults fixture runtime to injected handlers without DB access", async () => {
    const runtime = createMcpRuntime(MCP_RUNTIME_FIXTURE);

    try {
      expect(runtime.mode).toBe(MCP_RUNTIME_FIXTURE);
      expect(runtime.serverOptions.handlers?.["getCompanyCard"]).toBeTypeOf("function");
      expect(runtime.serverOptions.writeExecutors?.run_source_check).toBeTypeOf("function");
    } finally {
      await runtime.close();
    }
  });

  it("fails fast when db runtime has no explicit POSTGRES_URL", () => {
    expect(() => requireMcpDbPostgresUrl(undefined)).toThrow("MCP --runtime=db requires POSTGRES_URL");
    expect(() => requireMcpDbPostgresUrl("")).toThrow("MCP --runtime=db requires POSTGRES_URL");
  });

  it("parses pack path and serves pack SCBOM as a baseline overlay", async () => {
    const dir = await writePackFixture();
    expect(parseMcpCliOptions(["--transport=stdio", "--runtime=fixture", `--pack=${dir}`])).toMatchObject({ packPath: dir });
    const runtime = createMcpRuntime(MCP_RUNTIME_FIXTURE, { packPath: dir });

    try {
      const handlers = runtime.serverOptions.handlers;
      if (handlers === undefined) throw new Error("Expected fixture runtime handlers");
      const envelope = await callMcpApiReadOperation({
        handlers,
        operation_id: "getCompanyScbomDocument",
        path_params: { id: "ENT-NVIDIA" },
        now: "2026-05-29T00:00:00.000Z"
      });

      expect(envelope.data).toMatchObject({
        schema_version: "0.0.1"
      });
      expect(JSON.stringify(envelope.data)).toContain("community-pack:pack-2026.Q2");
    } finally {
      await runtime.close();
    }
  });
});

async function writePackFixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "supplystrata-mcp-pack-"));
  const pack = buildCommunityPack({
    packVersion: "pack-2026.Q2",
    generatedAt: "2026-05-29T00:00:00.000Z",
    license: "CC-BY-4.0",
    sourceInstanceFingerprint: "f".repeat(64),
    workbenchModels: [workbenchScbomFixture()]
  });
  await mkdir(join(dir, "scbom"), { recursive: true });
  await writeFile(join(dir, "manifest.json"), `${JSON.stringify(pack.manifest, null, 2)}\n`, "utf8");
  await writeFile(join(dir, "scbom", "companies.jsonl"), String(pack.files[0]?.content ?? ""), "utf8");
  return dir;
}
