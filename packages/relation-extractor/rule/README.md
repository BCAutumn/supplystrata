# @supplystrata/relation-extractor-rule

规则关系抽取器。当前主要覆盖 SEC / official disclosure 中能被原文片段直接支持的供应链关系候选。

## 边界

- 只产出 `CandidateRelation`，不写 fact edge。
- 候选必须保留 `cite_text`、chunk locator 和 extractor id。
- 规则命中不等于事实成立；后续仍需要 entity resolver、evidence scoring 和 review/apply。
- observation、lead、行业常识和 AI 摘要不能在这里升级成关系事实。

## 结构

- `src/index.ts`：抽取入口和规则编排。
- `src/pattern-catalog.ts`：读取并校验 pattern catalog。
- `patterns/sec-official-supply-chain.json`：当前 SEC official supply-chain pattern 数据。

新增规则时优先扩展 pattern catalog；只有确实需要上下文判断时才改 `src/index.ts`。
