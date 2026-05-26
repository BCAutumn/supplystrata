import type { RelationType } from "@supplystrata/core";
import { componentIndustryTokens, type Gate1AdjacentOfficialFactEdge } from "./gate1-adjacent-official-facts.js";

export const ADJACENT_COMPANY_RANKING_MODEL_VERSION = "adjacent-company-ranking.v1";

export interface AdjacentCompanyCandidate {
  company_id: string;
  company_name: string;
  edge_count: number;
  max_evidence_level: number;
  max_confidence: number;
  component_relevance: number;
  upstream_role_edges: number;
  ranking_reason: string;
}

interface CandidateDraft {
  company_id: string;
  company_name: string;
  edge_count: number;
  max_evidence_level: number;
  max_confidence: number;
  component_relevance: number;
  upstream_role_edges: number;
}

export function rankAdjacentOfficialFactCompanyCandidates(input: {
  edges: readonly Gate1AdjacentOfficialFactEdge[];
  selected_company_id: string;
  component_id: string;
}): AdjacentCompanyCandidate[] {
  const candidates = candidateDrafts(input);
  const relevantCandidates = candidates.filter((candidate) => candidate.component_relevance > 0);
  const rankedCandidates = relevantCandidates.length > 0 ? relevantCandidates : candidates;
  return rankedCandidates.sort(compareAdjacentCompanyCandidate).map(candidateFromDraft);
}

function candidateDrafts(input: { edges: readonly Gate1AdjacentOfficialFactEdge[]; selected_company_id: string; component_id: string }): CandidateDraft[] {
  const candidates = new Map<string, CandidateDraft>();
  const componentTokens = componentIndustryTokens(input.component_id);
  for (const edge of input.edges) {
    addCandidateDraft(candidates, {
      company_id: edge.from_id,
      company_name: edge.from_name,
      company_industry: edge.from_industry,
      component_tokens: componentTokens,
      relation: edge.relation,
      side: "from",
      edge,
      selected_company_id: input.selected_company_id
    });
    addCandidateDraft(candidates, {
      company_id: edge.to_id,
      company_name: edge.to_name,
      company_industry: edge.to_industry,
      component_tokens: componentTokens,
      relation: edge.relation,
      side: "to",
      edge,
      selected_company_id: input.selected_company_id
    });
  }
  return [...candidates.values()];
}

function addCandidateDraft(
  candidates: Map<string, CandidateDraft>,
  input: {
    company_id: string;
    company_name: string;
    company_industry: readonly string[];
    component_tokens: readonly string[];
    relation: RelationType;
    side: "from" | "to";
    edge: Gate1AdjacentOfficialFactEdge;
    selected_company_id: string;
  }
): void {
  if (input.company_id.length === 0 || input.company_id === input.selected_company_id) return;
  const componentRelevance = componentRelevanceScore(input.company_industry, input.component_tokens);
  const upstreamRoleEdge = isLikelyUpstreamCounterparty(input.relation, input.side) ? 1 : 0;
  const existing = candidates.get(input.company_id);
  if (existing === undefined) {
    candidates.set(input.company_id, {
      company_id: input.company_id,
      company_name: input.company_name,
      edge_count: 1,
      max_evidence_level: input.edge.evidence_level,
      max_confidence: input.edge.confidence,
      component_relevance: componentRelevance,
      upstream_role_edges: upstreamRoleEdge
    });
    return;
  }
  candidates.set(input.company_id, {
    ...existing,
    edge_count: existing.edge_count + 1,
    max_evidence_level: Math.max(existing.max_evidence_level, input.edge.evidence_level),
    max_confidence: Math.max(existing.max_confidence, input.edge.confidence),
    component_relevance: Math.max(existing.component_relevance, componentRelevance),
    upstream_role_edges: existing.upstream_role_edges + upstreamRoleEdge
  });
}

function candidateFromDraft(candidate: CandidateDraft): AdjacentCompanyCandidate {
  return {
    ...candidate,
    ranking_reason: rankingReason(candidate)
  };
}

function compareAdjacentCompanyCandidate(left: CandidateDraft, right: CandidateDraft): number {
  if (right.component_relevance !== left.component_relevance) return right.component_relevance - left.component_relevance;
  if (right.upstream_role_edges !== left.upstream_role_edges) return right.upstream_role_edges - left.upstream_role_edges;
  if (right.max_evidence_level !== left.max_evidence_level) return right.max_evidence_level - left.max_evidence_level;
  if (right.max_confidence !== left.max_confidence) return right.max_confidence - left.max_confidence;
  if (right.edge_count !== left.edge_count) return right.edge_count - left.edge_count;
  return left.company_id.localeCompare(right.company_id);
}

function componentRelevanceScore(companyIndustry: readonly string[], componentTokens: readonly string[]): number {
  const industryTokens = new Set(companyIndustry.map((token) => token.toLowerCase()));
  return componentTokens.filter((token) => industryTokens.has(token)).length;
}

function isLikelyUpstreamCounterparty(relation: RelationType, side: "from" | "to"): boolean {
  if (relation === "SUPPLIES_TO") return side === "from";
  if (relation === "BUYS_FROM" || relation === "USES_FOUNDRY" || relation === "USES_COMPONENT" || relation === "MANUFACTURES_AT") return side === "to";
  return false;
}

function rankingReason(candidate: CandidateDraft): string {
  const parts = [
    `component_relevance=${candidate.component_relevance}`,
    `upstream_role_edges=${candidate.upstream_role_edges}`,
    `max_evidence_level=${candidate.max_evidence_level}`,
    `max_confidence=${candidate.max_confidence.toFixed(2)}`,
    `edge_count=${candidate.edge_count}`
  ];
  return parts.join("; ");
}
