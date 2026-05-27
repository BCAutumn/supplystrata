import type { ChainViewModel } from "@supplystrata/chain-view";
import type { ConsumerReadModel, ReasoningWalkthrough } from "@supplystrata/research-pack";
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
export type ApiReviewWritePolicy = "review_queue_mutation_only_no_fact_edge_write";

export interface ApiReadMeta {
  generated_at: string;
  read_policy: ApiReadPolicy;
}

export interface ApiWriteMeta {
  accepted_at: string;
  write_policy: ApiReviewWritePolicy;
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

export type CompanyCardApiResponse = ApiReadEnvelope<CompanyCardModel>;
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
export type UnknownMapApiResponse = ApiReadEnvelope<UnknownMapModel>;
export type ConsumerReadModelApiResponse = ApiReadEnvelope<ConsumerReadModel>;
export type ReasoningWalkthroughApiResponse = ApiReadEnvelope<ReasoningWalkthrough>;

export interface ReviewDecisionRequest {
  reviewer: string;
  reason: string;
}

export interface ReviewDecisionResult {
  review_id: string;
  decision: "approved" | "rejected";
  status: "approved" | "rejected";
  fact_edge_write_allowed: false;
}

export type ReviewDecisionApiResponse = ApiWriteEnvelope<ReviewDecisionResult>;
