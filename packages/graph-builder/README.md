# @supplystrata/graph-builder

`graph-builder` 是审核后事实关系写入和图投影同步的边界。Postgres 仍是 truth store，Neo4j / GraphStore 只是可重建投影。

## 负责什么

- 把 approved candidate 写成 current fact edge 和 evidence。
- 生成 evidence trace fingerprint、source snapshot hash、parser/extractor metadata。
- 维护 edge deprecation。
- 同步或延迟 GraphStore 投影。
- 提供 graph projection rebuild、consistency check 和 retry job 能力。

## 不负责什么

- 不生成 candidate。
- 不自动批准 review candidate。
- 不从 observation、lead、official signal 或 unknown 自动创建 fact edge。
- 不把 GraphStore 当 truth store。
- 不绕过 evidence trace 写事实边。

## 主要入口

- `new GraphBuilder(store, resolver, options)`：创建事实写入器。
- `GraphBuilder.apply(approved)`：写入 approved relation candidate。
- `GraphBuilder.deprecate(input)`：受控废弃事实边。
- `GraphBuilder.rebuild()` / `checkConsistency()` / `retryProjectionJobs()`：投影维护。
- `GraphSqlWriter`：事务内 SQL 写入能力。

## 边界约定

事实边只能来自已审核 candidate，且必须保留 evidence trace。GraphStore 同步失败不能回滚 Postgres truth；失败应进入 projection retry 路径。
