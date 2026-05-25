# @supplystrata/signal-extractor

`signal-extractor` 从官方披露正文中抽取 review-only official disclosure signal。

## 负责什么

- 对 TSMC、SK hynix、Samsung、ASML、Micron 等官方 IR 文档执行确定性信号规则。
- 生成带 cite_text、confidence 和 evidence_level hint 的 signal。
- 保留原文片段，供 review queue 和 research-pack 复核。

## 不负责什么

- 不写 review queue。
- 不写 observation、evidence 或 fact edge。
- 不判断 signal 是否支持某条 edge。
- 不调用 LLM。

## 主要入口

- `extractOfficialDisclosureSignalsForSource(sourceAdapterId, text)`：按来源抽取 signal。
- `listOfficialDisclosureSignalSourceAdapterIds()`：列出支持 signal 抽取的来源。

## 边界约定

official signal 是复核线索，不是二源 corroboration。它必须经 disposition 或其它 review-only 路径处理后，才能影响 unknown/backlog。
