# @supplystrata/data-quality

`data-quality` 是 truth store 的只读质量检查包。

## 负责什么

- 检查 current edge 是否有 active evidence。
- 检查 evidence cite text、chunk trace、traceability metadata、duplicate relation candidate 和 LLM 约束。
- 检查 primary evidence 是否与最佳 evidence 匹配。
- 检查 parsed document 是否有 chunks。
- 检查指定 entity unknown map 是否达到最低 open item 数。

## 不负责什么

- 不修复数据。
- 不写 fact edge、evidence 或 unknown。
- 不运行 source check。
- 不替代人工审阅。

## 主要入口

- `runDataQualityChecks(client, input)`：运行质量检查。
- `DATA_QUALITY_RULES`：规则清单。
- `dataQualityRules(input)`：按输入生成规则集。

## 边界约定

data-quality 只暴露问题。修复必须由明确的 migration、maintenance use-case 或 review workflow 承接。
