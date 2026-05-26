# @supplystrata/review-store

`review-store` 是人工/规则审查队列的持久化边界。它负责候选项的领取、裁决、阻塞、应用状态和 review-scoped 审计事件。

## 负责什么

- 批量入队 review candidates。
- 领取 pending / approved candidate，并用事务和锁保护并发处理。
- 记录 approve、reject、block、applied 等 review 状态变化。
- 记录 official disclosure signal disposition。
- 记录 edge corroboration disposition，说明单源 L4/L5 关系应继续找二源、记录 single-source unknown，还是创建 counterparty source target。
- 记录 Gate 1 entity affiliation disposition，说明父级法人、子实体或双范围研究该如何继续。
- 为 CLI、pipeline 和未来前端提供稳定 review queue 契约。

## 不负责什么

- 不执行候选项对应的业务写入。
- 不写 fact edge、evidence、claim 或 unknown。
- 不合并实体、不继承父级 evidence、不传播 fact edge。
- 不自动裁决冲突来源。
- 不把 official signal disposition 物化成 unknown；该步骤属于 `evidence-maintenance`。

## 主要入口

- `enqueueReviewCandidates(...)`：入队候选。
- `nextReviewCandidate(...)`：领取下一个待审项。
- `decideReviewCandidate(...)`：批准或拒绝。
- `markReviewCandidateBlocked(...)`：阻塞候选。
- `markReviewCandidateApplied(...)`：标记已应用。
- `recordOfficialDisclosureSignalDisposition(...)`：记录官方披露信号的 edge 级审阅结论。
- `recordEdgeCorroborationDisposition(...)`：记录 edge 级二源/单源处置结论。
- `recordEntityAffiliationDisposition(...)`：记录业务单元/父级法人研究范围的审阅结论。

## 边界约定

review-store 记录“人或受控规则做出的结论”，但不执行事实层副作用。具体 apply 或 materialize 必须由独立 use-case 承接。
