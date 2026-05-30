import { listExtractableDocumentIds } from "@supplystrata/db/read";
import { type DatabaseStore } from "@supplystrata/db/write";
import { messageFromUnknown, noopLogger, type SupplyStrataLogger } from "@supplystrata/observability";
import type { GraphSyncMode } from "@supplystrata/graph-builder";
import { createDocumentFactPromoter } from "./promote-document-facts.js";

export interface BackfillDocumentFactsInput {
  docIds?: readonly string[];
  entityId?: string;
  sourceAdapterId?: string;
  documentTypes?: readonly string[];
  limit?: number;
  graphSyncMode?: GraphSyncMode;
  logger?: SupplyStrataLogger;
}

export interface BackfillDocumentFactsResult {
  documents_selected: number;
  documents_processed: number;
  candidates: number;
  applied_edges: number;
  unresolved_counterparties: number;
  recorded_unknowns: number;
  failures: { doc_id: string; error: string }[];
}

// 抽取器升级后的存量重抽：source-check 只在文档 NEW/CHANGED 时跑事实提升，所以"升级前抓回、判为 UNCHANGED、
// 却从未被新规则抽过"的文档会留空白。本函数按 doc_id / 实体 / 适配器 / 文档类型筛出存量文档，逐篇重跑
// promoteDocumentFacts。边写入按 (subject,object,relation,component) upsert、证据按 (edge,doc,extractor) 自我 supersede，
// 因此重跑幂等：不会重复造边，只会把证据刷新到当前抽取器版本。单篇失败被隔离，不影响整批。
export async function backfillDocumentFacts(store: DatabaseStore, input: BackfillDocumentFactsInput = {}): Promise<BackfillDocumentFactsResult> {
  const logger = input.logger ?? noopLogger;
  const docIds =
    input.docIds !== undefined && input.docIds.length > 0
      ? [...input.docIds]
      : await listExtractableDocumentIds(store.read, {
          ...(input.entityId === undefined ? {} : { entityId: input.entityId }),
          ...(input.sourceAdapterId === undefined ? {} : { sourceAdapterId: input.sourceAdapterId }),
          ...(input.documentTypes === undefined ? {} : { documentTypes: input.documentTypes }),
          ...(input.limit === undefined ? {} : { limit: input.limit })
        });

  const result: BackfillDocumentFactsResult = {
    documents_selected: docIds.length,
    documents_processed: 0,
    candidates: 0,
    applied_edges: 0,
    unresolved_counterparties: 0,
    recorded_unknowns: 0,
    failures: []
  };

  const promoter = createDocumentFactPromoter(store, { graphSyncMode: input.graphSyncMode ?? "defer", logger });
  try {
    for (const docId of docIds) {
      try {
        const promoted = await promoter.promoteDocumentFacts({ docId });
        result.documents_processed += 1;
        result.candidates += promoted.candidates;
        result.applied_edges += promoted.applied_edges;
        result.unresolved_counterparties += promoted.unresolved_counterparties;
        result.recorded_unknowns += promoted.recorded_unknowns;
      } catch (error) {
        const message = messageFromUnknown(error);
        result.failures.push({ doc_id: docId, error: message });
        logger.warn({ stage: "backfill-document-facts", doc_id: docId, err: message }, "document re-extraction failed; continuing with the rest");
      }
    }
  } finally {
    await promoter.close();
  }
  return result;
}
