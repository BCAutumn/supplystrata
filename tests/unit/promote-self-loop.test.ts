import { describe, expect, it } from "vitest";
import type { CandidateRelation, NormalizedDocument, ResolveInput, ResolveResult, ScoringResult } from "@supplystrata/core";
import type { EntityResolver } from "@supplystrata/entity-resolver";
import type { EvidenceScorer } from "@supplystrata/evidence-scorer";
import { decideAutoPromotableCandidates } from "@supplystrata/pipeline";

// 把任何 surface 都解析到同一个实体：模拟“年报正文以第三人称提到发行人自己、其名字又恰是已登记交易对手”
// 的真实情形（如 “SK hynix reported that … HBM …”），用来验证自环防护把两端解析到同一实体的候选直接丢弃。
class SameEntityResolver implements EntityResolver {
  constructor(private readonly entityId: string) {}
  async resolve(_input: ResolveInput): Promise<ResolveResult> {
    return { status: "resolved", entity_id: this.entityId, confidence: 0.95, needs_human_review: false };
  }
}

// 让候选通过打分门（不进 review），以便走到“写库前解析两端实体”的分流逻辑。
class AutoPromoteScorer implements EvidenceScorer {
  async score(_candidate: CandidateRelation, _doc: NormalizedDocument): Promise<ScoringResult> {
    return {
      evidence_level: 5,
      confidence: 0.92,
      is_inferred: false,
      needs_review: false,
      rationale: "stub: auto-promotable",
      confidence_breakdown: { base: 0.92, factors: [], cap: 0.95, final: 0.92 }
    };
  }
}

describe("decideAutoPromotableCandidates self-loop guard", () => {
  it("drops candidates whose subject and object resolve to the same entity (no self edge, not recorded as unknown)", async () => {
    const text =
      "SK hynix reported that HBM demand from AI memory customers remained strong during the quarter, supporting product shipments and revenue visibility.";
    const normalized: NormalizedDocument = {
      doc_id: "DOC-SELF-LOOP",
      source_adapter_id: "skhynix-ir",
      document_type: "annual_report",
      primary_entity_id: "ENT-SKHYNIX",
      language: "en",
      fetched_at: "2026-04-24T00:00:00.000Z",
      source_url: "https://www.skhynix.com/ir/fixture.html",
      storage_key: "skhynix-ir/fixture.html",
      bytes_sha256: "fixture-sha-skhynix",
      text,
      chunks: [{ chunk_id: "CHK-SELF-1", locator: "ir:1", text }],
      metadata: {}
    };

    const decision = await decideAutoPromotableCandidates({
      normalized,
      chunks: normalized.chunks.map((chunk) => ({ chunk_id: chunk.chunk_id, text: chunk.text, ...(chunk.locator === undefined ? {} : { locator: chunk.locator }) })),
      docId: normalized.doc_id,
      scorer: new AutoPromoteScorer(),
      resolver: new SameEntityResolver("ENT-SKHYNIX"),
      autoReviewedAt: normalized.fetched_at
    });

    // 该正文确实产出了一个候选（发行人自指被误读为供应关系），但两端解析到同一实体后被自环防护丢弃：
    // 既不会写成 A→A 的自环边，也不会当成“未登记交易对手”记入 unknown（交易对手就是发行人自己）。
    expect(decision.candidates).toBe(1);
    expect(decision.approved).toHaveLength(0);
    expect(decision.unresolved_counterparties).toHaveLength(0);
  });
});
