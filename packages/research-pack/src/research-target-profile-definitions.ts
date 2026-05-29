import type { DerivedProfileComponent, LlmCandidateCitation, LlmHelperCandidateStatus, SuggestedSourceTarget } from "@supplystrata/llm-helpers";
import type { OfficialDisclosureReadinessTargetNode } from "./official-disclosure-readiness.js";

export const RESEARCH_TARGET_PROFILE_IDS = ["ai-compute-memory.v0", "ev-battery-energy.v0"] as const;

export type ResearchTargetProfileId = (typeof RESEARCH_TARGET_PROFILE_IDS)[number];
export type ResearchTargetProfileVersion = "0.1.0";
export type ResearchTargetProfileLayer = "anchor" | "derived";

export interface ResearchTargetProfileBase {
  layer: ResearchTargetProfileLayer;
  profile_id: string;
  version: ResearchTargetProfileVersion;
  title: string;
  description: string;
  applies_to_company_ids: string[];
  applies_to_component_ids: string[];
  target_nodes: OfficialDisclosureReadinessTargetNode[];
}

export interface AnchorResearchTargetProfile extends ResearchTargetProfileBase {
  layer: "anchor";
  profile_id: ResearchTargetProfileId;
}

export interface DerivedResearchTargetProfile extends ResearchTargetProfileBase {
  layer: "derived";
  profile_id: "derived.runtime.v0";
  derivation: ResearchTargetProfileDerivation;
}

export type ResearchTargetProfile = AnchorResearchTargetProfile | DerivedResearchTargetProfile;

export type ResearchTargetProfileDerivation =
  | PlaceholderResearchTargetProfileDerivation
  | CandidateResearchTargetProfileDerivation
  | GenericResearchTargetProfileDerivation;

export interface PlaceholderResearchTargetProfileDerivation {
  status: "placeholder";
  company_id: string;
  component_ids: string[];
  reason: string;
}

export interface CandidateResearchTargetProfileDerivation {
  status: "candidate";
  company_id: string;
  component_ids: string[];
  source_refs: string[];
  helper_status: Extract<LlmHelperCandidateStatus, "candidate">;
  confidence: number;
  rationale: string;
  citations: LlmCandidateCitation[];
  expected_upstream_components: DerivedProfileComponent[];
  source_targets: SuggestedSourceTarget[];
  fact_write_allowed: false;
  reason: string;
}

export interface GenericResearchTargetProfileDerivation {
  status: "generic";
  company_id: string;
  component_ids: string[];
  country_code?: string;
  sic_code?: string;
  naics_code?: string;
  source_refs: string[];
  helper_status: Exclude<LlmHelperCandidateStatus, "candidate">;
  confidence: number;
  rationale: string;
  citations: LlmCandidateCitation[];
  expected_upstream_components: [];
  source_targets: [];
  fact_write_allowed: false;
  reason: string;
}

export interface ResearchTargetProfileSelection {
  profile: ResearchTargetProfile | null;
  layer: ResearchTargetProfileLayer | "none";
  reason: string;
}

export type ResearchTargetProfileOption = ResearchTargetProfileId | "none";

const RESEARCH_TARGET_PROFILE_ID_SET: ReadonlySet<string> = new Set(RESEARCH_TARGET_PROFILE_IDS);

export function isResearchTargetProfileId(value: string): value is ResearchTargetProfileId {
  return RESEARCH_TARGET_PROFILE_ID_SET.has(value);
}
