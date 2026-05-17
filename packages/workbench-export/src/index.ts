import {
  getClaim,
  getEvidence,
  listChangeTimeline,
  listUnknownItems,
  resolveEntityId,
  type ChangeTimelineItem,
  type ClaimRow,
  type DbClient,
  type EvidenceDetailRow,
  type UnknownItemRow
} from "@supplystrata/db";
import { buildCompanyChainView, type ChainViewModel, type ChainViewSegmentModel } from "@supplystrata/chain-view";
import { listSourceHealthRows, type SourceHealthRow } from "@supplystrata/source-monitor";
import { RELATION_TYPES, type EvidenceLevel, type RelationType } from "@supplystrata/core";

export interface WorkbenchExportInput {
  company: string;
  depth?: number;
  since?: string;
  changeLimit?: number;
  sourceLimit?: number;
}

export interface WorkbenchCompanyNode {
  entity_id: string;
  name: string;
  role: "root" | "counterparty";
}

export interface WorkbenchEdge {
  edge_id: string;
  from_id: string;
  from_name: string;
  to_id: string;
  to_name: string;
  relation: RelationType;
  component: string | null;
  component_id: string | null;
  evidence_level: EvidenceLevel;
  confidence: number;
  evidence_ids: string[];
}

export interface WorkbenchModel {
  schema_version: "1.0.0";
  generated_at: string;
  selected_company_id: string;
  companies: WorkbenchCompanyNode[];
  chain: ChainViewModel;
  chain_segments: ChainViewSegmentModel[];
  edges: WorkbenchEdge[];
  upstream_edges: WorkbenchEdge[];
  downstream_edges: WorkbenchEdge[];
  claims: ClaimRow[];
  evidences: EvidenceDetailRow[];
  unknown_items: UnknownItemRow[];
  sources: SourceHealthRow[];
  changes: ChangeTimelineItem[];
}

export async function buildWorkbenchModel(client: DbClient, input: WorkbenchExportInput): Promise<WorkbenchModel> {
  const rootEntityId = await resolveEntityId(client, input.company);
  const chain = await buildCompanyChainView(client, { query: rootEntityId, depth: input.depth ?? 2, generated_by: "workbench-export.v1" });
  const edgeSegments = chain.segments.filter(isEdgeSegment);
  const edges = edgeSegments.map(workbenchEdgeFromSegment);
  const claimIds = uniqueStrings(chain.segments.flatMap((segment) => (segment.claim_id === undefined ? [] : [segment.claim_id])));
  const evidenceIds = uniqueStrings(chain.segments.flatMap((segment) => segment.evidence_ids));
  const claims = await loadClaims(client, claimIds);
  const evidences = await loadEvidences(client, evidenceIds);
  const unknownItems = await listUnknownItems(client, rootEntityId);
  const sources = (await listSourceHealthRows(client)).slice(0, input.sourceLimit ?? 50);
  const changes = await listChangeTimeline(client, {
    since: input.since ?? defaultSince(30),
    limit: input.changeLimit ?? 50,
    scope: { kind: "company", id: rootEntityId }
  });

  return {
    schema_version: "1.0.0",
    generated_at: new Date().toISOString(),
    selected_company_id: rootEntityId,
    companies: companiesFromChain(chain, rootEntityId),
    chain,
    chain_segments: chain.segments,
    edges,
    upstream_edges: edges,
    downstream_edges: [],
    claims,
    evidences,
    unknown_items: unknownItems,
    sources,
    changes
  };
}

export function workbenchEdgeFromSegment(segment: ChainViewSegmentModel): WorkbenchEdge {
  if (!isEdgeSegment(segment)) throw new Error(`Segment is not a fact edge: ${segment.sequence_index}`);
  return {
    edge_id: segment.edge_id,
    from_id: segment.from.id,
    from_name: segment.from.name,
    to_id: segment.to.id,
    to_name: segment.to.name,
    relation: segment.relation,
    component: segment.component,
    component_id: segment.component_id,
    evidence_level: segment.evidence_level,
    confidence: segment.confidence,
    evidence_ids: segment.evidence_ids
  };
}

function isEdgeSegment(
  segment: ChainViewSegmentModel
): segment is ChainViewSegmentModel & { edge_id: string; evidence_level: EvidenceLevel; relation: RelationType } {
  return segment.semantic_layer === "edge" && segment.edge_id !== undefined && segment.evidence_level !== undefined && isRelationType(segment.relation);
}

function isRelationType(value: string): value is RelationType {
  for (const relationType of RELATION_TYPES) {
    if (value === relationType) return true;
  }
  return false;
}

function companiesFromChain(chain: ChainViewModel, rootEntityId: string): WorkbenchCompanyNode[] {
  const byId = new Map<string, WorkbenchCompanyNode>();
  byId.set(chain.root.id, { entity_id: chain.root.id, name: chain.root.name, role: "root" });
  for (const segment of chain.segments) {
    addCompanyEndpoint(byId, segment.from, rootEntityId);
    addCompanyEndpoint(byId, segment.to, rootEntityId);
  }
  return [...byId.values()].sort((left, right) => roleOrder(left.role) - roleOrder(right.role) || left.name.localeCompare(right.name));
}

function addCompanyEndpoint(byId: Map<string, WorkbenchCompanyNode>, endpoint: { kind: string; id: string; name: string }, rootEntityId: string): void {
  if (endpoint.kind !== "company") return;
  if (byId.has(endpoint.id)) return;
  byId.set(endpoint.id, { entity_id: endpoint.id, name: endpoint.name, role: endpoint.id === rootEntityId ? "root" : "counterparty" });
}

function roleOrder(role: WorkbenchCompanyNode["role"]): number {
  return role === "root" ? 0 : 1;
}

async function loadClaims(client: DbClient, claimIds: readonly string[]): Promise<ClaimRow[]> {
  const claims: ClaimRow[] = [];
  for (const claimId of claimIds) {
    const claim = await getClaim(client, claimId);
    if (claim !== undefined) claims.push(claim);
  }
  return claims;
}

async function loadEvidences(client: DbClient, evidenceIds: readonly string[]): Promise<EvidenceDetailRow[]> {
  const evidences: EvidenceDetailRow[] = [];
  for (const evidenceId of evidenceIds) {
    const evidence = await getEvidence(client, evidenceId);
    if (evidence !== undefined) evidences.push(evidence);
  }
  return evidences;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function defaultSince(daysBack: number): string {
  return new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
}
