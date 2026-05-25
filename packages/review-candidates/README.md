# @supplystrata/review-candidates

`review-candidates` 定义所有进入人工/规则审查队列的候选项契约。

## 负责什么

- 定义 supplier list row、entity source、semantic change、claim conflict、official disclosure signal、OSH facility 等 review candidate。
- 提供 candidate type guard。
- 提供 deterministic candidate key / review id helper。
- 定义 review-only fact write policy。

## 不负责什么

- 不写 review queue。
- 不执行候选应用。
- 不写 fact edge、evidence、unknown 或 entity。
- 不自动批准候选。

## 边界约定

review candidate 是“待审输入”，不是业务结果。任何可能写事实层的候选都必须在 candidate payload 中保留来源、证据和 fact write policy。
