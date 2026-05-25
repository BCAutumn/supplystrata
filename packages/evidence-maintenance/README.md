# @supplystrata/evidence-maintenance

`evidence-maintenance` 是证据与派生情报的维护层。它把已有事实、证据、review disposition 和 observation 转成可审计的派生上下文。

## 负责什么

- 回填 evidence trace fingerprint / offset / parser metadata。
- 刷新 edge freshness。
- 从 L4/L5 fact edge 的明确证据中推导 edge strength estimate。
- 对缺失 strength 的边生成 explicit unknown。
- 物化 single-source disposition unknown。
- 物化 official signal disposition 中的 `record_single_source_unknown`。
- 刷新 component risk、alert、calibration、observation anomaly 等派生视图。

## 不负责什么

- 不写新的 fact edge。
- 不提高 evidence level。
- 不让 observation、lead、official signal 或 unknown 变成事实。
- 不自动 resolve reviewer 尚未确认的 business conflict。

## 主要入口

- `backfillEvidenceTraceTransactionally(store, input)`：分批回填证据 trace。
- `refreshEdgeIntelligenceContextTransactionally(store, input)`：刷新 freshness、strength 和 strength unknown。
- `materializeSingleSourceDispositionUnknowns(...)`：从 readiness proposed unknown 写入 edge-scoped unknown。
- `materializeOfficialSignalDispositionUnknowns(...)`：从 official signal disposition 写入 edge-scoped unknown。
- `refreshComponentRiskView(...)`、`refreshAlertCandidates(...)`、`refreshObservationAnomalyViews(...)`：派生风险/异常上下文。

## 边界约定

所有写入都是派生层或 unknown/backlog 层写入。事实层仍以 graph-builder / review apply 的受控路径为准，且必须保留 evidence trace。
