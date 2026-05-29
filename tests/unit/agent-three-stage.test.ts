import { describe, expect, it } from "vitest";
import { fetch_via_mcp, plan, runReferenceAgent, synthesize, type SupplyStrataMcpClient } from "@supplystrata/agent";
import type { LlmProvider, LlmProviderJsonRequest, LlmProviderJsonResponse } from "@supplystrata/llm-helpers";

class MockMcpClient implements SupplyStrataMcpClient {
  readonly calls: { name: string; input: Record<string, unknown> }[] = [];

  async callTool(name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.calls.push({ name, input });
    switch (name) {
      case "resolve_company":
        return { data: { entity_id: "ENT-LVMH" } };
      case "start_research_session":
        return { status: "requires_confirmation", pending_id: "PENDING-1", confirmation_token: "TOKEN-1" };
      case "confirm_research_session":
        return { data: { data: { run: { run_id: "RR-1" } } } };
      case "poll_research_run":
        return { data: { run: { run_id: "RR-1", status: "succeeded", company_entity_id: "ENT-LVMH" } } };
      case "traverse_chain":
        return { data: { segments: [{ label: "LVMH buys packaging from Supplier A", evidence_ids: ["EV-1"] }] } };
      default:
        throw new Error(`Unexpected MCP tool: ${name}`);
    }
  }
}

class SummaryProvider implements LlmProvider {
  readonly calls: LlmProviderJsonRequest[] = [];

  async completeJson(request: LlmProviderJsonRequest): Promise<LlmProviderJsonResponse> {
    this.calls.push(request);
    return {
      provider_request_id: "summary-1",
      model: "fixture-summary",
      output: {
        confidence: 0.8,
        rationale: "Uses only supplied evidence.",
        citations: [{ source_ref: "EV-1" }],
        summary: "LVMH has one citation-backed upstream packaging relationship.",
        cited_evidence_ids: ["EV-1"]
      }
    };
  }
}

describe("reference agent three-stage core", () => {
  it("plans and fetches only through the supplied MCP client", async () => {
    const client = new MockMcpClient();
    const agentPlan = plan({ company: "LVMH", depth: 2 }, client);
    const result = await fetch_via_mcp(agentPlan);

    expect(agentPlan.stages).toEqual(["resolve_company", "start_research_session", "confirm_research_session", "poll_research_run", "traverse_chain"]);
    expect(client.calls.map((call) => call.name)).toEqual([
      "resolve_company",
      "start_research_session",
      "confirm_research_session",
      "poll_research_run",
      "traverse_chain"
    ]);
    expect(result).toMatchObject({
      company: "LVMH",
      resolved_company_id: "ENT-LVMH",
      research_run_id: "RR-1",
      status: "completed",
      evidence: [{ evidence_id: "EV-1", source_tool: "traverse_chain" }]
    });
  });

  it("synthesizes a report only when citations come back from llm-helper", async () => {
    const provider = new SummaryProvider();
    const report = await synthesize(
      {
        company: "LVMH",
        resolved_company_id: "ENT-LVMH",
        research_run_id: "RR-1",
        status: "completed",
        evidence: [{ evidence_id: "EV-1", cite_text: "LVMH buys packaging from Supplier A", source_tool: "traverse_chain" }],
        source_gaps: []
      },
      { provider, generated_at: "2026-05-29T00:00:00.000Z" }
    );

    expect(provider.calls.map((call) => call.helper)).toEqual(["summarize_with_citations"]);
    expect(report.status).toBe("completed");
    expect(report.cited_evidence_ids).toEqual(["EV-1"]);
    expect(report.markdown).toContain("EV-1: LVMH buys packaging from Supplier A");
  });

  it("returns cannot_conclude instead of inventing citations when evidence is missing", async () => {
    const report = await synthesize({
      company: "AstraZeneca",
      resolved_company_id: "ENT-ASTRAZENECA",
      research_run_id: "RR-2",
      status: "cannot_conclude",
      evidence: [],
      source_gaps: ["No citation-backed supply-chain evidence was returned by MCP."]
    });

    expect(report.status).toBe("cannot_conclude");
    expect(report.cited_evidence_ids).toEqual([]);
    expect(report.markdown).toContain("## cannot_conclude");
  });

  it("runs the three stages end to end with mock MCP and mock provider", async () => {
    const report = await runReferenceAgent({ company: "LVMH" }, new MockMcpClient(), {
      provider: new SummaryProvider(),
      generated_at: "2026-05-29T00:00:00.000Z"
    });

    expect(report.status).toBe("completed");
    expect(report.cited_evidence_ids).toEqual(["EV-1"]);
  });
});
