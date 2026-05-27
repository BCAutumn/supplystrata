import type pg from "pg";
import type {
  ComponentSpecificity,
  EdgeCalibrationErrorCategory,
  EdgeCalibrationLabel,
  EvidenceLevel,
  ObservationType,
  RelationType,
  RiskMetricKind
} from "@supplystrata/core";

export interface EvidenceTraceBackfillRow extends pg.QueryResultRow {
  evidence_id: string;
  cite_text: string;
  extractor_id: string | null;
  llm_meta: unknown;
  doc_id: string;
  chunk_id: string | null;
  bytes_sha256: string;
  metadata: Record<string, unknown>;
  chunk_text: string | null;
  subject_id: string | null;
  object_id: string | null;
  relation: RelationType | null;
  component: string | null;
  component_id: string | null;
  component_specificity: ComponentSpecificity | null;
}

export interface IntelligenceRefreshEdgeRow extends pg.QueryResultRow {
  edge_id: string;
  subject_id: string;
  subject_name: string;
  object_id: string;
  object_name: string;
  relation: RelationType;
  component: string | null;
  component_id: string | null;
  evidence_level: EvidenceLevel;
  primary_evidence_id: string;
  cite_text: string;
  source_date: Date | string | null;
}

export interface ObservationAnomalyChangeRow extends pg.QueryResultRow {
  change_id: string;
  detected_at: Date;
  observation_id: string;
  after: Record<string, unknown>;
}

export interface SourceFailureEventRow extends pg.QueryResultRow {
  event_id: string;
  detected_at: Date;
  source_adapter_id: string;
  after: Record<string, unknown>;
}

export interface ComponentRiskMetricAlertRow extends pg.QueryResultRow {
  risk_view_id: string;
  generated_at: Date;
  model_version: string;
  metric_id: string;
  metric_kind: RiskMetricKind;
  subject_kind: string;
  subject_id: string;
  component_id: string;
  value: string | null;
  confidence: number;
  attrs: Record<string, unknown>;
}

export interface PolicyConstraintObservationAlertRow extends pg.QueryResultRow {
  observation_id: string;
  created_at: Date;
  source_adapter_id: string;
  scope_kind: string;
  scope_id: string;
  metric_name: string;
  confidence: number;
  provenance: Record<string, unknown>;
  attrs: Record<string, unknown>;
}

export interface EdgeCalibrationSampleRow extends pg.QueryResultRow {
  label_id: string;
  edge_id: string;
  evidence_id: string | null;
  label: EdgeCalibrationLabel;
  error_category: EdgeCalibrationErrorCategory | null;
  reviewer: string;
  reviewed_at: Date;
  rationale: string | null;
  subject_id: string;
  object_id: string;
  relation: RelationType;
  component_id: string | null;
  evidence_level: EvidenceLevel;
  confidence: number;
  is_inferred: boolean;
  extraction_method: string;
  source_adapter_id: string | null;
  doc_id: string | null;
}

export interface FinancialMetricObservationRow extends pg.QueryResultRow {
  observation_id: string;
  source_adapter_id: string;
  source_item_id: string | null;
  doc_id: string | null;
  scope_kind: string;
  scope_id: string;
  company_name: string | null;
  metric_name: string;
  metric_value: string;
  metric_unit: string | null;
  time_window_start: Date | null;
  time_window_end: Date | null;
  confidence: number;
  provenance: Record<string, unknown>;
  attrs: Record<string, unknown>;
  created_at: Date;
}

export interface ObservationAnomalyRow extends pg.QueryResultRow {
  observation_id: string;
  observation_type: ObservationType;
  source_adapter_id: string;
  source_item_id: string | null;
  doc_id: string | null;
  scope_kind: string;
  scope_id: string;
  geography_kind: string | null;
  geography_id: string | null;
  component_id: string | null;
  metric_name: string;
  metric_value: string | null;
  metric_unit: string | null;
  time_window_start: Date | null;
  time_window_end: Date | null;
  baseline_value: string | null;
  change_value: string | null;
  change_percent: number | null;
  confidence: number;
  provenance: Record<string, unknown>;
  attrs: Record<string, unknown>;
  created_at: Date;
}

export interface ObservationAnomalyHistoryRow extends ObservationAnomalyRow {
  candidate_observation_id: string;
}

export interface ExistingSemanticChangeRow extends pg.QueryResultRow {
  change_id: string;
}

export interface ExistingEdgeRow extends pg.QueryResultRow {
  edge_id: string;
}

export interface RootResearchCoverageEntityRow extends pg.QueryResultRow {
  entity_id: string;
  display_name: string;
}

export interface RootResearchCoverageCountRow extends pg.QueryResultRow {
  count: string;
}

export interface OfficialSignalDispositionChangeRow extends pg.QueryResultRow {
  change_id: string;
  review_id: string;
  after: Record<string, unknown> | null;
  detected_at: Date | string;
}

export interface ComponentRiskEdgeRow extends pg.QueryResultRow {
  edge_id: string;
  relation: RelationType;
  subject_id: string;
  subject_name: string;
  object_id: string;
  object_name: string;
  component_id: string;
  evidence_level: EvidenceLevel;
  confidence: number;
  primary_evidence_id: string | null;
}

export interface ComponentRiskComponentRow extends pg.QueryResultRow {
  component_id: string;
}

export interface ComponentRiskChangeRow extends pg.QueryResultRow {
  change_id: string;
}
