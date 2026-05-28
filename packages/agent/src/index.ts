export const SUPPLYSTRATA_REFERENCE_AGENT_BOUNDARY = {
  package_name: "@supplystrata/agent",
  core_dependency_allowed: false,
  mcp_client_only: true,
  fact_write_allowed: false
} as const;

export type SupplyStrataReferenceAgentBoundary = typeof SUPPLYSTRATA_REFERENCE_AGENT_BOUNDARY;
