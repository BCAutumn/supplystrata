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
    getEvidence: async (input) =>
      fixtureReadData(input, {
        evidence_id: input.path_params["id"],
        edge_id: "EDGE-NVIDIA-TSMC",
        citation: {
          source_id: "sec-edgar",
          url: "https://www.sec.gov/Archives/edgar/data/1045810/example.htm"
        }
      }),
    listUnknowns: async (input) =>
      fixtureReadData(input, {
        scope: input.path_params["scope"],
        unknowns: [
          {
            unknown_id: "UNK-NVIDIA-SUPPLIER-DEPTH",
            status: "open",
            reason: "Fixture keeps unresolved supplier depth explicit."
          }
        ]
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
    listChanges: async (input) =>
      fixtureReadData(input, {
        changes: [
          {
            change_id: "CHANGE-NVIDIA-FIXTURE",
            changed_at: input.now,
            summary: "Fixture audit event for MCP resource smoke."
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
      }),
    getCompanyReasoningWalkthrough: async (input) =>
      fixtureReadData(input, {
        company_id: input.path_params["id"],
        steps: [
          {
            step_id: "fixture-step-1",
            conclusion: "Fixture reasoning walkthrough is deterministic and read-only."
          }
        ]
      }),
    getCompanyScbomDocument: async (input) => fixtureScbomDocument(input.now, input.path_params["id"] ?? "ENT-NVIDIA")
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

function fixtureScbomDocument(now: string, companyId: string): Record<string, unknown> {
  return {
    schema_version: "0.0.1",
    document_id: `document:${companyId}:${now}`,
    generated_at: now,
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
          generated_at: now,
          method: "fixture-mcp-runtime.scbom"
        }
      }
    ]
  };
}
