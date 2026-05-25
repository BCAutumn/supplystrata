# @supplystrata/source-plan

`source-plan` 是公开来源规划层。它把组件、公司、材料、贸易和官方披露 target profile 转成“应该检查哪些来源”的计划。

## 负责什么

- 根据 component taxonomy 生成上游组件、材料、贸易和官方披露 source plan item。
- 对 target profile 中的官方来源 hints 生成 runnable 或 planned source suggestions。
- 确保计划引用的来源已经登记在 source registry。
- 输出可被 `source-management` 预览、同步、启用和 smoke 的标准计划结构。

## 不负责什么

- 不抓取外部来源。
- 不验证凭据。
- 不写数据库。
- 不生成 observation、evidence、fact edge 或 unknown。
- 不自动发现长尾 IR 页面；缺 URL 的公司级官方披露目标必须保持为缺口。

## 主要入口

- `planSourcesForComponents(input)`：多组件 source plan 入口。
- `planSourcesForComponent(componentId, ...)`：单组件便捷入口。
- `planSourcesForComponentLead(lead, ...)`：从已知 taxonomy lead 生成计划。

## 边界约定

source plan 是“调查路线图”，不是事实图谱。它可以说某个来源值得检查，不能说某条供应链关系已经成立。
