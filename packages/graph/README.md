# @supplystrata/graph

`graph` 是 `GraphStore` 的 Neo4j 实现。

## 负责什么

- 创建 Neo4j driver。
- 维护 Neo4j schema。
- upsert entity / edge projection。
- 删除投影 edge。
- 返回投影统计。

## 不负责什么

- 不写 Postgres truth store。
- 不创建事实边。
- 不做证据评分。
- 不决定 edge lifecycle。

## 主要入口

- `createNeo4jDriver(config)`：创建 Neo4j driver。
- `Neo4jGraphStore`：GraphStore 实现。

## 边界约定

Neo4j 只服务查询和可视化投影。投影损坏时应通过 graph-builder rebuild/retry 恢复，而不是反向修正 truth store。
