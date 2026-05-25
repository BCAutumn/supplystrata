# @supplystrata/evidence-scorer

`evidence-scorer` 是候选关系进入事实写入前的确定性证据评分层。

## 负责什么

- 根据 source registry、document type、relation authority、extractor method 和原文语气计算 evidence level。
- 计算 confidence 和 confidence breakdown。
- 标记候选是否需要 review。
- 限制 LLM、弱语气、未来语气和低权威来源的最高证据等级。

## 不负责什么

- 不抽取关系候选。
- 不写 evidence 或 edge。
- 不覆盖 source registry 的证据等级上限。
- 不把宏观、lead-only 或 registry-only 来源提升成供应链事实边。

## 主要入口

- `DeterministicEvidenceScorer.score(candidate, doc, options)`：评分入口。
- `EvidenceScorer`：评分器接口。

## 边界约定

evidence scorer 只能降低或约束候选可信度，不能凭规则制造事实。最终写入仍必须走 review 和 graph-builder。
