export const COMPONENT_RISK_MODEL_VERSION = "component-risk-baseline.v1";

export interface RefreshComponentRiskViewInput {
  component_id: string;
  computed_at: string;
  generated_by?: string;
}

export interface ComponentRiskRefreshSummary {
  risk_view_id: string;
  component_id: string;
  metrics: number;
  edge_count: number;
  supplier_count: number;
  share_unknown: boolean;
  risk_changes_recorded: number;
  model_version: string;
  inputs_fingerprint: string;
}
