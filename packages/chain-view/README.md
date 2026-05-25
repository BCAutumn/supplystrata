# @supplystrata/chain-view

`chain-view` 定义供应链链路视图的稳定 DTO。

## 负责什么

- 定义 company chain view、segment、endpoint、source hint 和 stats。
- 区分 edge、claim、observation、lead、unknown 等语义层。
- 提供 segment 统计函数。

## 不负责什么

- 不查询数据库。
- 不构建链路。
- 不渲染 UI。
- 不写事实层。

## 主要入口

- `ChainViewModel` / `ChainViewSegmentModel`：链路视图契约。
- `summarizeChainSegments(segments)`：统计语义层数量。

## 边界约定

chain-view 是 DTO contract。构建逻辑属于 `chain-view-builder`，展示逻辑属于 `render` 或前端。
