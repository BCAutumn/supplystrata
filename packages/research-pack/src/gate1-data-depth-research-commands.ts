import type { Gate1DataDepthResearchContext } from "./gate1-data-depth-workbench-definitions.js";
import type { SupplyChainExpansionPlan } from "./supply-chain-expansion-plan.js";

export function researchRunCommand(input: {
  company_id: string;
  component_ids: readonly string[];
  research_context: Gate1DataDepthResearchContext | undefined;
  source_target_namespace: string;
  out_dir: string;
}): string {
  const depth = input.research_context?.depth ?? 3;
  const components = uniqueSorted(input.component_ids);
  const parts = ["pnpm --silent cli research run", `--company ${input.company_id}`];
  if (components.length > 0) parts.push(`--component ${components.join(",")}`);
  parts.push(`--depth ${depth}`, "--prepare-data");
  if (input.research_context?.research_target_profile_id !== undefined) parts.push(`--target-profile ${input.research_context.research_target_profile_id}`);
  if (input.research_context?.official_disclosure_year !== undefined) parts.push(`--official-year ${input.research_context.official_disclosure_year}`);
  parts.push(`--source-target-namespace ${input.source_target_namespace}`);
  parts.push(`--out ${input.out_dir}`);
  return parts.join(" ");
}

export function researchNamespace(companyId: string): string {
  return `research-${slugForCommand(companyId)}`;
}

export function researchOutDir(companyId: string, componentIds: readonly string[]): string {
  const componentSlug = uniqueSorted(componentIds)
    .map((componentId) => slugForCommand(componentId))
    .join("-");
  const suffix = componentSlug.length === 0 ? "" : `-${componentSlug}`;
  return `reports/${slugForCommand(companyId)}${suffix}-research-pack`;
}

export function focusedResearchComponents(componentIds: readonly string[]): string[] {
  const unique = uniqueSorted(componentIds);
  return unique.length <= 6 ? unique : [];
}

export function adjacentOfficialFactResearchCommand(
  companyId: string,
  componentId: string,
  researchContext: Gate1DataDepthResearchContext | undefined
): string {
  return researchRunCommand({
    company_id: companyId,
    component_ids: [componentId],
    research_context: researchContext,
    source_target_namespace: researchNamespace(companyId),
    out_dir: researchOutDir(companyId, [componentId])
  });
}

export function frontierResearchCommand(plan: SupplyChainExpansionPlan, researchContext: Gate1DataDepthResearchContext | undefined): string | null {
  const nextFrontier = plan.frontier.find((item) => item.expansion_state === "expand_candidate" && item.next_company_id !== null);
  if (nextFrontier?.next_company_id === undefined || nextFrontier.next_company_id === null) return null;
  const componentIds = nextFrontier.component_id === null ? [] : [nextFrontier.component_id];
  return researchRunCommand({
    company_id: nextFrontier.next_company_id,
    component_ids: componentIds,
    research_context: researchContext,
    source_target_namespace: researchNamespace(nextFrontier.next_company_id),
    out_dir: researchOutDir(nextFrontier.next_company_id, componentIds)
  });
}

function slugForCommand(value: string): string {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort((left, right) => left.localeCompare(right));
}
