import { AI_COMPUTE_MEMORY_PROFILE } from "./research-target-profile-ai-compute-memory.js";
import { EV_BATTERY_ENERGY_PROFILE } from "./research-target-profile-ev-battery-energy.js";
import type {
  AnchorResearchTargetProfile,
  DerivedResearchTargetProfile,
  ResearchTargetProfileId,
  ResearchTargetProfileOption,
  ResearchTargetProfileSelection
} from "./research-target-profile-definitions.js";

const ANCHOR_RESEARCH_TARGET_PROFILES = [AI_COMPUTE_MEMORY_PROFILE, EV_BATTERY_ENERGY_PROFILE] as const satisfies readonly AnchorResearchTargetProfile[];

export function listAnchorResearchTargetProfiles(): AnchorResearchTargetProfile[] {
  return ANCHOR_RESEARCH_TARGET_PROFILES.map(cloneAnchorResearchTargetProfile);
}

export function getAnchorResearchTargetProfile(profileId: ResearchTargetProfileId): AnchorResearchTargetProfile {
  const profile = ANCHOR_RESEARCH_TARGET_PROFILES.find((item) => item.profile_id === profileId);
  if (profile === undefined) throw new Error(`Unknown research target profile: ${profileId}`);
  return cloneAnchorResearchTargetProfile(profile);
}

export function selectResearchTargetProfile(input: {
  profile_id?: ResearchTargetProfileOption;
  company_id: string;
  component_ids: readonly string[];
}): ResearchTargetProfileSelection {
  if (input.profile_id === "none") return { profile: null, layer: "none", reason: "Research target profile disabled by caller." };
  if (input.profile_id !== undefined) {
    const profile = getAnchorResearchTargetProfile(input.profile_id);
    return { profile, layer: "anchor", reason: `Research target anchor explicitly selected: ${profile.profile_id}.` };
  }

  for (const profile of ANCHOR_RESEARCH_TARGET_PROFILES) {
    if (profile.applies_to_company_ids.includes(input.company_id)) {
      return {
        profile: cloneAnchorResearchTargetProfile(profile),
        layer: "anchor",
        reason: `Selected anchor ${profile.profile_id} because company ${input.company_id} is in scope.`
      };
    }
    if (input.component_ids.some((componentId) => profile.applies_to_component_ids.includes(componentId))) {
      return {
        profile: cloneAnchorResearchTargetProfile(profile),
        layer: "anchor",
        reason: `Selected anchor ${profile.profile_id} because at least one requested component is in scope.`
      };
    }
  }

  const profile = createDerivedProfilePlaceholder({
    company_id: input.company_id,
    component_ids: input.component_ids,
    reason: "No anchor research target profile matched this company/component scope; runtime derive is required."
  });
  return { profile, layer: "derived", reason: profile.derivation.reason };
}

function createDerivedProfilePlaceholder(input: { company_id: string; component_ids: readonly string[]; reason: string }): DerivedResearchTargetProfile {
  return {
    layer: "derived",
    profile_id: "derived.runtime.v0",
    version: "0.1.0",
    title: "Runtime derived research profile",
    description: "Session-scoped dynamic profile placeholder. D2 attaches llm-helper candidate output here; this placeholder never writes facts.",
    applies_to_company_ids: [input.company_id],
    applies_to_component_ids: [...input.component_ids],
    target_nodes: [],
    derivation: {
      status: "placeholder",
      company_id: input.company_id,
      component_ids: [...input.component_ids],
      reason: input.reason
    }
  };
}

function cloneAnchorResearchTargetProfile(profile: AnchorResearchTargetProfile): AnchorResearchTargetProfile {
  return {
    ...profile,
    applies_to_company_ids: [...profile.applies_to_company_ids],
    applies_to_component_ids: [...profile.applies_to_component_ids],
    target_nodes: profile.target_nodes.map((node) => ({
      ...node,
      ...(node.expected_source_ids === undefined ? {} : { expected_source_ids: [...node.expected_source_ids] }),
      ...(node.expected_source_targets === undefined
        ? {}
        : {
            expected_source_targets: node.expected_source_targets.map((target) => ({
              ...target,
              target_config: cloneTargetConfig(target.target_config)
            }))
          })
    }))
  };
}

function cloneTargetConfig(config: Record<string, string | number | boolean | string[]>): Record<string, string | number | boolean | string[]> {
  const cloned: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(config)) cloned[key] = Array.isArray(value) ? [...value] : value;
  return cloned;
}
