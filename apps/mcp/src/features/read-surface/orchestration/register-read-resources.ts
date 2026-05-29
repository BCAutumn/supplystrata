import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { MCP_READ_RESOURCE_URIS, type McpReadSurfaceRuntime } from "../definitions/read-surface.js";
import { callMcpApiReadOperation, type McpApiReadOperationRequest } from "../functions/api-operation-read.js";
import { apiEnvelopeText } from "../functions/mcp-content.js";

export function registerReadResources(server: McpServer, runtime: McpReadSurfaceRuntime): void {
  server.registerResource(
    "entity",
    new ResourceTemplate(MCP_READ_RESOURCE_URIS.entity, { list: undefined }),
    {
      title: "Entity",
      description: "Evidence-backed company card for a company entity id.",
      mimeType: "application/json"
    },
    async (uri, variables) =>
      readResourceResult(uri.href, runtime, {
        operation_id: "getCompanyCard",
        path_params: { id: requiredVariable(variables, "id") },
        now: runtime.now()
      })
  );

  server.registerResource(
    "evidence-edge",
    new ResourceTemplate(MCP_READ_RESOURCE_URIS.evidenceEdge, { list: undefined }),
    {
      title: "Evidence Edge",
      description: "Evidence DTO for auditing an edge or evidence reference.",
      mimeType: "application/json"
    },
    async (uri, variables) =>
      readResourceResult(uri.href, runtime, {
        operation_id: "getEvidence",
        path_params: { id: requiredVariable(variables, "id") },
        now: runtime.now()
      })
  );

  server.registerResource(
    "unknowns-company",
    new ResourceTemplate(MCP_READ_RESOURCE_URIS.unknownsCompany, { list: undefined }),
    {
      title: "Company Unknowns",
      description: "Explicit unknowns for a company scope.",
      mimeType: "application/json"
    },
    async (uri, variables) =>
      readResourceResult(uri.href, runtime, {
        operation_id: "listUnknowns",
        path_params: { scope: `company:${requiredVariable(variables, "id")}` },
        now: runtime.now()
      })
  );

  server.registerResource(
    "changes-entity",
    new ResourceTemplate(MCP_READ_RESOURCE_URIS.changesEntity, { list: undefined }),
    {
      title: "Entity Changes",
      description: "Current change timeline DTO. Entity-scoped filtering is not yet part of the API contract.",
      mimeType: "application/json"
    },
    async (uri) =>
      readResourceResult(uri.href, runtime, {
        operation_id: "listChanges",
        path_params: {},
        now: runtime.now()
      })
  );

  server.registerResource(
    "source-health",
    MCP_READ_RESOURCE_URIS.sourceHealth,
    {
      title: "Source Health",
      description: "Configured source health and monitor state.",
      mimeType: "application/json"
    },
    async (uri) =>
      readResourceResult(uri.href, runtime, {
        operation_id: "listSourceHealth",
        path_params: {},
        now: runtime.now()
      })
  );

  server.registerResource(
    "reasoning-walkthrough",
    new ResourceTemplate(MCP_READ_RESOURCE_URIS.reasoningWalkthrough, { list: undefined }),
    {
      title: "Reasoning Walkthrough",
      description: "Deterministic, read-only reasoning walkthrough for a company scope.",
      mimeType: "application/json"
    },
    async (uri, variables) =>
      readResourceResult(uri.href, runtime, {
        operation_id: "getCompanyReasoningWalkthrough",
        path_params: { id: requiredVariable(variables, "id") },
        now: runtime.now()
      })
  );

  server.registerResource(
    "scbom-company",
    new ResourceTemplate(MCP_READ_RESOURCE_URIS.scbomCompany, { list: undefined }),
    {
      title: "SCBOM Company",
      description: "Vendor-neutral SCBOM v0.0.1 document for a company LEI or resolver-backed company query.",
      mimeType: "application/json"
    },
    async (uri, variables) =>
      readRawResourceResult(uri.href, runtime, {
        operation_id: "getCompanyScbomDocument",
        path_params: { id: requiredVariable(variables, "lei") },
        now: runtime.now()
      })
  );
}

async function readResourceResult(uri: string, runtime: McpReadSurfaceRuntime, input: McpApiReadOperationRequest) {
  const envelope = await callMcpApiReadOperation({ ...input, handlers: runtime.handlers });
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: apiEnvelopeText(envelope)
      }
    ]
  };
}

async function readRawResourceResult(uri: string, runtime: McpReadSurfaceRuntime, input: McpApiReadOperationRequest) {
  const envelope = await callMcpApiReadOperation({ ...input, handlers: runtime.handlers });
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(envelope.data, null, 2)
      }
    ]
  };
}

function requiredVariable(variables: Record<string, string | string[]>, name: string): string {
  const value = variables[name];
  if (typeof value === "string" && value.trim().length > 0) return value;
  throw new Error(`Missing MCP resource variable: ${name}`);
}
