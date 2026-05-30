import {
  buildCompanyAiAnalysisPlan,
  listAiAnalysisRuns,
  type AiAnalysisNodeId,
  type AiAnalysisRunStatus,
  type AiAnalysisScopeKind
} from "@supplystrata/ai-analysis";
import { loadChainCard, loadCompanyCard, loadComponentCard, loadEvidenceCard, loadUnknownMap } from "@supplystrata/card-builder";
import type { Env } from "@supplystrata/config";
import { getClaim, isEntityResolutionError, listChangeTimeline, type ChangeTimelineScope } from "@supplystrata/db/read";
import type { DatabaseStore, DbClient } from "@supplystrata/db/write";
import { buildAiProviderStatus } from "@supplystrata/llm-helpers";
import { applyApprovedReviewCandidate, createDocumentFactPromoter, persistDocumentObservations, type ReviewApplyResult } from "@supplystrata/pipeline";
import { buildResearchPack, type ConsumerReadModel, type ReasoningWalkthrough } from "@supplystrata/research-pack";
import { decideReviewCandidateTransactionally } from "@supplystrata/review-store";
import { listSourceCheckRunStatus, listSourceHealthRows, type SourceCheckJobStatus, type SourceHealthRow } from "@supplystrata/source-monitor";
import {
  createResearchRun,
  ensureCompanyResearchRun,
  getResearchRunStatus,
  isResearchRunNotFoundError,
  runDueSourceChecks,
  type ResearchRunRefreshMode
} from "@supplystrata/source-workflows";
import type { ComponentObservation, CompanyObservation } from "@supplystrata/render";
import { buildWorkbenchModel, changeTimelineItemToDto, claimToDto, toScbomDocument, type WorkbenchSourceHealth } from "@supplystrata/workbench-export";
import type { AiAnalysisArtifact } from "@supplystrata/ai-analysis";
import type { CompanyIdentityResolution, CompanySupplyChainReport, ResearchRunRequest, ReviewDecisionResult } from "../api-contract/definitions/api-dtos.js";
import { ApiHttpError, type ApiOperationHandlerInput, type ApiOperationHandlers } from "../definitions/api-operation.js";
import { buildCompanySupplyChainResearchSummary } from "../functions/company-supply-chain-report-summary.js";
import { loadLatestAiAnalysisArtifactFile } from "./ai-analysis-artifact-files.js";

const SOURCE_CHECK_JOB_STATUSES: readonly SourceCheckJobStatus[] = ["pending", "in_progress", "failed", "succeeded", "dead"];
const AI_ANALYSIS_RUN_STATUSES: readonly AiAnalysisRunStatus[] = [
  "queued",
  "in_progress",
  "succeeded",
  "failed",
  "blocked_missing_configuration",
  "cannot_conclude"
];
const AI_ANALYSIS_NODE_IDS: readonly AiAnalysisNodeId[] = ["company_context_explanation_v0", "reasoning_walkthrough_explanation_v0"];
const AI_ANALYSIS_SCOPE_KINDS: readonly AiAnalysisScopeKind[] = ["company", "component", "edge", "claim", "policy"];

export function createDbApiOperationHandlers(store: DatabaseStore, env?: Env): ApiOperationHandlers {
  return {
    getCompanyCard: async (input) => loadCompanyCard(store.read, pathParam(input, "id"), { computedAt: input.now }),
    resolveCompanyIdentity: async (input) => resolveCompanyIdentityForHttp(store, input),
    getComponentCard: async (input) => loadComponentCard(store.read, pathParam(input, "id"), { computedAt: input.now }),
    getChain: async (input) => loadChainCard(store.read, pathParam(input, "scope"), { depth: positiveIntQuery(input.query, "depth", 3) }),
    getClaim: async (input) => loadClaimForHttp(store.read, pathParam(input, "id")),
    getEvidence: async (input) => loadEvidenceCard(store.read, pathParam(input, "id")),
    listObservations: async (input) =>
      listObservationsForApiScope(store.read, pathParam(input, "scope"), positiveIntQuery(input.query, "limit", 100), input.now),
    getRiskView: async (input) => (await loadComponentCard(store.read, pathParam(input, "scope"), { computedAt: input.now })).risk_view,
    listChanges: async (input) =>
      (
        await listChangeTimeline(store.read, {
          since: sinceQuery(input.query, input.now),
          limit: positiveIntQuery(input.query, "limit", 100),
          ...changeScopeQuery(input.query)
        })
      ).map(changeTimelineItemToDto),
    listSourceHealth: async () => (await listSourceHealthRows(store.read)).map(sourceHealthToDto),
    listSourceCheckRuns: async (input) => listSourceCheckRunStatus(store.read, sourceCheckRunStatusInput(input)),
    getResearchRunStatus: async (input) => loadResearchRunStatusForHttp(store.read, input),
    getAiProviderStatus: async (input) => buildAiProviderStatus(aiProviderConfigInput(env), input.now),
    listAiAnalysisRuns: async (input) => listAiAnalysisRuns(store.read, aiAnalysisRunStatusInput(input)),
    listUnknowns: async (input) => loadUnknownMap(store.read, pathParam(input, "scope")),
    getCompanySupplyChainReport: async (input) => buildReadThroughSupplyChainReport(store, input, requireRuntimeEnv(env)),
    getCompanyConsumerReadModel: async (input) => (await buildReadOnlyResearchPack(store, input)).consumer_read_model,
    getCompanyReasoningWalkthrough: async (input) => (await buildReadOnlyResearchPack(store, input)).reasoning_walkthrough,
    getCompanyScbomDocument: async (input) =>
      toScbomDocument(
        await buildWorkbenchModel(store.read, {
          company: pathParam(input, "id"),
          generatedAt: input.now,
          depth: positiveIntQuery(input.query, "depth", 3)
        })
      ),
    getCompanyAiAnalysisPlan: async (input) => {
      const pack = await buildReadOnlyResearchPack(store, input);
      return buildCompanyAiAnalysisPlan({
        generated_at: input.now,
        provider: buildAiProviderStatus(aiProviderConfigInput(env), input.now),
        consumer_read_model: pack.consumer_read_model,
        reasoning_walkthrough: pack.reasoning_walkthrough
      });
    },
    getCompanyAiAnalysisLatest: async (input) => {
      const company = await loadCompanyCard(store.read, pathParam(input, "id"), { computedAt: input.now });
      const artifact = await loadLatestAiAnalysisArtifactFile({
        reports_root: "reports",
        company_id: company.entity.entity_id
      });
      if (artifact === null) throw new ApiHttpError(404, `No AI analysis artifact found for company: ${company.entity.entity_id}`);
      return artifact;
    },
    runSourceChecks: async (input) =>
      runSourceChecksWithFactPromotion(store, {
        env: requireRuntimeEnv(env),
        now: input.now,
        ...sourceCheckRunRequest(input.body)
      }),
    createCompanyResearchRun: async (input) => {
      const request = researchRunRequest(input.body);
      return createResearchRun(store, {
        company: pathParam(input, "id"),
        env: requireRuntimeEnv(env),
        requested_at: input.now,
        ...(request.depth === undefined ? {} : { depth: request.depth }),
        ...(request.source_target_namespace === undefined ? {} : { source_target_namespace: request.source_target_namespace }),
        ...(request.enqueue_source_checks === undefined ? {} : { enqueue_source_checks: request.enqueue_source_checks }),
        ...(request.reviewer === undefined ? {} : { reviewer: request.reviewer })
      });
    },
    approveReviewCandidate: async (input) => decideReview(store, input, "approved"),
    rejectReviewCandidate: async (input) => decideReview(store, input, "rejected")
  };
}

function aiProviderConfigInput(
  env?: Pick<Env, "LLM_PROVIDER" | "LLM_API_KEY" | "LLM_BASE_URL" | "LLM_MODEL" | "OPENAI_API_KEY" | "ANTHROPIC_API_KEY" | "DEEPSEEK_API_KEY">
): Parameters<typeof buildAiProviderStatus>[0] {
  return {
    LLM_PROVIDER: env?.LLM_PROVIDER ?? "none",
    ...(env?.LLM_API_KEY === undefined ? {} : { LLM_API_KEY: env.LLM_API_KEY }),
    ...(env?.LLM_BASE_URL === undefined ? {} : { LLM_BASE_URL: env.LLM_BASE_URL }),
    ...(env?.LLM_MODEL === undefined ? {} : { LLM_MODEL: env.LLM_MODEL }),
    ...(env?.OPENAI_API_KEY === undefined ? {} : { OPENAI_API_KEY: env.OPENAI_API_KEY }),
    ...(env?.ANTHROPIC_API_KEY === undefined ? {} : { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY }),
    ...(env?.DEEPSEEK_API_KEY === undefined ? {} : { DEEPSEEK_API_KEY: env.DEEPSEEK_API_KEY })
  };
}

async function resolveCompanyIdentityForHttp(store: DatabaseStore, input: ApiOperationHandlerInput): Promise<CompanyIdentityResolution> {
  const query = pathParam(input, "id");
  try {
    const card = await loadCompanyCard(store.read, query, { computedAt: input.now });
    return { status: "resolved", query, card };
  } catch (error) {
    if (!isEntityResolutionError(error)) throw error;
    return {
      status: "unresolved",
      query,
      reason:
        `"${query}" is not in the local cache yet. This is not a claim that the company does not exist: ` +
        "global identity bootstrap (GLEIF, OpenFIGI, Wikidata, Companies House, OpenCorporates, and national registries) runs inside start_research_session.",
      resolution_policy: "cache_only_no_bootstrap",
      next_actions: ["start_research_session"]
    };
  }
}

async function loadClaimForHttp(client: DbClient, claimId: string): ReturnType<typeof claimToDto> {
  const claim = await getClaim(client, claimId);
  if (claim === undefined) throw new ApiHttpError(404, `Claim not found: ${claimId}`);
  return claimToDto(client, claim);
}

async function loadResearchRunStatusForHttp(client: DbClient, input: ApiOperationHandlerInput): ReturnType<typeof getResearchRunStatus> {
  try {
    return await getResearchRunStatus(client, { run_id: pathParam(input, "id"), generated_at: input.now });
  } catch (error) {
    if (isResearchRunNotFoundError(error)) throw new ApiHttpError(404, error.message);
    throw error;
  }
}

async function buildReadThroughSupplyChainReport(store: DatabaseStore, input: ApiOperationHandlerInput, env: Env): Promise<CompanySupplyChainReport> {
  const company = pathParam(input, "id");
  const depth = positiveIntQuery(input.query, "depth", 3);
  const runResult = await ensureCompanyResearchRun(store, {
    company,
    env,
    requested_at: input.now,
    depth,
    refresh_mode: refreshModeQuery(input.query),
    max_age_minutes: nonNegativeIntQuery(input.query, "max_age_minutes", 24 * 60),
    reviewer: "api.supply-chain-report"
  });
  const sourceCheckExecution = await runInlineSourceChecksIfRequested(store, {
    env,
    now: input.now,
    mode: sourceCheckExecutionModeQuery(input.query),
    checkTargetIds: runResult.status_report.run.source_check_target_ids
  });
  const statusReport =
    sourceCheckExecution === null
      ? runResult.status_report
      : await getResearchRunStatus(store.read, { run_id: runResult.status_report.run.run_id, generated_at: input.now });
  const run = statusReport.run;
  const current = await loadCurrentSupplyChainReportContext(store, {
    company: run.company_entity_id ?? company,
    companyEntityId: run.company_entity_id,
    generatedAt: input.now,
    depth
  });
  const reportQuality = supplyChainReportQuality(run, current);
  const refresh: CompanySupplyChainReport["refresh"] = {
    mode: "read_through",
    triggered: runResult.refresh_triggered,
    reuse_reason: runResult.reuse_reason,
    source_check_execution: sourceCheckExecution,
    run
  };
  return {
    schema_version: "1.0.0",
    generated_at: input.now,
    company_query: company,
    report_quality: reportQuality,
    research_summary: buildCompanySupplyChainResearchSummary({
      company_query: company,
      report_quality: reportQuality,
      refresh,
      current
    }),
    refresh,
    current,
    policy: {
      network_lookup_allowed: true,
      source_jobs_allowed: true,
      fact_mutation_allowed: false,
      ai_provider_call_allowed: false
    }
  };
}

async function runInlineSourceChecksIfRequested(
  store: DatabaseStore,
  input: { env: Env; now: string; mode: "inline" | "queued"; checkTargetIds: readonly string[] }
): Promise<CompanySupplyChainReport["refresh"]["source_check_execution"]> {
  if (input.mode === "queued" || input.checkTargetIds.length === 0) return null;
  // 读穿报告是 GET 研究面（read_through_research_may_network_no_fact_edge_write）：inline source check 只为
  // 刷新观测/文档，绝不写事实边。要把规则事实物化成 current 边，须走显式确认门的 run_source_check 写工具。
  const result = await runDueSourceChecks(store, {
    env: input.env,
    now: input.now,
    limit: input.checkTargetIds.length,
    check_target_ids: input.checkTargetIds,
    documentObservationStore: { persistDocumentObservations }
  });
  return {
    mode: "inline",
    checked_targets: result.checked_targets,
    failed_targets: result.failed_targets,
    dead_jobs: result.dead_jobs,
    extraction_summary: summarizeInlineSourceCheckExtraction(result.items)
  };
}

// 显式 run_source_check 写工具的入口：注入观测 store 与事实提升器，让“观测→抽取→evidence-gated promote
// 写边”这条主干通过 MCP 真正走通（#13）。读穿报告 GET 不走这里（它只刷观测）。提升器持有 graph-builder，用完必关。
async function runSourceChecksWithFactPromotion(
  store: DatabaseStore,
  input: Omit<Parameters<typeof runDueSourceChecks>[1], "documentObservationStore" | "factPromoter">
): Promise<Awaited<ReturnType<typeof runDueSourceChecks>>> {
  const factPromoter = createDocumentFactPromoter(store);
  try {
    return await runDueSourceChecks(store, {
      ...input,
      documentObservationStore: { persistDocumentObservations },
      factPromoter
    });
  } finally {
    await factPromoter.close();
  }
}

function summarizeInlineSourceCheckExtraction(
  items: Awaited<ReturnType<typeof runDueSourceChecks>>["items"]
): NonNullable<CompanySupplyChainReport["refresh"]["source_check_execution"]>["extraction_summary"] {
  const summary: NonNullable<CompanySupplyChainReport["refresh"]["source_check_execution"]>["extraction_summary"] = {
    checked_documents: 0,
    observations: 0,
    review_candidates: 0,
    semantic_changes: 0,
    relation_changes: 0
  };
  for (const item of items) {
    summary.checked_documents += item.checked_documents;
    for (const sourceSummary of item.summaries) {
      summary.observations += sourceSummary.observations;
      summary.review_candidates += sourceSummary.review_candidates ?? 0;
      summary.semantic_changes += sourceSummary.semantic_changes;
      summary.relation_changes += sourceSummary.relation_changes;
    }
  }
  return summary;
}

async function loadCurrentSupplyChainReportContext(
  store: DatabaseStore,
  input: { company: string; companyEntityId: string | null; generatedAt: string; depth: number }
): Promise<CompanySupplyChainReport["current"]> {
  const pack = await maybeBuildReadOnlyResearchPack(store, {
    company: input.company,
    generatedAt: input.generatedAt,
    depth: input.depth
  });
  return {
    consumer_read_model: pack?.consumer_read_model ?? null,
    reasoning_walkthrough: pack?.reasoning_walkthrough ?? null,
    latest_ai_analysis: input.companyEntityId === null ? null : await loadLatestAiAnalysisForEntity(input.companyEntityId)
  };
}

async function maybeBuildReadOnlyResearchPack(
  store: DatabaseStore,
  input: { company: string; generatedAt: string; depth: number }
): Promise<{ consumer_read_model: ConsumerReadModel; reasoning_walkthrough: ReasoningWalkthrough } | null> {
  try {
    const pack = await buildResearchPack(store, {
      company: input.company,
      generatedAt: input.generatedAt,
      depth: input.depth
    });
    return { consumer_read_model: pack.consumer_read_model, reasoning_walkthrough: pack.reasoning_walkthrough };
  } catch (error) {
    if (isEntityResolutionError(error)) return null;
    throw error;
  }
}

async function loadLatestAiAnalysisForEntity(companyEntityId: string): Promise<AiAnalysisArtifact | null> {
  return loadLatestAiAnalysisArtifactFile({
    reports_root: "reports",
    company_id: companyEntityId
  });
}

function supplyChainReportQuality(
  run: CompanySupplyChainReport["refresh"]["run"],
  current: CompanySupplyChainReport["current"]
): CompanySupplyChainReport["report_quality"] {
  if (current.latest_ai_analysis !== null) return "ready";
  if (current.consumer_read_model !== null || current.reasoning_walkthrough !== null) return "partial";
  if (run.source_check_summary.succeeded > 0 || run.source_check_target_ids.length > 0) return "partial";
  return "empty";
}

async function buildReadOnlyResearchPack(store: DatabaseStore, input: ApiOperationHandlerInput): ReturnType<typeof buildResearchPack> {
  return buildResearchPack(store, {
    company: pathParam(input, "id"),
    generatedAt: input.now,
    depth: positiveIntQuery(input.query, "depth", 3)
  });
}

function sourceCheckRunStatusInput(input: ApiOperationHandlerInput): Parameters<typeof listSourceCheckRunStatus>[1] {
  const output: Parameters<typeof listSourceCheckRunStatus>[1] = {
    generated_at: input.now,
    limit: positiveIntQuery(input.query, "limit", 100)
  };
  const statuses = commaListQuery(input.query, "status");
  const sourceAdapterIds = commaListQuery(input.query, "source_adapter_id");
  const checkTargetIds = commaListQuery(input.query, "check_target_id");
  if (statuses !== undefined) output.statuses = sourceCheckStatuses(input.query);
  if (sourceAdapterIds !== undefined) output.source_adapter_ids = sourceAdapterIds;
  if (checkTargetIds !== undefined) output.check_target_ids = checkTargetIds;
  return output;
}

function aiAnalysisRunStatusInput(input: ApiOperationHandlerInput): Parameters<typeof listAiAnalysisRuns>[1] {
  const output: Parameters<typeof listAiAnalysisRuns>[1] = {
    generated_at: input.now,
    limit: positiveIntQuery(input.query, "limit", 100)
  };
  const statuses = commaListQuery(input.query, "status");
  const nodeIds = commaListQuery(input.query, "node_id");
  const scopeKind = optionalSingleQuery(input.query, "scope_kind");
  const scopeId = optionalSingleQuery(input.query, "scope_id");
  if (statuses !== undefined) output.statuses = aiAnalysisStatuses(input.query);
  if (nodeIds !== undefined) output.node_ids = aiAnalysisNodeIds(input.query);
  if (scopeKind !== undefined) output.scope_kind = aiAnalysisScopeKind(scopeKind);
  if (scopeId !== undefined) output.scope_id = scopeId;
  return output;
}

async function listObservationsForApiScope(
  client: DbClient,
  scope: string,
  limit: number,
  computedAt: string
): Promise<{
  scope: string;
  items: Array<CompanyObservation | ComponentObservation>;
}> {
  const parsed = parseApiScope(scope);
  if (parsed.kind === "component") {
    const component = await loadComponentCard(client, parsed.id, { computedAt });
    return { scope, items: component.related_observations.slice(0, limit) };
  }
  if (parsed.kind === "company") {
    const company = await loadCompanyCard(client, parsed.id, { computedAt });
    return { scope, items: company.related_observations.slice(0, limit) };
  }
  throw new ApiHttpError(400, "Observation scope must use company:<id> or component:<id>");
}

function parseApiScope(scope: string): { kind: "company" | "component"; id: string } | { kind: "unknown"; id: string } {
  const separator = scope.indexOf(":");
  if (separator < 0) return { kind: "unknown", id: scope };
  const kind = scope.slice(0, separator);
  const id = scope.slice(separator + 1);
  if (id.trim().length === 0) return { kind: "unknown", id };
  if (kind === "company" || kind === "component") return { kind, id };
  return { kind: "unknown", id };
}

async function decideReview(store: DatabaseStore, input: ApiOperationHandlerInput, decision: "approved" | "rejected"): Promise<ReviewDecisionResult> {
  const request = reviewDecisionRequest(input.body);
  const item = await decideReviewCandidateTransactionally(store, {
    reviewId: pathParam(input, "id"),
    decision,
    reviewer: request.reviewer,
    reason: request.reason
  });
  if (decision === "rejected") {
    return { review_id: item.review_id, decision, status: "rejected", fact_edge_write_allowed: false };
  }
  // 批准后立即在确认边界内做 evidence-gated 应用：把 approved 候选物化成 current 边/实体，或在无法解析时
  // 显式 block（带 reason）。这样 MCP review.approve 真正接通事实主干，agent 拿到“写了几条边”的即时反馈，
  // 而不是让批准的候选悬在 approved 态、只能靠 CLI 另行 apply。reviewer 即审批人，全程审计留痕。
  const applyResult = await applyApprovedReviewCandidate(store, item.review_id, request.reviewer);
  return reviewDecisionResultFromApply(item.review_id, applyResult);
}

function reviewDecisionResultFromApply(reviewId: string, applyResult: ReviewApplyResult): ReviewDecisionResult {
  const appliedEdges = applyResult.status === "applied" ? applyResult.apply_results.length : 0;
  return {
    review_id: reviewId,
    decision: "approved",
    status: applyResult.status,
    fact_edge_write_allowed: appliedEdges > 0,
    applied_edges: appliedEdges,
    ...("reason" in applyResult && applyResult.reason !== undefined ? { apply_reason: applyResult.reason } : {})
  };
}

function reviewDecisionRequest(body: unknown): { reviewer: string; reason: string } {
  if (!isRecord(body)) throw new ApiHttpError(400, "Review decision body must be a JSON object");
  const reviewer = body["reviewer"];
  const reason = body["reason"];
  if (typeof reviewer !== "string" || reviewer.trim().length === 0) throw new ApiHttpError(400, "reviewer must be a non-empty string");
  if (typeof reason !== "string" || reason.trim().length === 0) throw new ApiHttpError(400, "reason must be a non-empty string");
  return { reviewer, reason };
}

function researchRunRequest(body: unknown): ResearchRunRequest {
  if (body === undefined) return {};
  if (!isRecord(body)) throw new ApiHttpError(400, "Research run body must be a JSON object");
  const depth = optionalPositiveIntegerBody(body, "depth");
  const sourceTargetNamespace = optionalStringBody(body, "source_target_namespace");
  const enqueueSourceChecks = optionalBooleanBody(body, "enqueue_source_checks");
  const reviewer = optionalStringBody(body, "reviewer");
  return {
    ...(depth === undefined ? {} : { depth }),
    ...(sourceTargetNamespace === undefined ? {} : { source_target_namespace: sourceTargetNamespace }),
    ...(enqueueSourceChecks === undefined ? {} : { enqueue_source_checks: enqueueSourceChecks }),
    ...(reviewer === undefined ? {} : { reviewer })
  };
}

function sourceCheckRunRequest(body: unknown): { limit?: number; check_target_ids?: string[]; source_adapter_ids?: string[] } {
  if (body === undefined) return {};
  if (!isRecord(body)) throw new ApiHttpError(400, "Source check run body must be a JSON object");
  const limit = optionalPositiveIntegerBody(body, "limit");
  const checkTargetIds = optionalStringArrayBody(body, "check_target_ids");
  const sourceAdapterIds = optionalStringArrayBody(body, "source_adapter_ids");
  return {
    ...(limit === undefined ? {} : { limit }),
    ...(checkTargetIds === undefined ? {} : { check_target_ids: checkTargetIds }),
    ...(sourceAdapterIds === undefined ? {} : { source_adapter_ids: sourceAdapterIds })
  };
}

function optionalPositiveIntegerBody(body: Record<string, unknown>, name: string): number | undefined {
  const value = body[name];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new ApiHttpError(400, `${name} must be a positive integer`);
  return value;
}

function optionalStringArrayBody(body: Record<string, unknown>, name: string): string[] | undefined {
  const value = body[name];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ApiHttpError(400, `${name} must be an array of non-empty strings`);
  const output: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) throw new ApiHttpError(400, `${name} must be an array of non-empty strings`);
    output.push(item.trim());
  }
  return [...new Set(output)].sort();
}

function optionalStringBody(body: Record<string, unknown>, name: string): string | undefined {
  const value = body[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) throw new ApiHttpError(400, `${name} must be a non-empty string`);
  return value.trim();
}

function optionalBooleanBody(body: Record<string, unknown>, name: string): boolean | undefined {
  const value = body[name];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new ApiHttpError(400, `${name} must be a boolean`);
  return value;
}

function requireRuntimeEnv(env: Env | undefined): Env {
  if (env === undefined) throw new ApiHttpError(500, "API runtime env is required to create research runs");
  return env;
}

function pathParam(input: ApiOperationHandlerInput, name: string): string {
  const value = input.path_params[name];
  if (value === undefined || value.trim().length === 0) throw new ApiHttpError(400, `Missing path parameter: ${name}`);
  return value;
}

function positiveIntQuery(query: URLSearchParams, name: string, defaultValue: number): number {
  const value = query.get(name);
  if (value === null || value.trim().length === 0) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new ApiHttpError(400, `${name} must be a positive integer`);
  return parsed;
}

function nonNegativeIntQuery(query: URLSearchParams, name: string, defaultValue: number): number {
  const value = query.get(name);
  if (value === null || value.trim().length === 0) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) throw new ApiHttpError(400, `${name} must be a non-negative integer`);
  return parsed;
}

function refreshModeQuery(query: URLSearchParams): ResearchRunRefreshMode {
  const value = query.get("refresh");
  if (value === null || value.trim().length === 0 || value === "auto") return "auto";
  if (value === "force") return "force";
  throw new ApiHttpError(400, "refresh must be auto or force");
}

function sourceCheckExecutionModeQuery(query: URLSearchParams): "inline" | "queued" {
  const value = query.get("source_checks");
  if (value === null || value.trim().length === 0 || value === "inline") return "inline";
  if (value === "queued") return "queued";
  throw new ApiHttpError(400, "source_checks must be inline or queued");
}

function sinceQuery(query: URLSearchParams, now: string): string {
  const value = query.get("since");
  if (value !== null && value.trim().length > 0) {
    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) throw new ApiHttpError(400, "since must be an ISO timestamp");
    return new Date(timestamp).toISOString();
  }
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) throw new ApiHttpError(500, `Invalid API clock timestamp: ${now}`);
  return new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString();
}

function commaListQuery(query: URLSearchParams, name: string): string[] | undefined {
  const value = query.get(name);
  if (value === null || value.trim().length === 0) return undefined;
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length === 0 ? undefined : [...new Set(items)].sort();
}

function sourceCheckStatuses(query: URLSearchParams): SourceCheckJobStatus[] {
  const values = commaListQuery(query, "status") ?? [];
  const statuses: SourceCheckJobStatus[] = [];
  for (const value of values) {
    if (!isSourceCheckJobStatus(value)) throw new ApiHttpError(400, `Unsupported source check job status: ${value}`);
    statuses.push(value);
  }
  return statuses;
}

function aiAnalysisStatuses(query: URLSearchParams): AiAnalysisRunStatus[] {
  const values = commaListQuery(query, "status") ?? [];
  const statuses: AiAnalysisRunStatus[] = [];
  for (const value of values) {
    if (!isAiAnalysisRunStatus(value)) throw new ApiHttpError(400, `Unsupported AI analysis run status: ${value}`);
    statuses.push(value);
  }
  return statuses;
}

function aiAnalysisNodeIds(query: URLSearchParams): AiAnalysisNodeId[] {
  const values = commaListQuery(query, "node_id") ?? [];
  const nodeIds: AiAnalysisNodeId[] = [];
  for (const value of values) {
    if (!isAiAnalysisNodeId(value)) throw new ApiHttpError(400, `Unsupported AI analysis node id: ${value}`);
    nodeIds.push(value);
  }
  return nodeIds;
}

function aiAnalysisScopeKind(value: string): AiAnalysisScopeKind {
  if (!isAiAnalysisScopeKind(value)) throw new ApiHttpError(400, `Unsupported AI analysis scope kind: ${value}`);
  return value;
}

function isSourceCheckJobStatus(value: string): value is SourceCheckJobStatus {
  return SOURCE_CHECK_JOB_STATUSES.some((status) => status === value);
}

function isAiAnalysisRunStatus(value: string): value is AiAnalysisRunStatus {
  return AI_ANALYSIS_RUN_STATUSES.some((status) => status === value);
}

function isAiAnalysisNodeId(value: string): value is AiAnalysisNodeId {
  return AI_ANALYSIS_NODE_IDS.some((nodeId) => nodeId === value);
}

function isAiAnalysisScopeKind(value: string): value is AiAnalysisScopeKind {
  return AI_ANALYSIS_SCOPE_KINDS.some((kind) => kind === value);
}

function optionalSingleQuery(query: URLSearchParams, name: string): string | undefined {
  const value = query.get(name);
  if (value === null || value.trim().length === 0) return undefined;
  return value.trim();
}

const CHANGE_SCOPE_KINDS = [
  "company",
  "entity",
  "edge",
  "claim",
  "observation",
  "lead",
  "unknown",
  "alert",
  "risk_view",
  "risk_metric",
  "review",
  "source"
] as const;

// 解析 ?scope=<kind>:<id>（如 company:ENT-ASML / source:sec-edgar）成 ChangeTimelineScope。
// 缺省（不传 scope）时返回空，保持原有“全局变更流”语义。
function changeScopeQuery(query: URLSearchParams): { scope?: ChangeTimelineScope } {
  const raw = optionalSingleQuery(query, "scope");
  if (raw === undefined) return {};
  const separator = raw.indexOf(":");
  if (separator <= 0) throw new ApiHttpError(400, `Change scope must use <kind>:<id>, got: ${raw}`);
  const kind = raw.slice(0, separator);
  const id = raw.slice(separator + 1).trim();
  if (id.length === 0) throw new ApiHttpError(400, `Change scope id must be a non-empty string: ${raw}`);
  if (!(CHANGE_SCOPE_KINDS as readonly string[]).includes(kind)) throw new ApiHttpError(400, `Unsupported change scope kind: ${kind}`);
  return { scope: { kind, id } as ChangeTimelineScope };
}

function sourceHealthToDto(row: SourceHealthRow): WorkbenchSourceHealth {
  return {
    source_adapter_id: row.source_adapter_id,
    tier: row.tier,
    category: row.category,
    registry_status: row.registry_status,
    automation: row.automation,
    tos_url: row.tos_url,
    official_url: row.official_url,
    requires_key: row.requires_key,
    last_checked_at: toNullableIso(row.last_checked_at),
    last_success_at: toNullableIso(row.last_success_at),
    last_failure_at: toNullableIso(row.last_failure_at),
    failure_count: row.failure_count,
    last_change_at: toNullableIso(row.last_change_at),
    last_error_message: row.last_error_message,
    policy_enabled: row.policy_enabled,
    check_cadence_minutes: row.check_cadence_minutes,
    jitter_minutes: row.jitter_minutes,
    priority: row.priority,
    next_check_at: toNullableIso(row.next_check_at),
    policy_config_source: row.policy_config_source,
    policy_notes: row.policy_notes
  };
}

function toNullableIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
