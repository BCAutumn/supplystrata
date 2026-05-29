import { describe, expect, it } from "vitest";
import { runReferenceAgent, type SupplyStrataMcpClient } from "@supplystrata/agent";
import type { LlmProvider, LlmProviderJsonRequest, LlmProviderJsonResponse } from "@supplystrata/llm-helpers";

class GlobalCompanyMcpClient implements SupplyStrataMcpClient {
  readonly calls: { name: string; input: Record<string, unknown> }[] = [];

  async callTool(name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.calls.push({ name, input });
    switch (name) {
      case "resolve_company":
        return { data: { entity: { entity_id: "ENT-SAMSUNG", legal_name: "Samsung Electronics Co., Ltd." } } };
      case "start_research_session":
        return { status: "requires_confirmation", pending_id: "PENDING-SAMSUNG-1", confirmation_token: "TOKEN-SAMSUNG-1" };
      case "confirm_research_session":
        return { data: { data: { run: { run_id: "RR-SAMSUNG-1" } } } };
      case "poll_research_run":
        return { data: { run: { run_id: "RR-SAMSUNG-1", status: "succeeded", company_entity_id: "ENT-SAMSUNG" } } };
      case "traverse_chain":
        return {
          data: {
            segments: [
              { label: "Samsung Electronics names TSMC as a foundry-related counterparty in supplied evidence.", evidence_ids: ["EV-SAMSUNG-TSMC"] },
              { label: "Samsung Electronics has wafer-material upstream evidence in supplied evidence.", evidence_ids: ["EV-SAMSUNG-WAFER"] }
            ]
          }
        };
      default:
        throw new Error(`Unexpected MCP tool: ${name}`);
    }
  }
}

class CitationPreservingProvider implements LlmProvider {
  readonly requests: LlmProviderJsonRequest[] = [];

  async completeJson(request: LlmProviderJsonRequest): Promise<LlmProviderJsonResponse> {
    this.requests.push(request);
    const evidenceIds = evidenceIdsFromRequest(request);
    return {
      provider_request_id: "agent-e2e-summary-1",
      model: "mock-citation-preserving",
      output: {
        confidence: 0.82,
        rationale: "The summary cites only evidence ids supplied by the MCP fetch stage.",
        citations: evidenceIds.map((evidenceId) => ({ source_ref: evidenceId })),
        summary: `Samsung Electronics report is limited to ${evidenceIds.length} citation-backed supply-chain observations.`,
        cited_evidence_ids: evidenceIds
      }
    };
  }
}

describe("reference agent report e2e", () => {
  it("runs a global-company report with citation-backed output and no core imports", async () => {
    const mcp = new GlobalCompanyMcpClient();
    const provider = new CitationPreservingProvider();
    const report = await runReferenceAgent({ company: "Samsung Electronics", depth: 2 }, mcp, {
      provider,
      generated_at: "2026-05-29T00:00:00.000Z"
    });

    expect(mcp.calls.map((call) => call.name)).toEqual([
      "resolve_company",
      "start_research_session",
      "confirm_research_session",
      "poll_research_run",
      "traverse_chain"
    ]);
    expect(provider.requests.map((request) => request.helper)).toEqual(["summarize_with_citations"]);
    expect(report.status).toBe("completed");
    expect(report.source_gaps).toEqual([]);
    expect(report.cited_evidence_ids).toEqual(["EV-SAMSUNG-TSMC", "EV-SAMSUNG-WAFER"]);
    for (const evidenceId of report.cited_evidence_ids) {
      expect(report.markdown).toContain(evidenceId);
    }
  });
});

function evidenceIdsFromRequest(request: LlmProviderJsonRequest): string[] {
  const evidence = request.input["evidence"];
  if (!Array.isArray(evidence)) throw new Error("Expected summarize_with_citations evidence array.");
  return evidence.flatMap((item) => {
    if (!isRecord(item)) return [];
    const evidenceId = item["evidence_id"];
    return typeof evidenceId === "string" && evidenceId.length > 0 ? [evidenceId] : [];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
