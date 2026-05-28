#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createSupplyStrataMcpServer } from "../apps/mcp/src/index.ts";

const FIXED_NOW = "2026-05-28T00:00:00.000Z";

const { server } = createSupplyStrataMcpServer({
  handlers: {
    getCompanyCard: async (input) =>
      fakeReadData(input, {
        entity: {
          entity_id: "ENT-NVIDIA",
          legal_name: "NVIDIA Corporation",
          aliases: ["NVIDIA", "NVDA"]
        }
      }),
    listSourceHealth: async (input) =>
      fakeReadData(input, {
        source_targets: [
          {
            check_target_id: "target-sec-edgar-nvidia",
            source_adapter_id: "sec-edgar",
            status: "synced"
          }
        ]
      }),
    getResearchRunStatus: async (input) =>
      fakeReadData(input, {
        run_id: input.path_params.id,
        status: "queued",
        source_check_target_ids: ["target-sec-edgar-nvidia"]
      }),
    getChain: async (input) =>
      fakeReadData(input, {
        scope: input.path_params.scope,
        nodes: [{ id: "ENT-NVIDIA" }, { id: "ENT-TSMC" }],
        edges: [{ edge_id: "EDGE-NVIDIA-TSMC", source: "ENT-NVIDIA", target: "ENT-TSMC", relation: "USES_FOUNDRY" }]
      })
  },
  now: () => FIXED_NOW,
  writeExecutors: {
    run_source_check: async (request, context) => ({
      pending_id: context.pending_id,
      checked_targets: request.check_target_ids?.length ?? 0,
      failed_targets: 0
    })
  }
});

await server.connect(new StdioServerTransport());

function fakeReadData(input, data) {
  return {
    operation_id: input.route.operation_id,
    path_params: input.path_params,
    query: queryParamsRecord(input.query),
    observed_at: input.now,
    ...data
  };
}

function queryParamsRecord(query) {
  const output = {};
  query.forEach((value, key) => {
    output[key] = value;
  });
  return output;
}
