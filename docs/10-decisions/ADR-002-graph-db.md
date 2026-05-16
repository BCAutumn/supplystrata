# ADR-002 — 图数据库选择：Neo4j Community + PostgreSQL 真相存储

- **Status**: accepted
- **Date**: 2026-05-16
- **Deciders**: 项目维护者
- **Context window**: Phase 0；影响 storage 层与查询层

## Context

供应链数据天然是图。需要：

- 多跳查询（A → B → C → D）
- 不同 relation type 的过滤
- 节点 / 关系属性
- 可视化探索（Neo4j Browser 或前端图库）

候选：

- Neo4j（专业图数据库）
- PostgreSQL + 图扩展（Apache AGE / pgvector + 自写遍历）
- ArangoDB / TigerGraph / 其它专业图库
- 不上图库，纯 Postgres 自写递归 CTE

## Options Considered

### Option A: 仅 Postgres

- 优点：单一存储，运维最简单
- 缺点：
  - 多跳查询需要递归 CTE，写起来烦
  - 图遍历性能不及专门图库
  - 可视化探索差（没有 Neo4j Browser 这种工具）

### Option B: 仅 Neo4j

- 优点：
  - 图遍历快
  - Cypher 表达力强
  - 内置浏览器
- 缺点：
  - 不擅长存放大量元数据 / 文本块 / 队列
  - 备份/恢复 / 事务模型与 Postgres 不同
  - 关系上的复杂属性表达受限
  - 多种业务（队列 / 审计 / 报表）会被勉强往 Neo4j 塞

### Option C: Neo4j + Postgres 双存储

- 优点：
  - 各取所长
  - Postgres 是真相 / 历史 / 元数据
  - Neo4j 是图谱当前态的物化视图
  - 任一边不一致可以一键 rebuild
- 缺点：
  - 双写一致性需要工程努力
  - 运维多一个 component

### Option D: Postgres + Apache AGE 扩展

- 优点：单存储 + Cypher
- 缺点：
  - AGE 还在演进期；生态不如 Neo4j 成熟
  - 在 Apache AGE 上跑生产研究，调试 Cypher 错误会更难

## Decision

选择 **Option C：Neo4j Community + PostgreSQL 双存储**。

具体策略：

- Postgres 是单一真相
  - entity / alias / document / chunk / evidence / edge / change / queue / audit
- Neo4j 仅作图谱当前态的查询缓存
  - 节点 / 关系最小属性
  - 可被 Postgres 全量重建
- 写入流程：先 Postgres 事务 commit，再写 Neo4j；Neo4j 失败时返回 `graph_sync=failed`，不回滚 Postgres，可重建
- 删除：Postgres 永不物理删；Neo4j 中 deprecated 边可物理删（保持当前态干净）

## Consequences

### Positive

- 真相 / 缓存分离清晰
- 任意时刻可以 `supplystrata graph rebuild`
- 元数据查询走 Postgres（成熟）
- 图查询走 Neo4j（高效）

### Negative / Trade-offs

- 双存储运维复杂度
- 需要写 housekeeping 任务做一致性校验
- LXM / 双向同步若处理不当会有数据漂移

### Risks We Accept

- 短暂的"Postgres 已写、Neo4j 未写" 状态（重试或 rebuild 可恢复）

### Risks We Mitigate Now

- graph-builder 模块封装：业务模块只调高层 apply()，不直接写 Neo4j
- 设计 rebuild() 为幂等可中断
- 每日 housekeeping 一致性校验

## Implementation Notes

- 见 [graph-builder.md](../05-modules/graph-builder.md) 与 [storage.md](../05-modules/storage.md)
- Neo4j 节点最小属性：entity_id, kind, canonical_name, display_name, primary_country, status, industry
- Neo4j 关系最小属性：edge_id, evidence_level, confidence, is_inferred, validity, component, last_verified_at
- 完整 evidence / cite_text 永远去 Postgres 拉

## Revisit Triggers

- Apache AGE 进入稳定期 + 生态完善（潜在替换简化运维）
- 数据量增长到 Postgres 单机难以承载
- 团队希望简化部署

## References

- [storage.md](../05-modules/storage.md)
- [graph-builder.md](../05-modules/graph-builder.md)
- [schema.md](../03-data-model/schema.md)
