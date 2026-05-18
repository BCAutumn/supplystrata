# Module: Storage — 存储层

`packages/db` + `packages/graph-store` + `packages/graph` + `packages/object-store`。本文给出存储层的对外契约，避免业务模块直接 SQL / Cypher。

## 三种存储

| 存储            | 用途                                   | 真相级别           |
| --------------- | -------------------------------------- | ------------------ |
| SQL Truth Store | 元数据 / 证据 / 实体 / 队列 / 变更日志 | 单一真相           |
| GraphStore      | 图谱当前态                             | 物化视图（可重建） |
| Object Storage  | 原始字节 (PDF/HTML/JSON 等)            | 原始证据物理保存   |

## packages/db

### 责任

- migration 管理
- `DatabaseStore` 接口与内置 `PostgresDatabaseStore`
- 按职责拆分的仓储/查询函数
- 对外只暴露稳定 re-export，避免业务层直接拼散乱 SQL

### 仓储分层

```
packages/db/src/
├── client.ts                  DatabaseStore 接口 / Postgres adapter / migrate 入口
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

### DatabaseStore 契约

`DatabaseStore` 是 truth store 的运行边界。业务执行层只依赖：

```ts
export interface DbClient {
  query<T>(sql: string, params?: readonly unknown[]): Promise<QueryResult<T>>;
}

export interface DatabaseStore extends DbClient {
  readonly adapter_id: string;
  transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
```

当前内置 adapter 是 `PostgresDatabaseStore`，继续使用项目现有 Postgres SQL、事务和迁移。这个抽象的目的不是假装所有 SQL 方言已经可用，而是让 TS 桌面端 / agent 宿主可以注入自己的 truth store 生命周期，并避免 CLI / pipeline / graph-builder 直接绑死 `pg.Pool`。

约束：

- pipeline / card-builder / source-monitor 只接收 `DbClient` 或 `DatabaseStore`；render 是纯 DTO formatter，不接收数据库客户端。
- 需要事务的写入路径通过 `DatabaseStore.transaction()` 表达事务边界；业务模块不能手写 `BEGIN/COMMIT/ROLLBACK` 或直接获取底层连接。
- 非 Postgres adapter 必须提供兼容当前 SQL contract 的实现；不允许在业务层加方言分支。

## packages/graph-store

### 责任

- 定义图投影后端的稳定接口
- 让 `graph-builder` 只依赖接口，不依赖 Neo4j driver
- 允许宿主 app 提供自己的图后端 adapter

### 接口

```ts
export interface GraphStore {
  close(): Promise<void>;
  ensureSchema(): Promise<void>;
  clear(): Promise<void>;
  upsertEntity(entity: EntityRecord): Promise<void>;
  upsertEdge(edge: GraphEdgeInput): Promise<void>;
  stats(): Promise<GraphProjectionStats>;
}
```

## packages/graph

### 责任

- Neo4j GraphStore adapter
- Neo4j schema / 节点 / 关系投影
- Neo4j Browser 或路径查询相关 helper

### 约束

- query helper 允许写 raw Cypher，但**只**在 Neo4j adapter / 查询模块使用
- 任何 mutation 必须走 GraphStore 的 upsertEntity / upsertEdge / clear，不允许业务模块任意 Cypher
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
