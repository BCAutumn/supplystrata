import type { OfficialDisclosureReadinessTargetNode } from "./official-disclosure-readiness.js";

export const RESEARCH_TARGET_PROFILE_IDS = ["ai-compute-memory.v0", "ev-battery-energy.v0"] as const;

export type ResearchTargetProfileId = (typeof RESEARCH_TARGET_PROFILE_IDS)[number];
export type ResearchTargetProfileVersion = "0.1.0";

export interface ResearchTargetProfile {
  profile_id: ResearchTargetProfileId;
  version: ResearchTargetProfileVersion;
  title: string;
  description: string;
  applies_to_company_ids: string[];
  applies_to_component_ids: string[];
  target_nodes: OfficialDisclosureReadinessTargetNode[];
}

export interface ResearchTargetProfileSelection {
  profile: ResearchTargetProfile | null;
  reason: string;
}

export type ResearchTargetProfileOption = ResearchTargetProfileId | "none";

const RESEARCH_TARGET_PROFILE_ID_SET: ReadonlySet<string> = new Set(RESEARCH_TARGET_PROFILE_IDS);

export function isResearchTargetProfileId(value: string): value is ResearchTargetProfileId {
  return RESEARCH_TARGET_PROFILE_ID_SET.has(value);
}
