import type { AutomationPolicy, SourceStatus, SourceTier } from "@supplystrata/source-registry";

export type ResearchSourcePurpose =
  | "official_disclosure"
  | "entity_resolution"
  | "facility"
  | "commodity"
  | "macro"
  | "trade"
  | "logistics"
  | "procurement"
  | "policy"
  | "manual_review";

export const PLANNED_OUTPUT_LAYERS = ["edge", "observation", "lead", "entity"] as const;
export const SOURCE_RELATION_POLICIES = ["can_create_fact_edge", "observation_only", "lead_only", "entity_only"] as const;

export type PlannedOutputLayer = (typeof PLANNED_OUTPUT_LAYERS)[number];
export type SourceRelationPolicy = (typeof SOURCE_RELATION_POLICIES)[number];
export type TradeObservationDirection = "imports" | "exports";

export interface SourcePlanCheckTargetSuggestion {
  source_adapter_id: string;
  target_kind: string;
  runnable: boolean;
  target_config: Record<string, string | number | boolean | string[]>;
  reason: string;
}

export interface SourcePlanItem {
  source_id: string;
  source_name: string;
  purpose: ResearchSourcePurpose;
  priority: SourceTier;
  status: SourceStatus;
  automation: AutomationPolicy;
  requires_key: boolean;
  expected_output_layer: PlannedOutputLayer;
  relation_policy: SourceRelationPolicy;
  parent_component_ids: string[];
  target_ids: string[];
  trigger_dependency_ids: string[];
  reasons: string[];
  suggested_check_targets: SourcePlanCheckTargetSuggestion[];
}

export type SourcePlanTargetNodeKind = "company" | "component";

export interface SourcePlanOfficialDisclosureTargetConfig {
  source_id: string;
  target_kind: string;
  target_config: Record<string, string | number | boolean | string[]>;
  reason?: string;
}

export interface SourcePlanOfficialDisclosureTargetNode {
  node_id: string;
  node_kind: SourcePlanTargetNodeKind;
  name?: string;
  expected_source_ids?: readonly string[];
  expected_source_targets?: readonly SourcePlanOfficialDisclosureTargetConfig[];
}

export interface SourcePlanForComponentsInput {
  component_ids: readonly string[];
  entity_ids?: readonly string[];
  officialDisclosureTargetNodes?: readonly SourcePlanOfficialDisclosureTargetNode[];
  maxTierDepth?: number;
  tradeObservationMonth?: string;
  tradeObservationCountryCode?: string;
  tradeObservationDirections?: readonly TradeObservationDirection[];
  officialDisclosureYear?: string;
  materialObservationYear?: string;
  commodityObservationMonth?: string;
}

export interface SourcePlanDraft {
  sourceId: string;
  parentComponentId: string | null;
  targetId: string;
  dependencyId: string;
  reason: string;
}

export interface SourcePlanContext {
  entityIds: ReadonlySet<string>;
  officialDisclosureTargetNodes: readonly SourcePlanOfficialDisclosureTargetNode[];
  officialDisclosure?: OfficialDisclosureContext;
  tradeObservation?: TradeObservationContext;
  materialObservation?: MaterialObservationContext;
}

export interface OfficialDisclosureContext {
  year: string;
}

export interface TradeObservationContext {
  month: string;
  countryCode?: string;
  directions: readonly TradeObservationDirection[];
}

export interface MaterialObservationContext {
  year?: string;
  month?: string;
}
