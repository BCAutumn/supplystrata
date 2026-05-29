import { derive_dynamic_profile, type DeriveDynamicProfileInput, type DeriveDynamicProfileCandidate, type LlmHelperOptions } from "@supplystrata/llm-helpers";
import type {
  CandidateResearchTargetProfileDerivation,
  DerivedResearchTargetProfile,
  GenericResearchTargetProfileDerivation,
  ResearchTargetProfileOption,
  ResearchTargetProfileSelection
} from "./research-target-profile-definitions.js";
import { selectResearchTargetProfile } from "./research-target-profile-registry.js";

type GenericDeriveDynamicProfileCandidate = DeriveDynamicProfileCandidate & { status: GenericResearchTargetProfileDerivation["helper_status"] };

export interface DynamicResearchTargetProfileInput {
  profile_id?: ResearchTargetProfileOption;
  company_id: string;
  company_name: string;
  component_ids: readonly string[];
  public_description?: string;
  country_code?: string;
  sic_code?: string;
  naics_code?: string;
  filing_excerpt?: string;
  source_refs?: readonly string[];
  llm?: LlmHelperOptions;
}

export async function selectOrDeriveResearchTargetProfile(input: DynamicResearchTargetProfileInput): Promise<ResearchTargetProfileSelection> {
  const selection = selectResearchTargetProfile({
    ...(input.profile_id === undefined ? {} : { profile_id: input.profile_id }),
    company_id: input.company_id,
    component_ids: input.component_ids
  });
  if (selection.layer !== "derived") return selection;

  // Derived profile 是单次计划上下文；这里不写库、不缓存，也不把 LLM candidate 升格成事实。
  const candidate = await derive_dynamic_profile(helperInput(input), input.llm);
  if (!isGenericDeriveDynamicProfileCandidate(candidate)) {
    const profile = createCandidateDerivedProfile(input, candidate);
    return { profile, layer: "derived", reason: profile.derivation.reason };
  }
  const profile = createGenericDerivedProfile(input, candidate);
  return { profile, layer: "derived", reason: profile.derivation.reason };
}

function helperInput(input: DynamicResearchTargetProfileInput): DeriveDynamicProfileInput {
  return {
    company_id: input.company_id,
    company_name: input.company_name,
    ...(input.public_description === undefined ? {} : { public_description: input.public_description }),
    ...(input.sic_code === undefined ? {} : { sic_code: input.sic_code }),
    ...(input.naics_code === undefined ? {} : { naics_code: input.naics_code }),
    ...(input.filing_excerpt === undefined ? {} : { filing_excerpt: input.filing_excerpt }),
    ...(input.source_refs === undefined ? {} : { source_refs: [...input.source_refs] })
  };
}

function createCandidateDerivedProfile(input: DynamicResearchTargetProfileInput, candidate: DeriveDynamicProfileCandidate): DerivedResearchTargetProfile {
  const componentIds = derivedComponentIds(input.component_ids, candidate.expected_upstream_components);
  const derivation: CandidateResearchTargetProfileDerivation = {
    status: "candidate",
    company_id: input.company_id,
    component_ids: componentIds,
    source_refs: [...(input.source_refs ?? [])],
    helper_status: "candidate",
    confidence: candidate.confidence,
    rationale: candidate.rationale,
    citations: candidate.citations.map((citation) => ({ ...citation })),
    expected_upstream_components: candidate.expected_upstream_components.map((component) => ({ ...component })),
    source_targets: candidate.source_targets.map((target) => ({ ...target })),
    fact_write_allowed: false,
    reason: `Derived runtime profile from llm-helper candidate for ${input.company_id}.`
  };
  return {
    layer: "derived",
    profile_id: "derived.runtime.v0",
    version: "0.1.0",
    title: "Runtime derived research profile",
    description: "Session-scoped dynamic profile candidate. It may guide source planning, but cannot write facts.",
    applies_to_company_ids: [input.company_id],
    applies_to_component_ids: componentIds,
    target_nodes: [],
    derivation
  };
}

function createGenericDerivedProfile(input: DynamicResearchTargetProfileInput, candidate: GenericDeriveDynamicProfileCandidate): DerivedResearchTargetProfile {
  const derivation: GenericResearchTargetProfileDerivation = {
    status: "generic",
    company_id: input.company_id,
    component_ids: [...input.component_ids],
    ...(input.country_code === undefined ? {} : { country_code: input.country_code }),
    ...(input.sic_code === undefined ? {} : { sic_code: input.sic_code }),
    ...(input.naics_code === undefined ? {} : { naics_code: input.naics_code }),
    source_refs: [...(input.source_refs ?? [])],
    helper_status: candidate.status,
    confidence: candidate.confidence,
    rationale: candidate.rationale,
    citations: candidate.citations.map((citation) => ({ ...citation })),
    expected_upstream_components: [],
    source_targets: [],
    fact_write_allowed: false,
    reason: `Fell back to generic runtime profile for ${input.company_id}; llm-helper returned ${candidate.status}.`
  };
  return {
    layer: "derived",
    profile_id: "derived.runtime.v0",
    version: "0.1.0",
    title: "Generic runtime research profile",
    description: "Session-scoped generic profile using only deterministic routing context such as country, SIC, and NAICS.",
    applies_to_company_ids: [input.company_id],
    applies_to_component_ids: [...input.component_ids],
    target_nodes: [],
    derivation
  };
}

function derivedComponentIds(existingComponentIds: readonly string[], components: DeriveDynamicProfileCandidate["expected_upstream_components"]): string[] {
  return [...new Set([...existingComponentIds, ...components.flatMap((component) => (component.component_id === undefined ? [] : [component.component_id]))])];
}

function isGenericDeriveDynamicProfileCandidate(candidate: DeriveDynamicProfileCandidate): candidate is GenericDeriveDynamicProfileCandidate {
  return candidate.status !== "candidate";
}
