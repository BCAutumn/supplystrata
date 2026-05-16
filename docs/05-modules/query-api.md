# Module: Query API — 查询接口（Phase 3 起）

`apps/api`。MVP **不实现**。本文写明未来契约，避免 MVP 阶段的设计阻碍后期。

## 时机

- Phase 3 起视情况上线
- 主要消费者：另一个独立项目（投资推断系统 / 研究面板）

## 技术选型（候选）

- **Hono**：轻量、运行在 Node / Bun / 边缘
- 或 **Fastify**：更成熟，schema-first

ADR 待开。

## 设计原则

1. 与 CLI 共享同一组 packages（query layer）
2. 不重新实现业务逻辑
3. 严格只读（mutation 只走 CLI / pipeline）
4. JSON Schema 必须导出

## 端点（草案）

```
GET /v1/company/:ref
GET /v1/component/:name
GET /v1/entity/:id
GET /v1/edge/:id
GET /v1/evidence/:id
GET /v1/changes?since=...&scope=...
GET /v1/search?q=...
```

返回结构与 CLI 的 JSON 输出完全一致（共享 schema）。

## 不做

- 不做认证 / 多租户（单用户内部使用）
- 不做 GraphQL
- 不做 WebSocket / SSE 推送
- 不做数据下载 dump（直接读文件即可）

## 安全

- 部署前必须放在私网或带反代基本认证
- 不暴露 Postgres / Neo4j 端口
- 不允许 DoS 风险查询（深度 > 3 的 Cypher）

更多细节等 Phase 3 ADR。
