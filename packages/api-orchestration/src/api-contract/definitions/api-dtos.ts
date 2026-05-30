import type { AiAnalysisArtifact, AiAnalysisPlan, AiAnalysisRunStatusReport } from "@supplystrata/ai-analysis";
import type { ChainViewModel } from "@supplystrata/chain-view";
import type { AiProviderStatusReport } from "@supplystrata/llm-helpers";
import type { ConsumerReadModel, ReasoningWalkthrough } from "@supplystrata/research-pack";
import type { SourceCheckRunStatusReport } from "@supplystrata/source-monitor";
import type { DueSourceCheckRunResult, ResearchRunReuseReason, ResearchRunStatusReport } from "@supplystrata/source-workflows";
import type {
  CompanyCardModel,
  CompanyObservation,
  ComponentCardModel,
  ComponentObservation,
  ComponentRiskView,
  EvidenceCardModel,
  UnknownMapModel
} from "@supplystrata/render";
import type { WorkbenchChangeTimelineItem, WorkbenchClaim, WorkbenchEvidence, WorkbenchSourceHealth } from "@supplystrata/workbench-export";

export type ApiContractVersion = "0.1.0";
export type ApiSchemaVersion = "1.0.0";
export type ApiReadPolicy = "read_only_no_truth_store_mutation";
// reject 只翻转 review 队列状态，绝不动事实；approve 是确认边界内的“受审应用”，按候选类型可能写出
// current 事实边/实体（supplier_list、entity 等），也可能只是登记处置（semantic_change、official_signal 等）。
export type ApiReviewWritePolicy = "review_queue_mutation_only_no_fact_edge_write" | "review_approval_applies_reviewed_fact_edges";
// research-run 创建只 bootstrap 实体 + 入队 source-check job，不动事实；source-check 执行（显式确认门触发）
// 会跑完 extract + evidence-gated promote，按 #13 把规则抽取的高可信关系写成 current 边，故单列一条策略。
export type ApiWorkflowWritePolicy =
  | "research_run_mutation_no_fact_edge_write"
  | "source_check_execution_runs_evidence_gated_promote";
export type ApiReadThroughResearchPolicy = "read_through_research_may_network_no_fact_edge_write";
export type ApiWritePolicy = ApiReviewWritePolicy | ApiWorkflowWritePolicy;

export interface ApiReadMeta {
  generated_at: string;
  read_policy: ApiReadPolicy;
}

export interface ApiWriteMeta {
  accepted_at: string;
  write_policy: ApiWritePolicy;
}

export interface ApiReadThroughResearchMeta {
  generated_at: string;
  research_policy: ApiReadThroughResearchPolicy;
}

export interface ApiReadEnvelope<TData> {
  schema_version: ApiSchemaVersion;
  contract_version: ApiContractVersion;
  data: TData;
  meta: ApiReadMeta;
}

export interface ApiWriteEnvelope<TData> {
  schema_version: ApiSchemaVersion;
  contract_version: ApiContractVersion;
  data: TData;
  meta: ApiWriteMeta;
}

export interface ApiReadThroughResearchEnvelope<TData> {
  schema_version: ApiSchemaVersion;
  contract_version: ApiContractVersion;
  data: TData;
  meta: ApiReadThroughResearchMeta;
}

export type CompanyCardApiResponse = ApiReadEnvelope<CompanyCardModel>;

export interface CompanyIdentityResolved {
  status: "resolved";
  query: string;
  card: CompanyCardModel;
}

export interface CompanyIdentityUnresolved {
  status: "unresolved";
  query: string;
  reason: string;
  resolution_policy: "cache_only_no_bootstrap";
  next_actions: string[];
}

export type CompanyIdentityResolution = CompanyIdentityResolved | CompanyIdentityUnresolved;
export type CompanyIdentityApiResponse = ApiReadEnvelope<CompanyIdentityResolution>;

export type ComponentCardApiResponse = ApiReadEnvelope<ComponentCardModel>;
export type ChainApiResponse = ApiReadEnvelope<ChainViewModel>;
export type ClaimApiResponse = ApiReadEnvelope<WorkbenchClaim>;
export type EvidenceApiResponse = ApiReadEnvelope<WorkbenchEvidence | EvidenceCardModel>;
export type ObservationsApiResponse = ApiReadEnvelope<{
  scope: string;
  items: Array<CompanyObservation | ComponentObservation>;
}>;
export type RiskViewApiResponse = ApiReadEnvelope<ComponentRiskView>;
export type ChangesApiResponse = ApiReadEnvelope<WorkbenchChangeTimelineItem[]>;
export type SourcesHealthApiResponse = ApiReadEnvelope<WorkbenchSourceHealth[]>;
export type SourceCheckRunsApiResponse = ApiReadEnvelope<SourceCheckRunStatusReport>;
export type ResearchRunStatusApiResponse = ApiReadEnvelope<ResearchRunStatusReport>;
export type SourceCheckRunApiResponse = ApiWriteEnvelope<DueSourceCheckRunResult>;
export type ResearchRunApiResponse = ApiWriteEnvelope<ResearchRunStatusReport>;
export type CompanySupplyChainReportApiResponse = ApiReadThroughResearchEnvelope<CompanySupplyChainReport>;
export type AiProviderStatusApiResponse = ApiReadEnvelope<AiProviderStatusReport>;
export type AiAnalysisRunsApiResponse = ApiReadEnvelope<AiAnalysisRunStatusReport>;
export type CompanyAiAnalysisPlanApiResponse = ApiReadEnvelope<AiAnalysisPlan>;
export type CompanyAiAnalysisLatestApiResponse = ApiReadEnvelope<AiAnalysisArtifact>;
export type UnknownMapApiResponse = ApiReadEnvelope<UnknownMapModel>;
export type ConsumerReadModelApiResponse = ApiReadEnvelope<ConsumerReadModel>;
export type ReasoningWalkthroughApiResponse = ApiReadEnvelope<ReasoningWalkthrough>;

export type CompanySupplyChainReportQuality = "empty" | "partial" | "ready";
export type CompanySupplyChainReportReadiness =
  | "facts_ready"
  | "review_needed"
  | "observations_only"
  | "source_checks_pending"
  | "source_checks_failed"
  | "no_coverage";

export interface CompanySupplyChainResearchSummary {
  company_entity_id: string | null;
  readiness: CompanySupplyChainReportReadiness;
  plain_language_status: string;
  evidence_boundary: string;
  source_check_status: SourceCheckRunStatusReport["summary"];
  extraction_counts: {
    checked_documents: number;
    observations: number;
    review_candidates: number;
    semantic_changes: number;
    relation_changes: number;
    fact_edges: number | null;
    unknown_items: number | null;
  };
  recommended_next_calls: string[];
  agent_instructions: string[];
}

export interface CompanySupplyChainReport {
  schema_version: ApiSchemaVersion;
  generated_at: string;
  company_query: string;
  report_quality: CompanySupplyChainReportQuality;
  research_summary: CompanySupplyChainResearchSummary;
  refresh: {
    mode: "read_through";
    triggered: boolean;
    reuse_reason: ResearchRunReuseReason;
    source_check_execution: {
      mode: "inline" | "queued";
      checked_targets: number;
      failed_targets: number;
      dead_jobs: number;
      extraction_summary: {
        checked_documents: number;
        observations: number;
        review_candidates: number;
        semantic_changes: number;
        relation_changes: number;
      };
    } | null;
    run: ResearchRunStatusReport["run"];
  };
  current: {
    consumer_read_model: ConsumerReadModel | null;
    reasoning_walkthrough: ReasoningWalkthrough | null;
    latest_ai_analysis: AiAnalysisArtifact | null;
  };
  policy: {
    network_lookup_allowed: true;
    source_jobs_allowed: true;
    fact_mutation_allowed: false;
    ai_provider_call_allowed: false;
  };
}

export interface ReviewDecisionRequest {
  reviewer: string;
  reason: string;
}

export interface ResearchRunRequest {
  depth?: number;
  source_target_namespace?: string;
  enqueue_source_checks?: boolean;
  reviewer?: string;
}

export interface ReviewDecisionResult {
  review_id: string;
  decision: "approved" | "rejected";
  // 批准会在同一确认边界内立即做 evidence-gated 应用，故 status 反映应用结果而非仅“approved”。
  status: "approved" | "rejected" | "applied" | "entity_applied" | "acknowledged" | "blocked";
  // 本次决定是否真的写出了 current 事实边（仅 supplier_list/entity 等会落边的候选在成功应用后为 true）。
  fact_edge_write_allowed: boolean;
  applied_edges?: number;
  apply_reason?: string;
}

export type ReviewDecisionApiResponse = ApiWriteEnvelope<ReviewDecisionResult>;
