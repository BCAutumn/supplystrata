import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import type { ApiOperationHandlerInput, ApiOperationHandlers, ApiOperationId } from "@supplystrata/api-orchestration";
import { createSupplyStrataMcpServer, MCP_READ_TOOL_NAMES } from "@supplystrata/mcp";
import { assertScbomDocument } from "@supplystrata/workbench-export";

const FIXED_NOW = "2026-05-28T00:00:00.000Z";

describe("mcp read surface", () => {
  it("registers read tools and routes every call through api-orchestration handlers", async () => {
    const calls: ApiOperationId[] = [];
    const { server } = createSupplyStrataMcpServer({
      handlers: fakeReadHandlers(calls),
      now: () => FIXED_NOW
    });
    const client = new Client({
      name: "supplystrata-mcp-read-test-client",
      version: "0.1.0"
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["ping", ...MCP_READ_TOOL_NAMES]));
      for (const toolName of MCP_READ_TOOL_NAMES) {
        const tool = tools.tools.find((candidate) => candidate.name === toolName);
        expect(tool?.annotations?.readOnlyHint).toBe(true);
        expect(tool?.outputSchema).toMatchObject({
          type: "object",
          properties: {
            schema_version: { type: "string" },
            contract_version: { type: "string" }
          }
        });
      }

      await expectReadTool(client, "resolve_company", { query: "NVIDIA" }, "resolveCompanyIdentity");
      await expectReadTool(client, "read_evidence_for_edge", { edge_id: "EV-EDGE-1" }, "getEvidence");
      await expectReadTool(client, "traverse_chain", { scope: "company:ENT-NVIDIA", depth: 2 }, "getChain");
      await expectReadTool(client, "list_unknowns", { scope: "company:ENT-NVIDIA" }, "listUnknowns");
      await expectReadTool(client, "list_source_targets", { scope: "company:ENT-NVIDIA" }, "listSourceHealth");
      await expectReadTool(client, "poll_research_run", { run_id: "RR-1" }, "getResearchRunStatus");

      expect(calls).toEqual(["resolveCompanyIdentity", "getEvidence", "getChain", "listUnknowns", "listSourceHealth", "getResearchRunStatus"]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("exposes every planned read resource as a JSON API envelope", async () => {
    const calls: ApiOperationId[] = [];
    const { server } = createSupplyStrataMcpServer({
      handlers: fakeReadHandlers(calls),
      now: () => FIXED_NOW
    });
    const client = new Client({
      name: "supplystrata-mcp-resource-test-client",
      version: "0.1.0"
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      await expectReadResource(client, "supplystrata://entity/ENT-NVIDIA", "getCompanyCard");
      await expectReadResource(client, "supplystrata://evidence/edge/EV-EDGE-1", "getEvidence");
      await expectReadResource(client, "supplystrata://unknowns/company/ENT-NVIDIA", "listUnknowns");
      await expectReadResource(client, "supplystrata://changes/entity/ENT-NVIDIA", "listChanges", {
        scope: "entity:ENT-NVIDIA"
      });
      await expectReadResource(client, "supplystrata://source-health", "listSourceHealth");
      await expectReadResource(client, "supplystrata://reasoning-walkthrough/ENT-NVIDIA", "getCompanyReasoningWalkthrough");
      await expectScbomResource(client, "supplystrata://scbom/company/ENT-NVIDIA");

      expect(calls).toEqual([
        "getCompanyCard",
        "getEvidence",
        "listUnknowns",
        "listChanges",
        "listSourceHealth",
        "getCompanyReasoningWalkthrough",
        "getCompanyScbomDocument"
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("keeps read tool input schemas active", async () => {
    const { server } = createSupplyStrataMcpServer({
      handlers: fakeReadHandlers([]),
      now: () => FIXED_NOW
    });
    const client = new Client({
      name: "supplystrata-mcp-schema-test-client",
      version: "0.1.0"
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const result = await client.callTool({
        name: "resolve_company",
        arguments: {}
      });

      if (!("content" in result)) throw new Error("Expected schema failure to return a standard MCP tool result.");
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("query");
    } finally {
      await client.close();
      await server.close();
    }
  });
});

async function expectReadTool(client: Client, name: string, args: Record<string, unknown>, operationId: ApiOperationId): Promise<void> {
  const result = await client.callTool({
    name,
    arguments: args
  });

  if (!("content" in result)) throw new Error(`Expected ${name} to return a standard MCP tool result.`);

  expect(result.structuredContent).toMatchObject({
    schema_version: "1.0.0",
    contract_version: "0.1.0",
    data: {
      operation_id: operationId
    },
    meta: {
      generated_at: FIXED_NOW,
      read_policy: "read_only_no_truth_store_mutation"
    }
  });
}

async function expectScbomResource(client: Client, uri: string): Promise<void> {
  const result = await client.readResource({ uri });
  const firstContent = result.contents[0];
  if (firstContent === undefined || !("text" in firstContent)) throw new Error(`Expected ${uri} to return JSON text content.`);

  const parsed: unknown = JSON.parse(firstContent.text);
  assertScbomDocument(parsed);
  expect(parsed).toMatchObject({
    schema_version: "0.0.1",
    document_id: "document:ENT-NVIDIA:2026-05-28T00:00:00.000Z"
  });
}

async function expectReadResource(
  client: Client,
  uri: string,
  operationId: ApiOperationId,
  expectedQuery?: Record<string, string>
): Promise<void> {
  const result = await client.readResource({ uri });
  const firstContent = result.contents[0];
  if (firstContent === undefined || !("text" in firstContent)) throw new Error(`Expected ${uri} to return JSON text content.`);

  const parsed: unknown = JSON.parse(firstContent.text);
  expect(parsed).toMatchObject({
    schema_version: "1.0.0",
    contract_version: "0.1.0",
    data: {
      operation_id: operationId,
      ...(expectedQuery === undefined ? {} : { query: expectedQuery })
    },
    meta: {
      generated_at: FIXED_NOW,
      read_policy: "read_only_no_truth_store_mutation"
    }
  });
}

function fakeReadHandlers(calls: ApiOperationId[]): ApiOperationHandlers {
  return {
    getCompanyCard: async (input) => fakeReadData(input, calls),
    resolveCompanyIdentity: async (input) => fakeReadData(input, calls),
    getEvidence: async (input) => fakeReadData(input, calls),
    getChain: async (input) => fakeReadData(input, calls),
    listUnknowns: async (input) => fakeReadData(input, calls),
    listSourceHealth: async (input) => fakeReadData(input, calls),
    getResearchRunStatus: async (input) => fakeReadData(input, calls),
    listChanges: async (input) => fakeReadData(input, calls),
    getCompanyReasoningWalkthrough: async (input) => fakeReadData(input, calls),
    getCompanyScbomDocument: async (input) => {
      calls.push(input.route.operation_id);
      const companyId = input.path_params["id"] ?? "ENT-NVIDIA";
      return {
        schema_version: "0.0.1",
        document_id: `document:${companyId}:${input.now}`,
        generated_at: input.now,
        producer: {
          name: "SupplyStrata",
          version: "0.1.0",
          homepage: "https://github.com/BCAutumn/supplystrata"
        },
        objects: [
          {
            object_type: "entity",
            id: companyId,
            name: "NVIDIA Corporation",
            entity_kind: "legal_entity",
            identifiers: [{ namespace: "supplystrata.company_id", value: companyId, authority: "SupplyStrata local cache" }],
            provenance: {
              producer: { name: "SupplyStrata", version: "0.1.0", homepage: "https://github.com/BCAutumn/supplystrata" },
              generated_at: input.now,
              method: "mcp-read-surface.test"
            }
          }
        ]
      };
    }
  };
}

function fakeReadData(input: ApiOperationHandlerInput, calls: ApiOperationId[]): Record<string, unknown> {
  calls.push(input.route.operation_id);
  return {
    operation_id: input.route.operation_id,
    path_params: input.path_params,
    query: queryParamsRecord(input.query),
    observed_at: input.now
  };
}

function queryParamsRecord(query: URLSearchParams): Record<string, string> {
  const output: Record<string, string> = {};
  query.forEach((value, key) => {
    output[key] = value;
  });
  return output;
}
