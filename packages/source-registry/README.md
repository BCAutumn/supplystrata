# @supplystrata/source-registry

`source-registry` 是公开来源权威矩阵。它回答“某个来源是什么、最多能证明什么、自动化状态如何”。

## 负责什么

- 登记 source adapter id、来源类别、权威层级、证据等级上限、是否需要 key、自动化状态和 ToS/官方 URL。
- 为 evidence scorer 提供 `sourceAuthorityFor(...)`。
- 给 source-plan、source-management、research-pack 和 CLI 提供来源清单。

## 不负责什么

- 不执行 source adapter。
- 不保存 source policy 或 source check target。
- 不根据 document type 自动授予高 evidence level。
- 不把未注册来源当作官方来源。

## 主要入口

- `listSources()`：列出来源。
- `getSourceById(sourceAdapterId)`：查单个来源。
- `sourceAuthorityFor(input)`：查询权威上限。
- `sourceStatusSummary()`：汇总来源状态。

## 边界约定

未注册来源默认只能作为低等级 lead/context。新增 source 必须先登记权威边界，再接 connector 或 workflow。
