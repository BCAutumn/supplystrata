import { createDeterministicId, normalizeAlias, type ApprovedCandidate, type NormalizedDocument, type RelationType } from "@supplystrata/core";
import { loadDocument } from "@supplystrata/db/read";
import { upsertUnknownItem, type DatabaseStore } from "@supplystrata/db/write";
import { DbEntityResolver, type EntityResolver } from "@supplystrata/entity-resolver";
import { DeterministicEvidenceScorer, type EvidenceScorer } from "@supplystrata/evidence-scorer";
import { GraphBuilder, type GraphSyncMode } from "@supplystrata/graph-builder";
import type { GraphStore } from "@supplystrata/graph-store";
import { noopLogger, type SupplyStrataLogger } from "@supplystrata/observability";
import { ruleExtractors } from "@supplystrata/relation-extractor-rule";
import { isValidCandidate } from "./candidate-validation.js";
import { locateCandidateCitation, type SavedChunkRef } from "./citation-location.js";

// 通过了全部自动写入门槛、主体已登记、但交易对手实体尚未登记的关系。
// 这是“有官方证据、但实体未登记”的真实发现——不能写成 current 边（缺一个端点），也不该静默丢弃，
// 由调用方记成 unknown，让它在 list_unknowns 里可见并可被 bootstrap，随后再 promote 就能落边。
export interface UnresolvedCounterparty {
  subject_entity_id: string;
  object_surface: string;
  relation: RelationType;
  document_type: NormalizedDocument["document_type"];
  cite_text: string;
  doc_id: string;
  chunk_id: string;
}

export interface AutoPromotionDecision {
  candidates: number;
  approved: ApprovedCandidate[];
  unresolved_counterparties: UnresolvedCounterparty[];
}

export interface DecideAutoPromotableCandidatesInput {
  normalized: NormalizedDocument;
  chunks: readonly SavedChunkRef[];
  docId: string;
  scorer: EvidenceScorer;
  resolver: EntityResolver;
  autoReviewedAt: string;
  logger?: SupplyStrataLogger;
}

// 规则抽取 + evidence-gated promote 的“决策”阶段：跑确定性 rule 抽取器，逐条做本地校验、打分、
// 引用定位，只把满足 #13 自动写入门槛的候选转成 ApprovedCandidate。任何 needs_review / 引用无法
// 唯一落到持久化 chunk 的候选都被丢弃（交由 review 队列另行处理），这里绝不写库。run.ts 与
// source-check 后置 promote 共用这一段，保证“什么是可自动写入的事实”只有一处真相。
export async function decideAutoPromotableCandidates(input: DecideAutoPromotableCandidatesInput): Promise<AutoPromotionDecision> {
  const logger = input.logger ?? noopLogger;
  const approved: ApprovedCandidate[] = [];
  const unresolvedCounterparties: UnresolvedCounterparty[] = [];
  let candidates = 0;
  for (const extractor of ruleExtractors) {
    for await (const candidate of extractor.extract(input.normalized)) {
      candidates += 1;
      if (!isValidCandidate(candidate, input.normalized.text)) {
        logger.warn({ stage: "extract", extractor: candidate.extractor_id }, "candidate rejected by local validation");
        continue;
      }
      const scoring = await input.scorer.score(candidate, input.normalized);
      if (scoring.needs_review) {
        logger.warn({ stage: "score", candidate: candidate.extractor_id }, "candidate needs review and was not auto-applied");
        continue;
      }
      const citationLocation = locateCandidateCitation(input.chunks, candidate);
      if (citationLocation.status !== "located") {
        logger.warn(
          {
            stage: "citation-location",
            extractor: candidate.extractor_id,
            status: citationLocation.status,
            occurrence_count: citationLocation.occurrence_count,
            reason: citationLocation.reason
          },
          "candidate rejected because citation cannot be mapped to exactly one persisted chunk"
        );
        continue;
      }
      // 写库前先解析两端实体：缺端点的关系永远写不成 current 边。在“决策”阶段（只读）就分流，
      // 既让 graph-builder 写库阶段恒满足 resolved 不变量、绝不抛错，也能把“交易对手未登记”的发现保留下来。
      const subject = await input.resolver.resolve(candidate.subject_resolve);
      const object = await input.resolver.resolve(candidate.object_resolve);
      const subjectResolved = subject.status === "resolved" && subject.entity_id !== undefined;
      const objectResolved = object.status === "resolved" && object.entity_id !== undefined;
      // 自环防护：官方年报/IR 正文常以第三人称提到发行人自己（“SK hynix reported that … HBM …”），
      // 规则会把发行人名当成交易对手，解析回同一实体，写成 A —关系→ A 的自环边（无意义且污染图）。
      // 两端解析到同一实体时直接丢弃，比放任写库再清理更干净。SEC 10-K 少见自指，年报放开抽取后才暴露。
      if (subjectResolved && objectResolved && subject.entity_id === object.entity_id) {
        logger.warn(
          { stage: "self-loop", extractor: candidate.extractor_id, relation: candidate.relation, entity: subject.entity_id },
          "candidate subject and object resolve to the same entity; dropped self-referential relation"
        );
        continue;
      }
      if (subjectResolved && objectResolved) {
        approved.push({
          candidate,
          scoring,
          approved_by: { reviewer: "auto", reviewed_at: input.autoReviewedAt },
          doc_id: input.docId,
          chunk_id: citationLocation.chunk_id
        });
        continue;
      }
      if (subjectResolved && subject.entity_id !== undefined) {
        unresolvedCounterparties.push({
          subject_entity_id: subject.entity_id,
          object_surface: candidate.object_resolve.surface,
          relation: candidate.relation,
          document_type: input.normalized.document_type,
          cite_text: candidate.cite_text,
          doc_id: input.docId,
          chunk_id: citationLocation.chunk_id
        });
        logger.info(
          { stage: "counterparty-unresolved", extractor: candidate.extractor_id, relation: candidate.relation, object: candidate.object_resolve.surface },
          "evidence-backed relation discovered, but counterparty is not yet a registered entity; recorded as unknown"
        );
        continue;
      }
      logger.warn(
        { stage: "subject-unresolved", extractor: candidate.extractor_id, subject: candidate.subject_resolve.surface },
        "candidate subject could not be resolved; skipped"
      );
    }
  }
  return { candidates, approved, unresolved_counterparties: unresolvedCounterparties };
}

// 把“发现了但未登记的交易对手”记成 unknown_items。unknown_id 用确定性 id（scope + relation + 归一 surface），
// 同一份披露反复抓取只会 upsert 同一条，不会每次新增；可在 list_unknowns / unknowns 资源里看到并被 bootstrap。
export async function recordUnresolvedCounterpartyUnknowns(
  store: DatabaseStore,
  items: readonly UnresolvedCounterparty[],
  createdBy: string
): Promise<{ recorded: number; inserted: number }> {
  let inserted = 0;
  for (const item of items) {
    const unknownId = createDeterministicId("UNK", [item.subject_entity_id, item.relation, normalizeAlias(item.object_surface)]);
    const result = await store.transaction((client) =>
      upsertUnknownItem(client, {
        unknown_id: unknownId,
        scope_kind: "entity",
        scope_id: item.subject_entity_id,
        question: `Identify and register supply-chain counterparty "${item.object_surface}" (${item.relation})`,
        why_unknown: `Counterparty "${item.object_surface}" was disclosed in an official ${item.document_type} filing but is not yet in the entity registry, so the ${item.relation} relation cannot be promoted to a current edge until the counterparty is identified.`,
        blocking_data_sources: ["entity-registry"],
        created_by: createdBy
      })
    );
    if (result.inserted) inserted += 1;
  }
  return { recorded: items.length, inserted };
}

export interface DocumentFactPromotionResult {
  doc_id: string;
  candidates: number;
  applied_edges: number;
  unresolved_counterparties: number;
  recorded_unknowns: number;
  evidence_ids: string[];
  graph_sync: {
    synced: number;
    deferred: number;
    failed: number;
  };
}

export interface DocumentFactPromoterOptions {
  graphSyncMode?: GraphSyncMode;
  graphStore?: GraphStore;
  logger?: SupplyStrataLogger;
}

export interface PromoteDocumentFactsInput {
  docId: string;
  autoReviewedAt?: string;
}

// source-check 后置事实提升器：source check 只负责“观测”（document/observation/change/review 入队），
// 文档落库后由本提升器在独立事务里跑 extract + evidence-gated promote，把规则抽取的高可信关系写成
// current 边。失败被隔离在单文档的 graph-builder 事务里，不会回滚已提交的观测，也不影响其他文档。
// 抽取对象是“持久化后的文档”（按 doc_id 重新加载），因此证据引用的 chunk_id 天然可定位、可审计。
export interface DocumentFactPromoter {
  promoteDocumentFacts(input: PromoteDocumentFactsInput): Promise<DocumentFactPromotionResult>;
  close(): Promise<void>;
}

export function createDocumentFactPromoter(store: DatabaseStore, options: DocumentFactPromoterOptions = {}): DocumentFactPromoter {
  const logger = options.logger ?? noopLogger;
  const resolver = new DbEntityResolver(store.read);
  const scorer = new DeterministicEvidenceScorer();
  const graphBuilder = new GraphBuilder(store, resolver, {
    graphSyncMode: options.graphSyncMode ?? "defer",
    ...(options.graphStore === undefined ? {} : { graphStore: options.graphStore }),
    logger
  });
  return {
    async promoteDocumentFacts(input) {
      const normalized = await loadDocument(store.read, input.docId);
      const decision = await decideAutoPromotableCandidates({
        normalized,
        chunks: normalized.chunks,
        docId: input.docId,
        scorer,
        resolver,
        autoReviewedAt: input.autoReviewedAt ?? normalized.fetched_at,
        logger
      });
      const evidenceIds: string[] = [];
      const graphSync = { synced: 0, deferred: 0, failed: 0 };
      for (const approved of decision.approved) {
        const result = await graphBuilder.apply(approved);
        evidenceIds.push(result.evidence_id);
        graphSync[result.graph_sync.status] += 1;
      }
      const unknownResult = await recordUnresolvedCounterpartyUnknowns(store, decision.unresolved_counterparties, "auto-promote:source-check");
      return {
        doc_id: input.docId,
        candidates: decision.candidates,
        applied_edges: decision.approved.length,
        unresolved_counterparties: unknownResult.recorded,
        recorded_unknowns: unknownResult.inserted,
        evidence_ids: evidenceIds,
        graph_sync: graphSync
      };
    },
    async close() {
      await graphBuilder.close();
    }
  };
}
