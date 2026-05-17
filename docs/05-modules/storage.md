# Module: Storage — 存储层

`packages/db` + `packages/graph` + `packages/object-store`。本文给出存储层的对外契约，避免业务模块直接 SQL / Cypher。

## 三种存储

| 存储           | 用途                                   | 真相级别           |
| -------------- | -------------------------------------- | ------------------ |
| PostgreSQL     | 元数据 / 证据 / 实体 / 队列 / 变更日志 | 单一真相           |
| Neo4j          | 图谱当前态                             | 物化视图（可重建） |
| Object Storage | 原始字节 (PDF/HTML/JSON 等)            | 原始证据物理保存   |

## packages/db

### 责任

- migration 管理
- Postgres 连接池与事务入口
- 按职责拆分的仓储/查询函数
- 对外只暴露稳定 re-export，避免业务层直接拼散乱 SQL

### 仓储分层

```
packages/db/src/
├── client.ts                  Postgres pool / migrate 入口
├── migrations.ts              schema_migrations + 版本顺序
├── migration-sql/
│   ├── 0001_entity_core.ts
│   ├── 0002_documents_graph.ts
│   ├── 0003_source_monitoring.ts
│   ├── 0004_review_quality.ts
│   └── ...
├── seed.ts                    seed 导入与必要数据回填
├── documents.ts               normalized document / chunks 写入
├── query.ts                   edge / evidence / unknown / entity 只读查询
├── changes.ts                 graph/source change timeline 查询
├── claims.ts                  claim / claim_evidence / claim_unknowns 仓储
├── observations.ts            observations / lead_observations 仓储
├── chain-views.ts             chain_views / chain_segments 仓储
├── pending.ts                 pending entity 写入与查询
└── index.ts                   稳定 re-export
```

### Repository 契约

每个职责文件暴露：

`observations.ts` 只负责 `observations` / `lead_observations` 的 insert/upsert/list/get。观测数据的幂等 ID、置信度范围、时间窗口等输入边界由 `@supplystrata/observation-store` 负责；仓储层不判断宏观信号是否能升级成事实边。

- 强类型查询/写入函数
- 不暴露原始 SQL string
- 复杂查询用命名方法（`listCurrentEdges`, `getEvidence`, `listChangeTimeline`）
- 事务支持：`tx` 参数可选

例：

```ts
export interface EvidenceRepo {
  insert(tx: Tx, ev: NewEvidence): Promise<Evidence>;
  findById(id: string): Promise<Evidence | null>;
  findByEdgeId(edgeId: string): Promise<Evidence[]>;
  supersede(tx: Tx, oldId: string, newId: string): Promise<void>;
}
```

业务模块依赖 `@supplystrata/db` 的稳定函数，不直接访问内部 migration 文件。中期如果引入更正式的 repo interface，也必须保持这个边界。

### 迁移规则

- `migration-sql/<n>_<purpose>.ts`，n 严格递增
- 已发布的迁移不允许修改字段；要改开新迁移
- `schema_migrations` 记录已执行版本
- 当前不做 down migration；需要回滚时开前向修复迁移

### 连接池

- pgbouncer 不做（MVP 单机够用）
- `pg.Pool` 由执行层显式创建并传入
- max connections：默认 20

## packages/graph

### 责任

- Neo4j 客户端封装
- 节点 / 关系 CRUD
- 查询 helper

### 接口

```ts
export interface Neo4jStore {
  upsertNode(input: NodeUpsert): Promise<void>;
  upsertEdge(input: EdgeUpsert): Promise<void>;
  deleteEdge(edgeId: string): Promise<void>;
  rebuild(stream: NodeOrEdgeStream): Promise<RebuildResult>;
  query<T>(cypher: string, params: Record<string, unknown>): Promise<T[]>;
}
```

### 约束

- query 接口允许写 raw Cypher，但**只**在查询模块（非业务模块）使用
- 任何 mutation 必须走 upsertNode / upsertEdge / deleteEdge / rebuild，不允许任意 Cypher
- 与 Postgres 的不一致由 housekeeping 修复

## packages/object-store

### 责任

- 把 RawDocument 字节写入物理存储
- 给一个 storage_key 拿回字节流

### 接口

```ts
export interface ObjectStore {
  put(key: string, body: Uint8Array | NodeJS.ReadableStream, meta?: Record<string, string>): Promise<void>;
  get(key: string): Promise<NodeJS.ReadableStream>;
  exists(key: string): Promise<boolean>;
  url(key: string, expiresInSeconds?: number): Promise<string>;
}
```

### 实现

- 默认：本地文件系统 (`data/raw/`)
- 可选：MinIO（S3 兼容）
- 切换由 env 控制：`OBJECT_STORE=fs|minio`

## 备份策略

| 存储           | 备份                                           |
| -------------- | ---------------------------------------------- |
| Postgres       | 每日 `pg_dump`，写入 `data/backups/pg/`        |
| Neo4j          | 不备份（可从 Postgres 全量重建）               |
| Object storage | 每日 rsync / 拷贝（仅在 MVP 期；上 S3 后无需） |

MVP 阶段所有备份留本地。生产部署再讨论异地备份。

## 性能

| 操作                                    | 目标    |
| --------------------------------------- | ------- |
| 单文档 evidence 插入                    | < 50ms  |
| 单条 edge 写 Postgres + Neo4j           | < 200ms |
| `supplystrata company nvidia --depth 1` | < 2s    |
| 全图 rebuild（Phase 0 数据量）          | < 60s   |
| 实体名搜索（fuzzy）                     | < 500ms |

不达标 → 加 index 或者优化查询，不轻易加复杂中间件。
