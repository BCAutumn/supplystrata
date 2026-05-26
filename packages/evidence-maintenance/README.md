# @supplystrata/evidence-maintenance

`evidence-maintenance` 是证据与派生情报的维护层。它把已有事实、证据、review disposition 和 observation 转成可审计的派生上下文。

## 负责什么

- 回填 evidence trace fingerprint / offset / parser metadata。
- 修复已审供应商名单 evidence 的 citation 空白规范化问题，确保 `cite_text` 能在 chunk 中复现。
- 刷新 edge freshness。
- 从 L4/L5 fact edge 的明确证据中推导 edge strength estimate。
- 对缺失 strength 的边生成 explicit unknown。
- 物化 single-source disposition unknown。
- 物化 official signal disposition 中的 `record_single_source_unknown`。
- 物化 Gate 1 递归研究根实体的 coverage unknown：当一个研究入口已经进入目标链路，但没有任何 reviewed L4/L5 fact edge 且没有 open entity unknown 时，只写 explicit unknown，不写事实边。
- 刷新 component risk、alert、calibration、observation anomaly 等派生视图。

## 不负责什么

- 不写新的 fact edge。
- 不提高 evidence level。
- 不让 observation、lead、official signal 或 unknown 变成事实。
- 不自动 resolve reviewer 尚未确认的 business conflict。

## 主要入口

- `backfillEvidenceTraceTransactionally(store, input)`：分批回填证据 trace。
- `repairSupplierListEvidenceCitationsTransactionally(store, input)`：修复旧供应商名单 evidence 中 fixed-width 行空白与持久化 chunk 不一致的问题。
- `refreshEdgeIntelligenceContextTransactionally(store, input)`：刷新 freshness、strength 和 strength unknown。
- `materializeSingleSourceDispositionUnknowns(...)`：从 readiness proposed unknown 写入 edge-scoped unknown。
- `materializeOfficialSignalDispositionUnknowns(...)`：从 official signal disposition 写入 edge-scoped unknown。
- `materializeRootResearchUnknowns(...)`：从 selected company / parent legal-entity 研究入口写入 company-scoped unknown，避免空图报告假装“没有问题”。
- `refreshComponentRiskView(...)`、`refreshAlertCandidates(...)`、`refreshObservationAnomalyViews(...)`：派生风险/异常上下文。

## 边界约定

所有写入都是派生层或 unknown/backlog 层写入。事实层仍以 graph-builder / review apply 的受控路径为准，且必须保留 evidence trace。
