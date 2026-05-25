# @supplystrata/workbench-export

`workbench-export` 是 research workbench 的只读 DTO 聚合层。它把 truth store 中的链路、claim、evidence、unknown、source health、review queue、attention queue 和 intelligence context 组装成稳定 JSON 契约。

## 负责什么

- 构建 `WorkbenchModel`。
- 导出 company graph、chain segments、edges、claims、draft claims、evidence、unknown map、source health、source plan、change timeline、attention queue、review queue 和 edge intelligence。
- 把 DB row 映射成 Workbench DTO。
- 保留 official disclosure signal disposition 的 review-only policy。

## 不负责什么

- 不写数据库。
- 不抓取 source。
- 不刷新 claim、risk 或 edge intelligence。
- 不执行 review apply。
- 不把 review queue item 自动转成事实边。

## 主要入口

- `buildWorkbenchModel(client, input)`：生成完整 Workbench DTO。
- `parseWorkbenchModel(text)` / `normalizeWorkbenchModelJson(...)`：读取和兼容旧 snapshot。
- `buildWorkbenchAttentionQueue(...)`：构建 attention queue。

## 边界约定

Workbench DTO 是对外消费契约，不能直接暴露 DB row 形状。新增字段应先确认它属于 Workbench 契约，而不是为了方便把持久化列透传出去。
