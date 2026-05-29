import { summarize_with_citations, type LlmHelperOptions } from "@supplystrata/llm-helpers";

export const SUPPLYSTRATA_REFERENCE_AGENT_BOUNDARY = {
  package_name: "@supplystrata/agent",
  core_dependency_allowed: false,
  mcp_client_only: true,
  fact_write_allowed: false
} as const;

export type SupplyStrataReferenceAgentBoundary = typeof SUPPLYSTRATA_REFERENCE_AGENT_BOUNDARY;

export interface SupplyStrataMcpClient {
  callTool(name: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface AgentPlanInput {
  readonly company: string;
  readonly depth?: number;
}

export interface AgentPlan {
  readonly company: string;
  readonly depth: number;
  readonly stages: readonly ["resolve_company", "start_research_session", "confirm_research_session", "poll_research_run", "traverse_chain"];
  readonly client: SupplyStrataMcpClient;
}

export interface AgentEvidenceRef {
  readonly evidence_id: string;
  readonly cite_text: string;
  readonly source_tool: string;
}

export interface AgentFetchResult {
  readonly company: string;
  readonly resolved_company_id: string | null;
  readonly research_run_id: string | null;
  readonly status: "completed" | "cannot_conclude";
  readonly evidence: AgentEvidenceRef[];
  readonly source_gaps: string[];
}

export interface AgentReport {
  readonly status: "completed" | "cannot_conclude";
  readonly markdown: string;
  readonly cited_evidence_ids: string[];
  readonly source_gaps: string[];
}

export function plan(input: AgentPlanInput, client: SupplyStrataMcpClient): AgentPlan {
  return {
    company: input.company,
    depth: input.depth ?? 2,
    stages: ["resolve_company", "start_research_session", "confirm_research_session", "poll_research_run", "traverse_chain"],
    client
  };
}

export async function fetch_via_mcp(agentPlan: AgentPlan): Promise<AgentFetchResult> {
  const resolved = await agentPlan.client.callTool("resolve_company", { query: agentPlan.company });
  const resolvedData = readRecordPath(resolved, ["data"]);
  const companyId = readOptionalStringPath(resolvedData, ["entity_id"]) ?? readOptionalStringPath(resolvedData, ["entity", "entity_id"]);
  const pending = await agentPlan.client.callTool("start_research_session", { company: agentPlan.company, depth: agentPlan.depth });
  const confirmation = await agentPlan.client.callTool("confirm_research_session", {
    pending_id: readStringPath(pending, ["pending_id"]),
    confirmation_token: readStringPath(pending, ["confirmation_token"])
  });
  const confirmationData = readRecordPath(confirmation, ["data"]);
  const createdRun = readOptionalRecordPath(confirmationData, ["data", "run"]) ?? confirmationData;
  const runId = readStringPath(createdRun, ["run_id"]);
  const polled = await agentPlan.client.callTool("poll_research_run", { run_id: runId });
  const polledData = readRecordPath(polled, ["data"]);
  const run = readOptionalRecordPath(polledData, ["run"]) ?? polledData;
  const runStatus = readStringPath(run, ["status"]);
  const effectiveCompanyId = readOptionalNullableStringPath(run, ["company_entity_id"]) ?? companyId;
  if (effectiveCompanyId === null) {
    return cannotConcludeFetch(agentPlan.company, runId, ["Company identity could not be resolved by MCP."]);
  }
  const chain = await agentPlan.client.callTool("traverse_chain", { scope: `company:${effectiveCompanyId}`, depth: agentPlan.depth });
  const evidence = evidenceRefsFromTraverseResult(chain);
  return {
    company: agentPlan.company,
    resolved_company_id: effectiveCompanyId,
    research_run_id: runId,
    status: evidence.length === 0 || runStatus === "cannot_conclude" ? "cannot_conclude" : "completed",
    evidence,
    source_gaps: evidence.length === 0 ? ["No citation-backed supply-chain evidence was returned by MCP."] : []
  };
}

export async function synthesize(fetchResult: AgentFetchResult, options: LlmHelperOptions = {}): Promise<AgentReport> {
  if (fetchResult.evidence.length === 0) {
    return {
      status: "cannot_conclude",
      markdown: cannotConcludeMarkdown(fetchResult, "No citation-backed evidence was available for synthesis."),
      cited_evidence_ids: [],
      source_gaps: fetchResult.source_gaps
    };
  }
  const candidate = await summarize_with_citations(
    {
      question: `Summarize citation-backed supply-chain evidence for ${fetchResult.company}.`,
      evidence: fetchResult.evidence.map((item) => ({ evidence_id: item.evidence_id, cite_text: item.cite_text }))
    },
    options
  );
  const citedEvidenceIds = candidate.status === "candidate" ? candidate.cited_evidence_ids : [];
  if (citedEvidenceIds.length === 0) {
    return {
      status: "cannot_conclude",
      markdown: cannotConcludeMarkdown(fetchResult, "The LLM helper did not return citation-backed synthesis."),
      cited_evidence_ids: [],
      source_gaps: [...fetchResult.source_gaps, `summarize_with_citations returned ${candidate.status}`]
    };
  }
  return {
    status: "completed",
    markdown: [`# SupplyStrata Agent Report: ${fetchResult.company}`, "", candidate.summary, "", citationList(fetchResult.evidence, citedEvidenceIds)].join(
      "\n"
    ),
    cited_evidence_ids: citedEvidenceIds,
    source_gaps: fetchResult.source_gaps
  };
}

export async function runReferenceAgent(input: AgentPlanInput, client: SupplyStrataMcpClient, options: LlmHelperOptions = {}): Promise<AgentReport> {
  const agentPlan = plan(input, client);
  return synthesize(await fetch_via_mcp(agentPlan), options);
}

function cannotConcludeFetch(company: string, runId: string | null, sourceGaps: readonly string[]): AgentFetchResult {
  return {
    company,
    resolved_company_id: null,
    research_run_id: runId,
    status: "cannot_conclude",
    evidence: [],
    source_gaps: [...sourceGaps]
  };
}

function cannotConcludeMarkdown(fetchResult: AgentFetchResult, reason: string): string {
  return [
    `# SupplyStrata Agent Report: ${fetchResult.company}`,
    "",
    "## cannot_conclude",
    "",
    reason,
    "",
    "## Source gaps",
    "",
    ...fetchResult.source_gaps.map((gap) => `- ${gap}`)
  ].join("\n");
}

function citationList(evidence: readonly AgentEvidenceRef[], citedEvidenceIds: readonly string[]): string {
  const evidenceById = new Map(evidence.map((item) => [item.evidence_id, item]));
  return [
    "## Citations",
    "",
    ...citedEvidenceIds.flatMap((evidenceId) => {
      const item = evidenceById.get(evidenceId);
      return item === undefined ? [] : [`- ${item.evidence_id}: ${item.cite_text}`];
    })
  ].join("\n");
}

function evidenceRefsFromTraverseResult(result: Record<string, unknown>): AgentEvidenceRef[] {
  const data = readRecordPath(result, ["data"]);
  const segments = readOptionalArrayPath(data, ["segments"]) ?? readOptionalArrayPath(data, ["edges"]) ?? [];
  return segments.flatMap((segment, index) => {
    if (!isRecord(segment)) return [];
    const evidenceIds = readOptionalStringArray(segment, "evidence_ids");
    if (evidenceIds.length === 0) return [];
    const label = optionalString(segment["label"]) ?? `MCP chain segment ${index + 1}`;
    return evidenceIds.map((evidenceId) => ({
      evidence_id: evidenceId,
      cite_text: label,
      source_tool: "traverse_chain"
    }));
  });
}

function readRecordPath(root: Record<string, unknown>, path: readonly string[]): Record<string, unknown> {
  const value = readPath(root, path);
  if (!isRecord(value)) throw new Error(`Expected ${path.join(".")} to be an object.`);
  return value;
}

function readStringPath(root: Record<string, unknown>, path: readonly string[]): string {
  const value = readPath(root, path);
  if (typeof value !== "string" || value.length === 0) throw new Error(`Expected ${path.join(".")} to be a non-empty string.`);
  return value;
}

function readPath(root: Record<string, unknown>, path: readonly string[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (!isRecord(current) || !(segment in current)) throw new Error(`Missing ${path.join(".")}.`);
    current = current[segment];
  }
  return current;
}

function readOptionalRecordPath(root: Record<string, unknown>, path: readonly string[]): Record<string, unknown> | null {
  const value = readOptionalPath(root, path);
  if (value === null) return null;
  if (!isRecord(value)) throw new Error(`Expected ${path.join(".")} to be an object.`);
  return value;
}

function readOptionalArrayPath(root: Record<string, unknown>, path: readonly string[]): unknown[] | null {
  const value = readOptionalPath(root, path);
  if (value === null) return null;
  if (!Array.isArray(value)) throw new Error(`Expected ${path.join(".")} to be an array.`);
  return value;
}

function readOptionalStringPath(root: Record<string, unknown>, path: readonly string[]): string | null {
  const value = readOptionalPath(root, path);
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`Expected ${path.join(".")} to be a string.`);
  return value.length === 0 ? null : value;
}

function readOptionalNullableStringPath(root: Record<string, unknown>, path: readonly string[]): string | null {
  const value = readOptionalPath(root, path);
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`Expected ${path.join(".")} to be string|null.`);
  return value.length === 0 ? null : value;
}

function readOptionalPath(root: Record<string, unknown>, path: readonly string[]): unknown | null {
  let current: unknown = root;
  for (const segment of path) {
    if (!isRecord(current) || !(segment in current)) return null;
    current = current[segment];
  }
  return current;
}

function readOptionalStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
