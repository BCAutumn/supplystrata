import type { EvidenceLevel, RelationType } from "@supplystrata/core";

export type ChangeTimelineScope =
  | { kind: "company"; id: string }
  | { kind: "entity"; id: string }
  | { kind: "edge"; id: string }
  | { kind: "claim"; id: string }
  | { kind: "observation"; id: string }
  | { kind: "lead"; id: string }
  | { kind: "unknown"; id: string }
  | { kind: "alert"; id: string }
  | { kind: "risk_view"; id: string }
  | { kind: "risk_metric"; id: string }
  | { kind: "review"; id: string }
  | { kind: "source"; id: string };

export interface ChangeTimelineInput {
  since: string;
  limit: number;
  scope?: ChangeTimelineScope;
  changeType?: string;
  sourceAdapterId?: string;
  attentionOnly?: boolean;
}

export interface ChangeTimelineItem {
  event_id: string;
  event_family: "graph" | "source" | "semantic" | "risk";
  event_type: string;
  occurred_at: string;
  scope_kind?: string;
  scope_id?: string;
  source_adapter_id?: string;
  source_item_id?: string;
  doc_id?: string;
  previous_doc_id?: string;
  next_doc_id?: string;
  edge_id?: string;
  evidence_id?: string;
  evidence_level?: EvidenceLevel;
  superseded_evidence_ids?: string[];
  superseded_by_evidence_id?: string;
  subject_id?: string;
  subject_name?: string;
  object_id?: string;
  object_name?: string;
  relation?: RelationType;
  component?: string;
  semantic_relation_kind?: string;
  relation_subject_surface?: string;
  relation_object_surface?: string;
  relation_fingerprint?: string;
  observation_scope_kind?: string;
  observation_scope_id?: string;
  metric_name?: string;
  metric_value?: string;
  metric_unit?: string;
  baseline_method?: string;
  baseline_value?: string;
  change_percent?: number;
  anomaly_severity?: string;
  anomaly_direction?: string;
  caused_by: string;
  requires_attention: boolean;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export interface SemanticChangeInput {
  scope_kind: string;
  scope_id: string;
  change_type: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  evidence_ids?: readonly string[];
  caused_by: string;
}
