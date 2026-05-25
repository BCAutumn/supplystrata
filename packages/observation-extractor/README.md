# @supplystrata/observation-extractor

`observation-extractor` 从官方披露文本中抽取 observation draft 和 semantic section snapshot。

## 负责什么

- 对 10-K、10-Q、20-F、8-K、annual report 等 normalized document 做确定性句子规则匹配。
- 生成 inventory、backlog、capex、customer concentration、procurement 等 observation draft。
- 生成 semantic section fingerprint，用于变化检测。

## 不负责什么

- 不写数据库。
- 不生成 fact edge。
- 不把 observation 解释为供应链关系。
- 不调用 LLM。

## 主要入口

- `extractDisclosureObservations(document)`：生成 observation draft。
- `extractSemanticSections(document)`：生成 semantic section snapshot。

## 边界约定

observation 是信号层，不是事实层。规则应保持可解释、可测试；新增规则必须明确 observation type 和排除条件。
