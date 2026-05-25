# @supplystrata/pipeline

`pipeline` 是跨领域受控流程的应用层编排。它把 review apply、document observation persistence、official disclosure signal candidate 和 semantic change tracking 串起来。

## 负责什么

- 应用 approved review candidate。
- 按 candidate kind 分发到对应 strategy。
- 持久化已保存文档的 observation、semantic section change、relation semantic change 和 official disclosure signal review candidate。
- 在批处理失败时把已领取 review candidate 安全落到 blocked，避免卡在 in-review。

## 不负责什么

- 不实现具体 source adapter。
- 不直接暴露 CLI 参数解析。
- 不把 observation 或 official disclosure signal 自动升级成 fact edge。
- 不在编排层写具体业务规则；规则应下沉到相应 strategy / function。

## 主要入口

- `applyApprovedReviewCandidate(store, reviewId, reviewer, options)`：应用单个 approved review candidate。
- `applyApprovedReviewCandidates(store, input)`：批量应用。
- `persistDocumentObservations(client, normalized, docId, options)`：保存文档观察上下文。
- `recordSavedDocumentObservation(...)`：记录 source monitor 文档观察事件。

## 边界约定

pipeline 可以协调多个 domain，但不能吞掉 domain 边界。新增 candidate kind 应新增明确 strategy，并声明它是否允许 fact mutation；默认应保持 review-only。
