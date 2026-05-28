import type { ApiOperationHandlerInput, ApiOperationHandlers } from "@supplystrata/api-orchestration";

import type { McpWriteExecutors } from "../../write-surface/definitions/write-surface.js";

export const MCP_FIXTURE_NOW = "2026-05-28T00:00:00.000Z";

export function createFixtureApiOperationHandlers(): ApiOperationHandlers {
  return {
    getCompanyCard: async (input) =>
      fixtureReadData(input, {
        entity: {
          entity_id: "ENT-NVIDIA",
          legal_name: "NVIDIA Corporation",
          aliases: ["NVIDIA", "NVDA"]
        }
      }),
    listSourceHealth: async (input) =>
      fixtureReadData(input, {
        source_targets: [
          {
            check_target_id: "target-sec-edgar-nvidia",
            source_adapter_id: "sec-edgar",
            status: "synced"
          }
        ]
      }),
    getResearchRunStatus: async (input) =>
      fixtureReadData(input, {
        run_id: input.path_params["id"],
        status: "queued",
        source_check_target_ids: ["target-sec-edgar-nvidia"]
      }),
    getChain: async (input) =>
      fixtureReadData(input, {
        scope: input.path_params["scope"],
        nodes: [{ id: "ENT-NVIDIA" }, { id: "ENT-TSMC" }],
        edges: [{ edge_id: "EDGE-NVIDIA-TSMC", source: "ENT-NVIDIA", target: "ENT-TSMC", relation: "USES_FOUNDRY" }]
      })
  };
}

export function createFixtureWriteExecutors(): Partial<McpWriteExecutors> {
  return {
    start_research_session: async (request, context) => ({
      pending_id: context.pending_id,
      run_id: "RUN-NVIDIA-SMOKE",
      company: request.company,
      status: "queued_source_checks",
      source_check_target_ids: ["target-sec-edgar-nvidia"]
    }),
    run_source_check: async (request, context) => ({
      pending_id: context.pending_id,
      checked_targets: request.check_target_ids?.length ?? 0,
      failed_targets: 0
    }),
    "review.approve": async (request, context) => ({
      pending_id: context.pending_id,
      review_id: request.review_id,
      decision: "approved"
    }),
    "review.reject": async (request, context) => ({
      pending_id: context.pending_id,
      review_id: request.review_id,
      decision: "rejected"
    })
  };
}

function fixtureReadData(input: ApiOperationHandlerInput, data: Record<string, unknown>): Record<string, unknown> {
  return {
    operation_id: input.route.operation_id,
    path_params: input.path_params,
    query: queryParamsRecord(input.query),
    observed_at: input.now,
    ...data
  };
}

function queryParamsRecord(query: URLSearchParams): Record<string, string> {
  const output: Record<string, string> = {};
  query.forEach((value, key) => {
    output[key] = value;
  });
  return output;
}
