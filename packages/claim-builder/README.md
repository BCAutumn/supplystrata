# @supplystrata/claim-builder

`claim-builder` 是事实边和语义变化之上的 claim 派生层。它把已有证据、反证、unknown 和生命周期状态组织成可审阅 claim，不写新的 fact edge。

## 负责什么

- 从 current fact edge 构建 deterministic edge claim。
- 从 semantic change review 构建 draft claim。
- 融合 claim confidence。
- 判定 claim conflict、安全写入状态和 review packet。
- 入队 claim conflict review candidates。
- 处理 claim lifecycle、conflict resolution 和 unknown linkage。

## 不负责什么

- 不抓取来源。
- 不写 `edges`。
- 不提升 evidence level。
- 不自动解决不同来源之间的冲突。
- 不把 draft claim 当作事实结论。

## 主要入口

- `buildEdgeClaimsFromCurrentEdgesTransactionally(...)`：从当前事实边刷新 claim。
- `upsertSemanticChangeClaimDraft(...)`：从语义变化生成 claim 草稿。
- `adjudicateClaimConflict(...)`：纯规则冲突裁决。
- `enqueueClaimConflictReviewCandidatesTransactionally(...)`：把冲突放入 review queue。
- `resolveClaimConflictReviewTransactionally(...)`：记录人工 conflict resolution。

## 边界约定

claim 是派生解释层，不是事实层。任何会改变事实边、废弃事实边或关闭 unknown 的动作，都必须走独立 review/apply 或 maintenance use-case。
