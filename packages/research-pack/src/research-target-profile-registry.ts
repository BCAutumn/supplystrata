import { AI_COMPUTE_MEMORY_PROFILE } from "./research-target-profile-ai-compute-memory.js";
import type {
  ResearchTargetProfile,
  ResearchTargetProfileId,
  ResearchTargetProfileOption,
  ResearchTargetProfileSelection
} from "./research-target-profile-definitions.js";

const BUILT_IN_RESEARCH_TARGET_PROFILES = [AI_COMPUTE_MEMORY_PROFILE] as const satisfies readonly ResearchTargetProfile[];

export function listBuiltInResearchTargetProfiles(): ResearchTargetProfile[] {
  return BUILT_IN_RESEARCH_TARGET_PROFILES.map(cloneResearchTargetProfile);
}

export function getBuiltInResearchTargetProfile(profileId: ResearchTargetProfileId): ResearchTargetProfile {
  const profile = BUILT_IN_RESEARCH_TARGET_PROFILES.find((item) => item.profile_id === profileId);
  if (profile === undefined) throw new Error(`Unknown research target profile: ${profileId}`);
  return cloneResearchTargetProfile(profile);
}

export function selectResearchTargetProfile(input: {
  profile_id?: ResearchTargetProfileOption;
  company_id: string;
  component_ids: readonly string[];
}): ResearchTargetProfileSelection {
  if (input.profile_id === "none") return { profile: null, reason: "Research target profile disabled by caller." };
  if (input.profile_id !== undefined) {
    const profile = getBuiltInResearchTargetProfile(input.profile_id);
    return { profile, reason: `Research target profile explicitly selected: ${profile.profile_id}.` };
  }

  for (const profile of BUILT_IN_RESEARCH_TARGET_PROFILES) {
    if (profile.applies_to_company_ids.includes(input.company_id)) {
      return { profile: cloneResearchTargetProfile(profile), reason: `Selected ${profile.profile_id} because company ${input.company_id} is in scope.` };
    }
    if (input.component_ids.some((componentId) => profile.applies_to_component_ids.includes(componentId))) {
      return {
        profile: cloneResearchTargetProfile(profile),
        reason: `Selected ${profile.profile_id} because at least one requested component is in scope.`
      };
    }
  }

  return { profile: null, reason: "No built-in research target profile matched this company/component scope." };
}

function cloneResearchTargetProfile(profile: ResearchTargetProfile): ResearchTargetProfile {
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
