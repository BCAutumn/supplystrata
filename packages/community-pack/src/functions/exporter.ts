import type { ScbomDocument } from "@scbom/spec";
import { toScbomDocument, type WorkbenchEdge, type WorkbenchEvidence, type WorkbenchModel } from "@supplystrata/workbench-export";
import {
  COMMUNITY_PACK_CANONICAL_FORMAT,
  COMMUNITY_PACK_MANIFEST_SCHEMA_VERSION,
  COMMUNITY_PACK_SCBOM_SCHEMA_VERSION,
  COMMUNITY_PACK_SHA256_ALGORITHM
} from "../definitions/manifest.js";
import type { CommunityPackBuildInput, CommunityPackBuildResult, CommunityPackEligibilitySummary } from "../definitions/exporter.js";
import { assertCommunityPackFileIntegrity, assertCommunityPackManifest, manifestFileForScbomJsonl, manifestTotals } from "./manifest.js";

const DEFAULT_DATA_FILE_PATH = "scbom/companies.jsonl";
const MIN_PUBLISH_EVIDENCE_LEVEL = 4;

export function buildCommunityPack(input: CommunityPackBuildInput): CommunityPackBuildResult {
  const documents = input.workbenchModels.flatMap((model) => {
    const document = publishEligibleScbomDocument(model);
    return document === undefined ? [] : [document];
  });
  const content = documents.map((document) => JSON.stringify(document)).join("\n");
  const jsonl = content.length === 0 ? "" : `${content}\n`;
  const file = manifestFileForScbomJsonl({ path: input.dataFilePath ?? DEFAULT_DATA_FILE_PATH, content: jsonl });

  const result: CommunityPackBuildResult = {
    manifest: {
      schema_version: COMMUNITY_PACK_MANIFEST_SCHEMA_VERSION,
      pack_version: input.packVersion,
      generated_at: input.generatedAt,
      canonical_format: COMMUNITY_PACK_CANONICAL_FORMAT,
      scbom_schema_version: COMMUNITY_PACK_SCBOM_SCHEMA_VERSION,
      license: input.license,
      source_instance: {
        fingerprint: input.sourceInstanceFingerprint
      },
      integrity: {
        algorithm: COMMUNITY_PACK_SHA256_ALGORITHM
      },
      files: [file],
      totals: manifestTotals([file])
    },
    files: [{ path: file.path, content: jsonl }]
  };
  assertCommunityPackManifest(result.manifest);
  assertCommunityPackFileIntegrity(result.manifest, result.files);
  return result;
}

export function summarizeCommunityPackEligibility(input: readonly WorkbenchModel[]): CommunityPackEligibilitySummary {
  const documents = input.flatMap((model) => {
    const document = publishEligibleScbomDocument(model);
    return document === undefined ? [] : [document];
  });
  return {
    input_documents: input.length,
    exported_documents: documents.length,
    exported_relationships: documents.reduce((count, document) => count + document.objects.filter((object) => object.object_type === "relationship").length, 0)
  };
}

export function publishEligibleScbomDocument(model: WorkbenchModel): ScbomDocument | undefined {
  const eligibleEvidenceIds = new Set(model.evidences.filter(isPublishEligibleEvidence).map((evidence) => evidence.evidence_id));
  const edges = publishEligibleEdges(model.edges, eligibleEvidenceIds);
  if (edges.length === 0) return undefined;

  const edgeIds = new Set(edges.map((edge) => edge.edge_id));
  const evidenceIds = new Set(edges.flatMap((edge) => edge.evidence_ids));
  const companyIds = new Set<string>([model.selected_company_id, model.chain.root.id]);
  for (const edge of edges) {
    companyIds.add(edge.from_id);
    companyIds.add(edge.to_id);
  }

  const chainSegments = model.chain_segments
    .filter((segment) => segment.semantic_layer === "edge" && segment.edge_id !== undefined && edgeIds.has(segment.edge_id))
    .map((segment) => ({ ...segment, evidence_ids: segment.evidence_ids.filter((evidenceId) => evidenceIds.has(evidenceId)) }));
  const chain = {
    ...model.chain,
    segments: chainSegments,
    stats: {
      fact_edges: chainSegments.length,
      claims: 0,
      observations: 0,
      leads: 0,
      unknowns: 0
    }
  };

  return toScbomDocument({
    ...model,
    companies: model.companies.filter((company) => companyIds.has(company.entity_id)),
    chain,
    chain_segments: chainSegments,
    edges,
    upstream_edges: publishEligibleEdges(model.upstream_edges, eligibleEvidenceIds),
    downstream_edges: publishEligibleEdges(model.downstream_edges, eligibleEvidenceIds),
    claims: [],
    draft_claims: [],
    evidences: model.evidences.filter((evidence) => evidenceIds.has(evidence.evidence_id)),
    unknown_items: [],
    changes: [],
    attention_queue: [],
    review_queue: [],
    intelligence: {
      edge_strengths: [],
      edge_freshness: []
    }
  });
}

function publishEligibleEdges(edges: readonly WorkbenchEdge[], eligibleEvidenceIds: ReadonlySet<string>): WorkbenchEdge[] {
  return edges.flatMap((edge) => {
    if (edge.evidence_level < MIN_PUBLISH_EVIDENCE_LEVEL) return [];
    const evidenceIds = uniqueStrings(edge.evidence_ids.filter((evidenceId) => eligibleEvidenceIds.has(evidenceId)));
    if (evidenceIds.length === 0) return [];
    return [{ ...edge, evidence_ids: evidenceIds }];
  });
}

function isPublishEligibleEvidence(evidence: WorkbenchEvidence): boolean {
  return evidence.evidence_level >= MIN_PUBLISH_EVIDENCE_LEVEL && evidence.extraction_method === "rule" && !evidence.is_inferred;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
