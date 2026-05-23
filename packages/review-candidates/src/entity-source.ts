import { createHash } from "node:crypto";
import { candidateAliases, type EntitySourceCandidate } from "@supplystrata/entity-source";
import type { EntitySourceReviewCandidate } from "./definitions.js";

export function buildEntitySourceReviewCandidate(input: { surface: string; candidate: EntitySourceCandidate }): EntitySourceReviewCandidate {
  const candidateKey = stableEntitySourceCandidateKey(input);
  const aliases = candidateAliases(input.candidate);
  const surface = input.surface.normalize("NFKC").trim().replace(/\s+/g, " ");
  const proposedAliases = aliases.some((alias) => alias.toLowerCase() === surface.toLowerCase()) ? aliases : [surface, ...aliases];
  return {
    review_id: stableEntitySourceReviewId(input.candidate, candidateKey),
    candidate_key: candidateKey,
    kind: "entity_source_candidate",
    title: `${surface} -> ${input.candidate.name}`,
    payload: {
      surface,
      proposed_entity_id: proposedEntityId(input.candidate),
      proposed_aliases: proposedAliases,
      candidate: input.candidate
    },
    evidence: {
      source_url: input.candidate.source_url,
      source_adapter_id: input.candidate.source_adapter_id,
      source_locator: `external_id ${input.candidate.external_id}`,
      source_row_text: input.candidate.provenance_note,
      normalized_record_text: `${surface} | ${input.candidate.name} | ${input.candidate.external_id}`
    },
    confidence: input.candidate.confidence,
    needs_review: true,
    review_reason: "外部登记源候选只用于实体解析补全，必须人工确认后才能写入 entity_master / entity_alias。"
  };
}

function stableEntitySourceCandidateKey(input: { surface: string; candidate: EntitySourceCandidate }): string {
  return [
    "entity-source",
    input.candidate.source_adapter_id,
    input.surface.normalize("NFKC").trim().toLowerCase(),
    input.candidate.external_id,
    input.candidate.name,
    input.candidate.jurisdiction_code ?? "",
    input.candidate.company_number ?? ""
  ].join("|");
}

function stableEntitySourceReviewId(candidate: EntitySourceCandidate, candidateKey: string): string {
  const readable = [candidate.source_adapter_id, candidate.name, candidate.jurisdiction_code ?? ""]
    .join("|")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 56);
  const digest = createHash("sha256").update(candidateKey).digest("hex").slice(0, 16);
  return `REV-ENTITY-${readable}-${digest}`;
}

function proposedEntityId(candidate: EntitySourceCandidate): string {
  const source = candidate.source_adapter_id === "companies-house" ? "CH" : "OC";
  const readable = [candidate.name, candidate.jurisdiction_code ?? "", candidate.company_number ?? candidate.external_id]
    .join("|")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 72);
  const digest = createHash("sha256").update(`${candidate.source_adapter_id}|${candidate.external_id}`).digest("hex").slice(0, 8).toUpperCase();
  return `ENT-${source}-${readable}-${digest}`;
}
