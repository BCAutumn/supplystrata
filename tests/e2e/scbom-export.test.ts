import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import scbomConformanceSuite from "@scbom/spec/conformance";
import { migrate, importDevFixturesFromCsv } from "@supplystrata/db/admin";
import { assertScbomDocument, buildWorkbenchModel, toScbomDocument } from "@supplystrata/workbench-export";
import { canConnectToIntegrationDatabase, createIntegrationDatabaseStore } from "../integration/helpers.js";

const hasDatabase = await canConnectToIntegrationDatabase();
const describeDb = hasDatabase ? describe.sequential : describe.skip;
const generatedAt = "2026-05-23T00:00:00.000Z";

describe("SCBOM conformance suite", () => {
  it("matches @scbom/spec v0.0.1 valid and invalid examples", () => {
    expect(scbomConformanceSuite.schema_version).toBe("0.0.1");
    expect(scbomConformanceSuite.cases.length).toBeGreaterThanOrEqual(20);

    for (const testCase of scbomConformanceSuite.cases) {
      if (testCase.valid) {
        expect(() => assertScbomDocument(testCase.document), testCase.id).not.toThrow();
      } else {
        expect(() => assertScbomDocument(testCase.document), testCase.id).toThrow();
      }
    }
  });
});

describeDb("SCBOM DB export e2e", () => {
  const pool = createIntegrationDatabaseStore();

  beforeAll(async () => {
    await migrate(pool);
    await importDevFixturesFromCsv(pool, process.cwd());
  });

  afterAll(async () => {
    await pool.close();
  });

  it("exports a DB-backed company workbench model as a conformant SCBOM document", async () => {
    const model = await buildWorkbenchModel(pool.read, { company: "nvidia", depth: 1, generatedAt });
    const document = toScbomDocument(model);

    assertScbomDocument(document);
    expect(document.schema_version).toBe("0.0.1");
    expect(document.generated_at).toBe(generatedAt);
    expect(document.objects.some((object) => object.object_type === "entity" && object.id === model.selected_company_id)).toBe(true);
  });

  it("serves a conformant SCBOM document through the MCP db runtime resource", async () => {
    const transport = new StdioClientTransport({
      command: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      args: ["--silent", "tsx", "apps/mcp/src/main.ts", "--transport=stdio", "--runtime=db"],
      cwd: process.cwd(),
      stderr: "pipe",
      env: {
        ...process.env,
        NODE_OPTIONS: nodeOptionsWithDevelopmentCondition(process.env["NODE_OPTIONS"])
      }
    });
    const client = new Client({
      name: "supplystrata-scbom-e2e-client",
      version: "0.1.0"
    });

    try {
      await client.connect(transport);
      const result = await client.readResource({ uri: "supplystrata://scbom/company/ENT-NVIDIA" });
      const firstContent = result.contents[0];
      if (firstContent === undefined || !("text" in firstContent)) throw new Error("Expected SCBOM resource to return JSON text content.");

      const parsed: unknown = JSON.parse(firstContent.text);
      assertScbomDocument(parsed);
      expect(parsed.schema_version).toBe("0.0.1");
      expect(parsed.objects.some((object) => object.object_type === "entity" && object.id === "ENT-NVIDIA")).toBe(true);
    } finally {
      await closeQuietly(client, transport);
    }
  });
});

function nodeOptionsWithDevelopmentCondition(current: string | undefined): string {
  const parts = current === undefined || current.trim().length === 0 ? [] : current.split(/\s+/);
  return parts.includes("--conditions=development") ? parts.join(" ") : ["--conditions=development", ...parts].join(" ");
}

async function closeQuietly(client: Client, transport: StdioClientTransport): Promise<void> {
  try {
    await client.close();
  } catch {
    await transport.close();
  }
}
