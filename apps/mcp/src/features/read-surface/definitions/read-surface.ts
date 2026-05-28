import type { ApiOperationHandlers } from "@supplystrata/api-orchestration";

export type McpReadToolName = "resolve_company" | "read_evidence_for_edge" | "traverse_chain" | "list_unknowns" | "list_source_targets" | "poll_research_run";

export type McpReadResourceName = "entity" | "evidence-edge" | "unknowns-company" | "changes-entity" | "source-health" | "reasoning-walkthrough";

export const MCP_READ_TOOL_NAMES: readonly McpReadToolName[] = [
  "resolve_company",
  "read_evidence_for_edge",
  "traverse_chain",
  "list_unknowns",
  "list_source_targets",
  "poll_research_run"
];

export const MCP_READ_RESOURCE_URIS = {
  entity: "supplystrata://entity/{id}",
  evidenceEdge: "supplystrata://evidence/edge/{id}",
  unknownsCompany: "supplystrata://unknowns/company/{id}",
  changesEntity: "supplystrata://changes/entity/{id}",
  sourceHealth: "supplystrata://source-health",
  reasoningWalkthrough: "supplystrata://reasoning-walkthrough/{id}"
} as const;

export interface McpReadSurfaceRuntime {
  readonly handlers: ApiOperationHandlers;
  readonly now: () => string;
}
