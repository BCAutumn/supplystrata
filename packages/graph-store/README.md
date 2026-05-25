# @supplystrata/graph-store

`graph-store` 定义图数据库投影的最小端口。

## 负责什么

- 定义 `GraphStore` 接口。
- 定义 graph edge input 和 projection stats。
- 作为 graph-builder 与具体图库实现之间的稳定端口。

## 不负责什么

- 不实现 Neo4j。
- 不访问 Postgres。
- 不决定哪些 edge 应该投影。
- 不作为 truth store。

## 边界约定

GraphStore 是可重建投影端口。事实真相永远以 Postgres truth store 和 evidence trace 为准。
