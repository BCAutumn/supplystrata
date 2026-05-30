import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpReadSurfaceRuntime } from "../definitions/read-surface.js";
import { callMcpApiReadOperation, type McpApiReadOperationRequest } from "../functions/api-operation-read.js";
import { apiEnvelopeStructuredContent, apiEnvelopeText, MCP_API_ENVELOPE_OUTPUT_SCHEMA } from "../functions/mcp-content.js";

const stringInput = (description: string) => z.string().trim().min(1).describe(description);
const positiveIntegerInput = (description: string) => z.number().int().min(1).describe(description);

export function registerReadTools(server: McpServer, runtime: McpReadSurfaceRuntime): void {
  server.registerTool(
    "resolve_company",
    {
      title: "Resolve Company",
      description:
        "Resolves a company query against the local cache. Returns the evidence-backed company card when the identity is already known, or an explicit unresolved status (not 'company does not exist') that points to start_research_session for global identity bootstrap.",
      inputSchema: {
        query: stringInput("Company query, ticker, alias, or entity id.")
      },
      outputSchema: MCP_API_ENVELOPE_OUTPUT_SCHEMA,
      annotations: readOnlyAnnotations()
    },
    async ({ query }) =>
      readToolResult(runtime, {
        operation_id: "resolveCompanyIdentity",
        path_params: { id: query },
        now: runtime.now()
      })
  );

  server.registerTool(
    "read_evidence_for_edge",
    {
      title: "Read Evidence For Edge",
      description: "Returns the evidence DTO used to audit an edge or evidence reference.",
      inputSchema: {
        edge_id: stringInput("Evidence or edge evidence id.")
      },
      outputSchema: MCP_API_ENVELOPE_OUTPUT_SCHEMA,
      annotations: readOnlyAnnotations()
    },
    async ({ edge_id }) =>
      readToolResult(runtime, {
        operation_id: "getEvidence",
        path_params: { id: edge_id },
        now: runtime.now()
      })
  );

  server.registerTool(
    "traverse_chain",
    {
      title: "Traverse Chain",
      description: "Returns a chain view for a company, component, or chain scope.",
      inputSchema: {
        scope: stringInput("Company, component, or chain scope."),
        depth: positiveIntegerInput("Maximum traversal depth.").optional()
      },
      outputSchema: MCP_API_ENVELOPE_OUTPUT_SCHEMA,
      annotations: readOnlyAnnotations()
    },
    async ({ scope, depth }) =>
      readToolResult(runtime, {
        operation_id: "getChain",
        path_params: { scope },
        query: optionalDepthQuery(depth),
        now: runtime.now()
      })
  );

  server.registerTool(
    "list_unknowns",
    {
      title: "List Unknowns",
      description: "Returns explicit unknowns for a research scope.",
      inputSchema: {
        scope: stringInput("Company, component, edge, claim, or policy scope.")
      },
      outputSchema: MCP_API_ENVELOPE_OUTPUT_SCHEMA,
      annotations: readOnlyAnnotations()
    },
    async ({ scope }) =>
      readToolResult(runtime, {
        operation_id: "listUnknowns",
        path_params: { scope },
        now: runtime.now()
      })
  );

  server.registerTool(
    "list_source_targets",
    {
      title: "List Source Targets",
      description: "Returns source health DTOs that currently back source target discovery.",
      inputSchema: {
        scope: stringInput("Optional research scope for future source-target filtering.").optional()
      },
      outputSchema: MCP_API_ENVELOPE_OUTPUT_SCHEMA,
      annotations: readOnlyAnnotations()
    },
    async () =>
      readToolResult(runtime, {
        operation_id: "listSourceHealth",
        path_params: {},
        now: runtime.now()
      })
  );

  server.registerTool(
    "poll_research_run",
    {
      title: "Poll Research Run",
      description: "Returns durable status for a research run.",
      inputSchema: {
        run_id: stringInput("Research run id.")
      },
      outputSchema: MCP_API_ENVELOPE_OUTPUT_SCHEMA,
      annotations: readOnlyAnnotations()
    },
    async ({ run_id }) =>
      readToolResult(runtime, {
        operation_id: "getResearchRunStatus",
        path_params: { id: run_id },
        now: runtime.now()
      })
  );
}

async function readToolResult(runtime: McpReadSurfaceRuntime, input: McpApiReadOperationRequest) {
  const envelope = await callMcpApiReadOperation({ ...input, handlers: runtime.handlers });
  return {
    content: [
      {
        type: "text" as const,
        text: apiEnvelopeText(envelope)
      }
    ],
    structuredContent: apiEnvelopeStructuredContent(envelope)
  };
}

function optionalDepthQuery(depth: number | undefined): URLSearchParams {
  const query = new URLSearchParams();
  if (depth !== undefined) query.set("depth", String(depth));
  return query;
}

function readOnlyAnnotations() {
  return {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  };
}
