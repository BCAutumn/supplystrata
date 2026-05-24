import type pg from "pg";
import { describe, expect, it } from "vitest";
import {
  adjudicateClaimConflict,
  buildClaimConflictContext,
  buildClaimConflictReviewPacket,
  buildClaimDraftFromEdge,
  buildClaimDraftFromSemanticChangeReview,
  buildEdgeClaimsFromCurrentEdges,
  claimTypeForRelation,
  deterministicConflictUnknownIdForClaimEvidence,
  deterministicConflictUnknownIdForSemanticReview,
  deterministicClaimIdForEdge,
  deterministicClaimIdForSemanticReview,
  enqueueClaimConflictReviewCandidates,
  fuseClaimConfidenceFromEvidence,
  isConflictingSemanticChange,
  linkContradictingEvidenceToClaim,
  resolveClaimConflictReview,
  resolveClaimLifecycle,
  resolveClaimConflictUnknown,
  upsertSemanticChangeClaimDraft,
  type ClaimableFactEdge,
  type ClaimFusionEvidence
} from "@supplystrata/claim-builder";
import { dbTxClientBrand, type DbTxClient } from "@supplystrata/db/write";
import { buildSemanticChangeReviewCandidate } from "@supplystrata/review-candidates";

interface QueryCall {
  sql: string;
  params: readonly unknown[];
}

interface ReviewCandidateBatchTestRow {
  kind: string;
  doc_id: string | null;
  source_adapter_id: string;
  candidate: unknown;
}

class EmptyDbClient implements DbTxClient {
  readonly [dbTxClientBrand]: true = true;
  readonly calls: QueryCall[] = [];

  async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    return {
      command: "MOCK",
      rowCount: 0,
      oid: 0,
      fields: [],
      rows: rowsForClaimBuilder<T>(sql, params)
    };
  }
}

class ClaimFusionDbClient extends EmptyDbClient {
  constructor(
    private readonly edges: ClaimableFactEdge[],
    private readonly evidences: ClaimFusionEvidence[]
  ) {
    super();
  }

  override async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    if (sql.includes("FROM edges e")) {
      return mockResult(this.edges as unknown as T[]);
    }
    if (sql.includes("FROM evidence ev")) {
      return mockResult(this.evidences as unknown as T[]);
    }
    return {
      command: "MOCK",
      rowCount: 0,
      oid: 0,
      fields: [],
      rows: rowsForClaimBuilder<T>(sql, params)
    };
  }
}

class SemanticConflictDbClient extends EmptyDbClient {
  override async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    if (sql.includes("SELECT entity_id FROM entity_master") && params[0] === "nvidia") {
      return mockResult([{ entity_id: "ENT-NVIDIA" }] as unknown as T[]);
    }
    if (sql.includes("SELECT entity_id FROM entity_master") && params[0] === "tsmc") {
      return mockResult([{ entity_id: "ENT-TSMC" }] as unknown as T[]);
    }
    if (sql.includes("RETURNING claim_id, (xmax = 0) AS inserted") && typeof params[0] === "string") {
      return mockResult([{ claim_id: params[0], inserted: true }] as unknown as T[]);
    }
    if (sql.includes("FROM claims c") && sql.includes("JOIN edges e")) {
      return mockResult([{ claim_id: "CLM-ACTIVE-TSMC", edge_id: "EDGE-TSMC" }] as unknown as T[]);
    }
    if (sql.includes("RETURNING unknown_id, (xmax = 0) AS inserted, status, scope_kind, scope_id, question") && typeof params[0] === "string") {
      return mockResult(unknownUpsertRows<T>(params));
    }
    return mockResult([]);
  }
}

class ClaimConflictMaintenanceDbClient extends EmptyDbClient {
  override async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    if (sql.includes("FROM claims") && sql.includes("WHERE claim_id = $1")) {
      return mockResult([
        {
          claim_id: "CLM-ACTIVE-TSMC",
          claim_text: "NVIDIA publicly discloses that it buys wafer from TSMC.",
          status: "active",
          edge_id: "EDGE-TSMC"
        }
      ] as unknown as T[]);
    }
    if (sql.includes("FROM evidence ev") && sql.includes("WHERE ev.evidence_id = $1")) {
      return mockResult([
        {
          evidence_id: "EV-CONTRA",
          doc_id: "DOC-COUNTERPARTY",
          cite_locator: "Annual report p. 12",
          source_adapter_id: "tsmc-ir",
          document_type: "annual_report"
        }
      ] as unknown as T[]);
    }
    if (sql.includes("RETURNING unknown_id, (xmax = 0) AS inserted, status, scope_kind, scope_id, question") && typeof params[0] === "string") {
      return mockResult(unknownUpsertRows<T>(params));
    }
    if (sql.includes("FROM claim_unknowns")) {
      return mockResult([{ claim_id: "CLM-ACTIVE-TSMC" }] as unknown as T[]);
    }
    if (sql.includes("UPDATE unknown_items")) {
      return mockResult([{ unknown_id: params[0] }] as unknown as T[]);
    }
    return mockResult([]);
  }
}

class ClaimConflictReviewQueueDbClient extends EmptyDbClient {
  override async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    if (sql.includes("FROM claims c") && sql.includes("claim_evidence ce") && sql.includes("unknown_items ui")) {
      return mockResult([
        {
          claim_id: "CLM-ACTIVE-TSMC",
          claim_text: "NVIDIA publicly discloses that it buys wafer from TSMC.",
          status: "active",
          edge_id: "EDGE-TSMC"
        }
      ] as unknown as T[]);
    }
    if (sql.includes("FROM claim_evidence") && sql.includes("WHERE claim_id = $1")) {
      return mockResult([
        { claim_id: "CLM-ACTIVE-TSMC", evidence_id: "EV-PRIMARY", role: "primary" },
        { claim_id: "CLM-ACTIVE-TSMC", evidence_id: "EV-CONTRA", role: "contradicting" }
      ] as unknown as T[]);
    }
    if (sql.includes("FROM claim_unknowns cu") && sql.includes("JOIN unknown_items ui")) {
      return mockResult([{ claim_id: "CLM-ACTIVE-TSMC", unknown_id: "UNK-CONFLICT", role: "blocking", status: "open" }] as unknown as T[]);
    }
    if (sql.includes("INSERT INTO review_candidates")) {
      return mockResult([{ inserted: "1", total: "1" }] as unknown as T[]);
    }
    return mockResult([]);
  }
}

class ClaimLifecycleDbClient extends EmptyDbClient {
  override async query<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql, params });
    if (sql.includes("FROM claims c") && sql.includes("WHERE c.claim_id = $1")) {
      if (params[0] === "CLM-REPLACEMENT") {
        return mockResult([
          {
            claim_id: "CLM-REPLACEMENT",
            claim_text: "NVIDIA publicly discloses a narrower reviewed relation.",
            status: "active",
            edge_id: "EDGE-REPLACEMENT",
            edge_validity: "current",
            edge_deprecated_reason: null,
            edge_superseded_by_edge_id: null
          }
        ] as unknown as T[]);
      }
      return mockResult([
        {
          claim_id: "CLM-STALE-EDGE",
          claim_text: "NVIDIA publicly discloses that it buys memory from SK Hynix.",
          status: "active",
          edge_id: "EDGE-DEPRECATED",
          edge_validity: "deprecated",
          edge_deprecated_reason: "Reviewed counterparty disclosure contradicted the edge.",
          edge_superseded_by_edge_id: "EDGE-REPLACEMENT"
        }
      ] as unknown as T[]);
    }
    if (sql.includes("SELECT evidence_id AS id FROM evidence")) {
      return mockResult([{ id: "EV-CONTRA" }] as unknown as T[]);
    }
    if (sql.includes("SELECT claim_id AS id FROM claims")) {
      return mockResult([{ id: "CLM-REPLACEMENT" }] as unknown as T[]);
    }
    if (sql.includes("UPDATE claims")) {
      return mockResult([{ claim_id: params[0], status: params[1] }] as unknown as T[]);
    }
    return mockResult([]);
  }
}

describe("claim-builder", () => {
  it("creates stable claim drafts from current fact edges", () => {
    const edge: ClaimableFactEdge = {
      edge_id: "EDGE-1",
      subject_id: "ENT-NVIDIA",
      object_id: "ENT-SK-HYNIX",
      relation: "BUYS_FROM",
      component: "memory",
      component_id: "COMP-MEMORY",
      evidence_level: 5,
      confidence: 0.93,
      is_inferred: false,
      primary_evidence_id: "EV-1",
      last_verified_at: new Date("2026-01-01T00:00:00.000Z"),
      subject_name: "NVIDIA",
      object_name: "SK hynix"
    };

    const draft = buildClaimDraftFromEdge(edge, { generated_by: "unit-test" });

    expect(draft.claim_id).toBe(deterministicClaimIdForEdge("EDGE-1"));
    expect(draft.claim_type).toBe("SUPPLY_RELATION_CLAIM");
    expect(draft.claim_text).toBe("NVIDIA publicly discloses that it buys memory from SK hynix.");
    expect(draft.evidence_id).toBe("EV-1");
    expect(draft.is_inferred).toBe(false);
    expect(draft.last_verified_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("does not create active fact claims from inferred edges", () => {
    const edge: ClaimableFactEdge = {
      edge_id: "EDGE-INF",
      subject_id: "ENT-NVIDIA",
      object_id: "ENT-TSMC",
      relation: "USES_FOUNDRY",
      component: "GPU wafer fabrication",
      component_id: "COMP-WAFER",
      evidence_level: 4,
      confidence: 0.78,
      is_inferred: true,
      primary_evidence_id: "EV-INF",
      last_verified_at: "2026-01-01T00:00:00.000Z",
      subject_name: "NVIDIA",
      object_name: "TSMC"
    };

    expect(() => buildClaimDraftFromEdge(edge)).toThrow(/inferred edge/);
  });

  it("maps relation types without creating new relation semantics", () => {
    expect(claimTypeForRelation("MANUFACTURES_AT")).toBe("FACILITY_RELATION_CLAIM");
    expect(claimTypeForRelation("USES_COMPONENT")).toBe("COMPONENT_EXPOSURE_CLAIM");
    expect(claimTypeForRelation("OWNS_SUBSIDIARY")).toBe("ENTITY_FACT_CLAIM");
    expect(claimTypeForRelation("BUYS_FROM")).toBe("SUPPLY_RELATION_CLAIM");
  });

  it("adjudicates active fact claim conflicts without mutating fact edges", () => {
    const result = adjudicateClaimConflict({
      claim_status: "active",
      edge_id: "EDGE-TSMC",
      evidence_refs: [
        { evidence_id: "EV-PRIMARY", role: "primary" },
        { evidence_id: "EV-CONTRA", role: "contradicting" }
      ],
      unknown_refs: [{ unknown_id: "UNK-CONFLICT", role: "blocking", status: "open" }]
    });

    expect(result).toEqual({
      state: "open_conflict",
      severity: "high",
      recommended_action: "review_edge_for_deprecation",
      edge_review_required: true,
      allowed_edge_mutation: "none",
      reason_codes: ["open_conflict_unknown", "contradicting_evidence_linked", "active_fact_claim"]
    });
  });

  it("adjudicates resolved claim conflicts as retained context", () => {
    const result = adjudicateClaimConflict({
      claim_status: "active",
      edge_id: "EDGE-TSMC",
      evidence_refs: [
        { evidence_id: "EV-PRIMARY", role: "primary" },
        { evidence_id: "EV-CONTRA", role: "contradicting" }
      ],
      unknown_refs: [{ unknown_id: "UNK-CONFLICT", role: "blocking", status: "resolved" }]
    });

    expect(result).toEqual({
      state: "resolved_conflict",
      severity: "low",
      recommended_action: "keep_resolved_context",
      edge_review_required: false,
      allowed_edge_mutation: "none",
      reason_codes: ["contradicting_evidence_linked", "conflict_unknown_resolved", "active_fact_claim"]
    });
  });

  it("builds safe-write review packets for unresolved source disagreement", () => {
    const packet = buildClaimConflictReviewPacket({
      claim_id: "CLM-ACTIVE-TSMC",
      claim_text: "NVIDIA publicly discloses that it buys wafer from TSMC.",
      claim_status: "active",
      edge_id: "EDGE-TSMC",
      evidence_refs: [
        { evidence_id: "EV-PRIMARY", role: "primary" },
        { evidence_id: "EV-CONTRA", role: "contradicting" }
      ],
      unknown_refs: [{ unknown_id: "UNK-CONFLICT", role: "blocking", status: "open" }]
    });

    expect(packet).toEqual({
      claim_id: "CLM-ACTIVE-TSMC",
      claim_text: "NVIDIA publicly discloses that it buys wafer from TSMC.",
      conflict_state: "open_conflict",
      severity: "high",
      recommended_action: "review_edge_for_deprecation",
      review_queue_kind: "claim_conflict_review",
      safe_write_status: "blocked_pending_review",
      edge_review_required: true,
      required_review_steps: ["inspect_supporting_evidence", "inspect_contradicting_evidence", "resolve_conflict_unknown", "review_fact_edge_for_deprecation"],
      evidence_refs: [
        { evidence_id: "EV-PRIMARY", role: "primary" },
        { evidence_id: "EV-CONTRA", role: "contradicting" }
      ],
      unknown_refs: [{ unknown_id: "UNK-CONFLICT", role: "blocking", status: "open" }],
      fact_write_policy: {
        automatic_fact_mutation_allowed: false,
        allowed_edge_mutation: "none",
        requires_human_review: true,
        reason_codes: ["open_conflict_unknown", "contradicting_evidence_linked", "active_fact_claim"]
      }
    });
  });

  it("builds claim conflict context through one claim-builder contract", () => {
    const context = buildClaimConflictContext({
      claim_id: "CLM-ACTIVE-TSMC",
      claim_text: "NVIDIA publicly discloses that it buys wafer from TSMC.",
      claim_status: "active",
      edge_id: "EDGE-TSMC",
      evidence_refs: [
        { evidence_id: "EV-PRIMARY", role: "primary" },
        { evidence_id: "EV-CONTRA", role: "contradicting" }
      ],
      unknown_refs: [{ unknown_id: "UNK-CONFLICT", role: "blocking", status: "open" }]
    });

    expect(context.conflict_state).toBe(context.adjudication.state);
    expect(context.review_packet.conflict_state).toBe(context.adjudication.state);
    expect(context.review_packet.fact_write_policy.reason_codes).toEqual(context.adjudication.reason_codes);
  });

  it("builds no-op safe-write packets when claims have no disagreement", () => {
    const packet = buildClaimConflictReviewPacket({
      claim_id: "CLM-CLEAN",
      claim_text: "NVIDIA publicly discloses that it buys memory from SK hynix.",
      claim_status: "active",
      edge_id: "EDGE-CLEAN",
      evidence_refs: [{ evidence_id: "EV-PRIMARY", role: "primary" }],
      unknown_refs: []
    });

    expect(packet.review_queue_kind).toBe("none");
    expect(packet.safe_write_status).toBe("none");
    expect(packet.required_review_steps).toEqual([]);
    expect(packet.fact_write_policy).toEqual({
      automatic_fact_mutation_allowed: false,
      allowed_edge_mutation: "none",
      requires_human_review: false,
      reason_codes: []
    });
  });

  it("enqueues unresolved claim conflicts into the review queue without mutating facts", async () => {
    const client = new ClaimConflictReviewQueueDbClient();

    const summary = await enqueueClaimConflictReviewCandidates(client, { limit: 10 });

    expect(summary).toEqual({ scanned: 1, enqueued: 1, skipped: 0 });
    const enqueueCall = client.calls.find((call) => call.sql.includes("INSERT INTO review_candidates"));
    const [candidate] = reviewCandidateBatchRows(enqueueCall);
    expect(candidate?.kind).toBe("claim_conflict_review");
    expect(candidate?.doc_id).toBeNull();
    expect(candidate?.source_adapter_id).toBe("claim-builder");
    expect(candidate?.candidate).toMatchObject({
      kind: "claim_conflict_review",
      payload: {
        claim_id: "CLM-ACTIVE-TSMC",
        edge_id: "EDGE-TSMC",
        safe_write_status: "blocked_pending_review",
        fact_write_policy: {
          automatic_fact_mutation_allowed: false,
          allowed_edge_mutation: "none"
        }
      }
    });
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO edges") || call.sql.includes("UPDATE edges"))).toBe(false);
  });

  it("scans only current non-inferred edges with primary evidence", async () => {
    const client = new EmptyDbClient();

    const summary = await buildEdgeClaimsFromCurrentEdges(client, { min_evidence_level: 5, limit: 25, generated_by: "unit-test" });

    expect(summary).toEqual({ scanned: 0, inserted: 0, updated: 0, generated_by: "unit-test" });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.sql).toContain("e.validity = 'current'");
    expect(client.calls[0]?.sql).toContain("e.is_inferred = false");
    expect(client.calls[0]?.sql).toContain("e.primary_evidence_id IS NOT NULL");
    expect(client.calls[0]?.params).toEqual([5, 25]);
  });

  it("fuses claim confidence deterministically from source-independent evidence", () => {
    const result = fuseClaimConfidenceFromEvidence(
      [
        claimFusionEvidence({
          evidence_id: "EV-PRIMARY",
          confidence: 0.8,
          doc_id: "DOC-SEC",
          chunk_id: "CHUNK-1",
          source_adapter_id: "sec-edgar"
        }),
        claimFusionEvidence({
          evidence_id: "EV-SAME-CHUNK",
          confidence: 0.9,
          doc_id: "DOC-SEC",
          chunk_id: "CHUNK-1",
          source_adapter_id: "sec-edgar"
        }),
        claimFusionEvidence({
          evidence_id: "EV-SAME-SOURCE",
          confidence: 0.6,
          doc_id: "DOC-SEC-Q",
          chunk_id: "CHUNK-2",
          source_adapter_id: "sec-edgar"
        }),
        claimFusionEvidence({
          evidence_id: "EV-INDEPENDENT",
          confidence: 0.7,
          doc_id: "DOC-TSMC",
          chunk_id: "CHUNK-1",
          source_adapter_id: "tsmc-ir",
          document_type: "annual_report"
        })
      ],
      { primary_evidence_id: "EV-PRIMARY", base_confidence: 0.8 }
    );

    expect(result.confidence).toBe(0.958);
    expect(result.base_confidence).toBe(0.8);
    expect(result.supporting_evidence_count).toBe(3);
    expect(result.independent_source_count).toBe(2);
    expect(result.contributions.map((item) => [item.evidence_id, item.independence_basis, item.independence_weight, item.adjusted_confidence])).toEqual([
      ["EV-PRIMARY", "primary_evidence", 1, 0.8],
      ["EV-SAME-CHUNK", "same_doc_same_chunk", 0, 0],
      ["EV-SAME-SOURCE", "same_source_different_document", 0.5, 0.3],
      ["EV-INDEPENDENT", "different_source_adapter", 1, 0.7]
    ]);
  });

  it("links primary and supporting evidence when building active edge claims", async () => {
    const edge: ClaimableFactEdge = {
      edge_id: "EDGE-CLAIM-FUSION",
      subject_id: "ENT-NVIDIA",
      object_id: "ENT-TSMC",
      relation: "USES_FOUNDRY",
      component: "wafer capacity",
      component_id: "COMP-WAFER",
      evidence_level: 5,
      confidence: 0.8,
      is_inferred: false,
      primary_evidence_id: "EV-PRIMARY",
      last_verified_at: "2026-01-01T00:00:00.000Z",
      subject_name: "NVIDIA",
      object_name: "TSMC"
    };
    const client = new ClaimFusionDbClient(edgeRowsForClaimBuilder(edge), [
      claimFusionEvidence({
        evidence_id: "EV-PRIMARY",
        confidence: 0.8,
        doc_id: "DOC-NVIDIA-10K",
        chunk_id: "CHUNK-1",
        source_adapter_id: "sec-edgar"
      }),
      claimFusionEvidence({
        evidence_id: "EV-SUPPORTING",
        confidence: 0.7,
        doc_id: "DOC-TSMC-AR",
        chunk_id: "CHUNK-1",
        source_adapter_id: "tsmc-ir",
        document_type: "annual_report"
      })
    ]);

    const summary = await buildEdgeClaimsFromCurrentEdges(client, { min_evidence_level: 4, limit: 10, generated_by: "unit-test" });

    expect(summary).toEqual({ scanned: 1, inserted: 1, updated: 0, generated_by: "unit-test" });
    const evidenceQuery = client.calls.find((call) => call.sql.includes("FROM evidence ev"));
    expect(evidenceQuery?.sql).toContain("ev.superseded_by IS NULL");
    expect(evidenceQuery?.sql).toContain("ev.is_inferred = false");
    const upsertCall = client.calls.find((call) => call.sql.includes("INSERT INTO claims"));
    expect(upsertCall?.params[10]).toBe(0.94);
    const linkCalls = client.calls.filter((call) => call.sql.includes("INSERT INTO claim_evidence"));
    expect(linkCalls.map((call) => [call.params[1], call.params[2]])).toEqual([
      ["EV-PRIMARY", "primary"],
      ["EV-SUPPORTING", "supporting"]
    ]);
  });

  it("builds draft claims from reviewed semantic changes without creating active fact claims", async () => {
    const candidate = semanticChangeCandidate();

    const draft = buildClaimDraftFromSemanticChangeReview(candidate, {
      generated_by: "unit-test",
      reviewed_at: "2026-05-18T00:00:00.000Z"
    });

    expect(draft).toMatchObject({
      claim_id: deterministicClaimIdForSemanticReview(candidate.review_id),
      claim_type: "RISK_SIGNAL_CLAIM",
      review_id: candidate.review_id,
      status: "draft",
      evidence_level: 3,
      is_inferred: true,
      generated_by: "unit-test",
      last_verified_at: "2026-05-18T00:00:00.000Z"
    });
    expect(draft.claim_text).toContain("draft signal");
    expect(draft.claim_text).toContain("not an active fact edge");
  });

  it("upserts semantic-change claim drafts and records semantic events", async () => {
    const client = new EmptyDbClient();
    const candidate = semanticChangeCandidate();

    const result = await upsertSemanticChangeClaimDraft(client, candidate, {
      generated_by: "unit-test",
      reviewed_at: "2026-05-18T00:00:00.000Z",
      caused_by: "reviewer"
    });

    expect(result).toEqual({ claim_id: deterministicClaimIdForSemanticReview(candidate.review_id), inserted: true });
    expect(client.calls).toHaveLength(4);
    expect(client.calls[0]?.params).toEqual(["nvidia"]);
    expect(client.calls[1]?.params).toEqual(["tsmc"]);
    expect(client.calls[2]?.sql).toContain("INSERT INTO claims");
    expect(client.calls[2]?.sql).toContain("RETURNING claim_id, (xmax = 0) AS inserted");
    expect(client.calls[2]?.params).toContain("ENT-NVIDIA");
    expect(client.calls[2]?.params).toContain("ENT-TSMC");
    expect(client.calls[2]?.params).toContain("COMP-WAFER");
    expect(client.calls[2]?.params).toContain("draft");
    expect(client.calls[2]?.params).toContain(candidate.review_id);
    expect(client.calls[3]?.sql).toContain("INSERT INTO change_records");
    expect(client.calls[3]?.params).toContain("CLAIM_DRAFT_ADDED");
  });

  it("creates a deterministic conflict unknown for removed semantic relation changes", async () => {
    const client = new SemanticConflictDbClient();
    const candidate = semanticChangeCandidate({ changeType: "PURCHASE_OBLIGATION_REMOVED" });

    const result = await upsertSemanticChangeClaimDraft(client, candidate, {
      generated_by: "unit-test",
      reviewed_at: "2026-05-18T00:00:00.000Z",
      caused_by: "reviewer"
    });

    const expectedUnknownId = deterministicConflictUnknownIdForSemanticReview(candidate.review_id);
    expect(isConflictingSemanticChange(candidate.payload.change_type)).toBe(true);
    expect(result.conflict_unknown_id).toBe(expectedUnknownId);
    expect(result.linked_conflict_claim_ids).toEqual([deterministicClaimIdForSemanticReview(candidate.review_id), "CLM-ACTIVE-TSMC"]);
    const unknownInsert = client.calls.find((call) => call.sql.includes("INSERT INTO unknown_items"));
    expect(unknownInsert?.params[0]).toBe(expectedUnknownId);
    expect(unknownInsert?.params[1]).toBe("edge");
    expect(unknownInsert?.params[2]).toBe("EDGE-TSMC");
    expect(unknownInsert?.params[3]).toContain("Does nvidia still have a publicly disclosed BUYS_FROM relationship with tsmc");
    const unknownLinks = client.calls.filter((call) => call.sql.includes("INSERT INTO claim_unknowns"));
    expect(unknownLinks.map((call) => [call.params[0], call.params[1], call.params[2]])).toEqual([
      [deterministicClaimIdForSemanticReview(candidate.review_id), expectedUnknownId, "boundary"],
      ["CLM-ACTIVE-TSMC", expectedUnknownId, "blocking"]
    ]);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO change_records") && call.params.includes("CLAIM_CONFLICT_UNKNOWN_LINKED"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO edges"))).toBe(false);
  });

  it("links contradicting evidence to a claim and creates a blocking conflict unknown", async () => {
    const client = new ClaimConflictMaintenanceDbClient();

    const result = await linkContradictingEvidenceToClaim(client, {
      claim_id: "CLM-ACTIVE-TSMC",
      evidence_id: "EV-CONTRA",
      reason: "Counterparty disclosure no longer lists this purchase obligation.",
      created_by: "unit-test"
    });

    const expectedUnknownId = deterministicConflictUnknownIdForClaimEvidence("CLM-ACTIVE-TSMC", "EV-CONTRA");
    expect(result).toEqual({
      claim_id: "CLM-ACTIVE-TSMC",
      evidence_id: "EV-CONTRA",
      unknown_id: expectedUnknownId,
      inserted_unknown: true
    });
    const evidenceLink = client.calls.find((call) => call.sql.includes("INSERT INTO claim_evidence"));
    expect(evidenceLink?.params).toEqual(["CLM-ACTIVE-TSMC", "EV-CONTRA", "contradicting"]);
    const unknownLink = client.calls.find((call) => call.sql.includes("INSERT INTO claim_unknowns"));
    expect(unknownLink?.params).toEqual(["CLM-ACTIVE-TSMC", expectedUnknownId, "blocking"]);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO change_records") && call.params.includes("CLAIM_CONTRADICTING_EVIDENCE_LINKED"))).toBe(
      true
    );
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO edges"))).toBe(false);
  });

  it("resolves claim conflict unknowns through the unknown boundary instead of editing fact edges", async () => {
    const client = new ClaimConflictMaintenanceDbClient();

    const result = await resolveClaimConflictUnknown(client, {
      claim_id: "CLM-ACTIVE-TSMC",
      unknown_id: "UNK-CONFLICT-1",
      resolved_evidence_ids: ["EV-RESOLUTION"],
      reviewer: "unit-test",
      reason: "Latest annual report confirms the relationship again."
    });

    expect(result).toEqual({ claim_id: "CLM-ACTIVE-TSMC", unknown_id: "UNK-CONFLICT-1" });
    expect(client.calls.some((call) => call.sql.includes("FROM claim_unknowns"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("UPDATE unknown_items") && call.params[0] === "UNK-CONFLICT-1")).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO change_records") && call.params.includes("UNKNOWN_RESOLVED"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO change_records") && call.params.includes("CLAIM_CONFLICT_UNKNOWN_RESOLVED"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("UPDATE edges") || call.sql.includes("INSERT INTO edges"))).toBe(false);
  });

  it("records a confirm-claim-valid resolution action and resolves the linked unknown without editing facts", async () => {
    const client = new ClaimConflictMaintenanceDbClient();

    const result = await resolveClaimConflictReview(client, {
      claim_id: "CLM-ACTIVE-TSMC",
      action: "confirm_claim_valid",
      unknown_id: "UNK-CONFLICT-1",
      resolution_evidence_ids: ["EV-RESOLUTION"],
      reviewer: "unit-test",
      reason: "Latest annual report confirms the relationship again."
    });

    expect(result).toEqual({
      claim_id: "CLM-ACTIVE-TSMC",
      action: "confirm_claim_valid",
      edge_id: "EDGE-TSMC",
      status: "unknown_resolved",
      unknown_id: "UNK-CONFLICT-1",
      resolution_evidence_ids: ["EV-RESOLUTION"]
    });
    expect(client.calls.some((call) => call.sql.includes("UPDATE unknown_items") && call.params[0] === "UNK-CONFLICT-1")).toBe(true);
    expect(
      client.calls.some((call) => call.sql.includes("INSERT INTO change_records") && call.params.includes("CLAIM_CONFLICT_RESOLUTION_ACTION_RECORDED"))
    ).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("UPDATE edges") || call.sql.includes("INSERT INTO edges"))).toBe(false);
    expect(client.calls.some((call) => call.sql.includes("UPDATE claims"))).toBe(false);
  });

  it("records an edge deprecation recommendation as review context only", async () => {
    const client = new ClaimConflictMaintenanceDbClient();

    const result = await resolveClaimConflictReview(client, {
      claim_id: "CLM-ACTIVE-TSMC",
      action: "recommend_edge_deprecation",
      reviewer: "unit-test",
      reason: "Contradicting counterparty disclosure should be reviewed by the edge deprecation workflow."
    });

    expect(result).toEqual({
      claim_id: "CLM-ACTIVE-TSMC",
      action: "recommend_edge_deprecation",
      edge_id: "EDGE-TSMC",
      status: "recorded",
      resolution_evidence_ids: []
    });
    const actionRecord = client.calls.find(
      (call) => call.sql.includes("INSERT INTO change_records") && call.params.includes("CLAIM_CONFLICT_RESOLUTION_ACTION_RECORDED")
    );
    expect(actionRecord?.params[5]).toMatchObject({
      action: "recommend_edge_deprecation",
      edge_id: "EDGE-TSMC",
      safe_write_policy: {
        automatic_fact_mutation_allowed: false,
        allowed_edge_mutation: "none",
        claim_status_mutation_allowed: false
      }
    });
    expect(client.calls.some((call) => call.sql.includes("UPDATE unknown_items"))).toBe(false);
    expect(client.calls.some((call) => call.sql.includes("UPDATE edges") || call.sql.includes("INSERT INTO edges"))).toBe(false);
    expect(client.calls.some((call) => call.sql.includes("UPDATE claims"))).toBe(false);
  });

  it("supersedes a stale active claim through an auditable lifecycle action without editing fact edges", async () => {
    const client = new ClaimLifecycleDbClient();

    const result = await resolveClaimLifecycle(client, {
      claim_id: "CLM-STALE-EDGE",
      action: "supersede_claim",
      superseded_by_claim_id: "CLM-REPLACEMENT",
      source_refs: [
        { kind: "evidence", id: "EV-CONTRA" },
        { kind: "claim", id: "CLM-REPLACEMENT" }
      ],
      reviewer: "unit-test",
      reason: "Deprecated edge has been replaced by a narrower reviewed claim."
    });

    expect(result).toEqual({
      claim_id: "CLM-STALE-EDGE",
      action: "supersede_claim",
      status: "updated",
      previous_claim_status: "active",
      new_claim_status: "superseded",
      edge_id: "EDGE-DEPRECATED",
      edge_validity: "deprecated",
      source_refs: [
        { kind: "evidence", id: "EV-CONTRA" },
        { kind: "claim", id: "CLM-REPLACEMENT" }
      ],
      superseded_by_claim_id: "CLM-REPLACEMENT"
    });
    expect(client.calls.some((call) => call.sql.includes("UPDATE claims") && call.params[1] === "superseded")).toBe(true);
    const change = client.calls.find((call) => call.sql.includes("INSERT INTO change_records") && call.params.includes("CLAIM_LIFECYCLE_ACTION_RECORDED"));
    expect(change?.params[4]).toMatchObject({ status: "active", edge_validity: "deprecated" });
    expect(change?.params[5]).toMatchObject({
      action: "supersede_claim",
      status: "superseded",
      superseded_by_claim_id: "CLM-REPLACEMENT",
      source_refs: [
        { kind: "evidence", id: "EV-CONTRA" },
        { kind: "claim", id: "CLM-REPLACEMENT" }
      ]
    });
    expect(change?.params[6]).toEqual(["EV-CONTRA"]);
    expect(client.calls.some((call) => call.sql.includes("UPDATE edges") || call.sql.includes("INSERT INTO edges"))).toBe(false);
  });

  it("records keep-with-context without changing claim or fact edge status", async () => {
    const client = new ClaimLifecycleDbClient();

    const result = await resolveClaimLifecycle(client, {
      claim_id: "CLM-STALE-EDGE",
      action: "keep_with_context",
      source_refs: [{ kind: "evidence", id: "EV-CONTRA" }],
      reviewer: "unit-test",
      reason: "Keep visible until replacement evidence review is complete."
    });

    expect(result).toMatchObject({
      claim_id: "CLM-STALE-EDGE",
      action: "keep_with_context",
      status: "recorded",
      previous_claim_status: "active",
      new_claim_status: "active",
      edge_id: "EDGE-DEPRECATED",
      edge_validity: "deprecated"
    });
    expect(client.calls.some((call) => call.sql.includes("UPDATE claims"))).toBe(false);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO change_records") && call.params.includes("CLAIM_LIFECYCLE_ACTION_RECORDED"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("UPDATE edges") || call.sql.includes("INSERT INTO edges"))).toBe(false);
  });

  it("requires source refs before applying claim lifecycle actions", async () => {
    const client = new ClaimLifecycleDbClient();

    await expect(
      resolveClaimLifecycle(client, {
        claim_id: "CLM-STALE-EDGE",
        action: "reject_claim",
        source_refs: [],
        reviewer: "unit-test",
        reason: "No source refs."
      })
    ).rejects.toThrow("claim lifecycle action requires at least one source ref");
    expect(client.calls.some((call) => call.sql.includes("UPDATE claims"))).toBe(false);
  });
});

function mockResult<T extends pg.QueryResultRow>(rows: T[]): pg.QueryResult<T> {
  return {
    command: "MOCK",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows
  };
}

function edgeRowsForClaimBuilder(edge: ClaimableFactEdge): ClaimableFactEdge[] {
  return [edge];
}

function claimFusionEvidence(input: {
  evidence_id: string;
  confidence: number;
  doc_id: string;
  chunk_id: string | null;
  source_adapter_id: string;
  document_type?: ClaimFusionEvidence["document_type"];
}): ClaimFusionEvidence {
  return {
    evidence_id: input.evidence_id,
    doc_id: input.doc_id,
    chunk_id: input.chunk_id,
    evidence_level: 5,
    confidence: input.confidence,
    source_adapter_id: input.source_adapter_id,
    document_type: input.document_type ?? "10-K"
  };
}

function rowsForClaimBuilder<T extends pg.QueryResultRow>(sql: string, params: readonly unknown[]): T[] {
  if (sql.includes("SELECT entity_id FROM entity_master") && params[0] === "nvidia") {
    return [{ entity_id: "ENT-NVIDIA" }] as unknown as T[];
  }
  if (sql.includes("SELECT entity_id FROM entity_master") && params[0] === "tsmc") {
    return [{ entity_id: "ENT-TSMC" }] as unknown as T[];
  }
  if (sql.includes("RETURNING claim_id, (xmax = 0) AS inserted") && typeof params[0] === "string") {
    return [{ claim_id: params[0], inserted: true }] as unknown as T[];
  }
  if (sql.includes("RETURNING unknown_id, (xmax = 0) AS inserted, status, scope_kind, scope_id, question") && typeof params[0] === "string") {
    return unknownUpsertRows(params);
  }
  return [];
}

function unknownUpsertRows<T extends pg.QueryResultRow>(params: readonly unknown[]): T[] {
  return [
    {
      unknown_id: params[0],
      inserted: true,
      status: "open",
      scope_kind: params[1],
      scope_id: params[2],
      question: params[3]
    }
  ] as unknown as T[];
}

function reviewCandidateBatchRows(call: QueryCall | undefined): ReviewCandidateBatchTestRow[] {
  if (call === undefined || typeof call.params[0] !== "string") return [];
  const parsed: unknown = JSON.parse(call.params[0]);
  if (!Array.isArray(parsed)) throw new Error("Expected review candidate batch payload");
  return parsed.map(reviewCandidateBatchRow);
}

function reviewCandidateBatchRow(value: unknown): ReviewCandidateBatchTestRow {
  if (!isRecord(value)) throw new Error("Expected review candidate batch row object");
  const kind = value["kind"];
  const docId = value["doc_id"];
  const sourceAdapterId = value["source_adapter_id"];
  if (typeof kind !== "string") throw new Error("Expected review candidate batch row kind");
  if (docId !== null && typeof docId !== "string") throw new Error("Expected review candidate batch row doc_id");
  if (typeof sourceAdapterId !== "string") throw new Error("Expected review candidate batch row source_adapter_id");
  return { kind, doc_id: docId, source_adapter_id: sourceAdapterId, candidate: value["candidate"] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function semanticChangeCandidate(input: { changeType?: string } = {}) {
  return buildSemanticChangeReviewCandidate({
    changeType: input.changeType ?? "PURCHASE_OBLIGATION_CHANGED",
    sourceItemId: "SRCITEM-sec-edgar-nvidia",
    sourceUrl: "https://www.sec.gov/Archives/fixture/nvidia-10q.htm",
    snapshot: {
      doc_id: "DOC-NVIDIA-10Q",
      source_adapter_id: "sec-edgar",
      relation: "BUYS_FROM",
      semantic_relation_kind: "purchase_obligation",
      subject_surface: "nvidia",
      object_surface: "tsmc",
      component_id: "COMP-WAFER",
      component: "wafer",
      component_specificity: "explicit",
      cite_text: "We have purchase obligations with TSMC for wafer capacity.",
      cite_locator: "Item 2",
      fingerprint: "we have purchase obligations with tsmc for wafer capacity",
      extractor_id: "rule.sec.official-supply-chain"
    }
  });
}
