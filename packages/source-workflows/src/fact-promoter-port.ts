export interface SourceCheckDocumentFactPromotion {
  candidates: number;
  applied_edges: number;
  evidence_ids: readonly string[];
}

// source check 的事实提升口子：source-workflows 只负责“观测”，事实写入由组合层注入一个提升器，
// 在文档落库后按 doc_id 重新加载并跑 extract + evidence-gated promote（实现见 @supplystrata/pipeline
// 的 createDocumentFactPromoter）。这里用最窄接口做控制反转，避免 source-workflows 反向依赖 pipeline。
export interface SourceCheckFactPromoter {
  promoteDocumentFacts(input: { docId: string; autoReviewedAt?: string }): Promise<SourceCheckDocumentFactPromotion>;
}
