# System Architecture — 总体架构

## 高层视图

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Public Data Sources                         │
│  SEC EDGAR │ Company IR │ Apple Suppliers │ OpenCorporates │ ...      │
│  (Phase 3+) Comtrade │ Census │ EIA │ FRED │ NOAA │ SAM.gov │ GDELT  │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       Source Adapters (per source)                   │
│  统一接口 SourceAdapter<T>                                              │
│  - fetch(): 拉取原始数据                                                  │
│  - persist(): 落到对象存储 + documents 表                                  │
│  - emit(): 输出 NormalizedDocument 事件                                  │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                          Parsers (per format)                        │
│  HTML │ PDF │ XBRL company facts (Phase 3 sidecar) │ CSV/JSON │ Excel │
│  输出：DocumentChunks + ParsedTables                                    │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                  Entity Resolver  (核心，全局共享)                       │
│  - alias matching (规则)                                                │
│  - identifier matching (CIK/LEI/ISIN/Ticker)                          │
│  - LLM-assisted disambiguation (with human review queue)              │
│  → 解析为 entity_master.id                                              │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     Relation Extractor                               │
│  Pipeline:                                                            │
│  1. Rule-based extractors (高优先级，确定模式)                              │
│  2. LLM extractor (低优先级，候选)                                        │
│  3. Cross-source corroborator                                          │
│  输出：CandidateRelation + Evidence                                     │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     Evidence & Confidence Scorer                     │
│  - 给每条 candidate 打 evidence_level + confidence                       │
│  - 标 is_inferred                                                      │
│  - 触发 review queue（如果是 LLM 抽取的高 stakes 边）                        │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       Graph Builder                                  │
│  - 把 approved candidates 写入 Neo4j                                    │
│  - 维护 edge versioning（不物理删除）                                       │
│  - 触发 ChangeRecord                                                   │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│       Storage                                                        │
│  Postgres (元数据/证据/实体/文档/queue)                                     │
│  Neo4j Community (供应链图)                                              │
│  Object Store (原始 PDF/HTML/JSON, 本地 MinIO 或文件系统)                   │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                Query Layer                                            │
│  CLI (MVP only)  →  Markdown/JSON renderers                          │
│  REST API (Phase 3)                                                  │
│  Web UI (Phase 4+)                                                   │
└──────────────────────────────────────────────────────────────────────┘
```

## 设计要点

### 1. 单进程优先，但天生支持队列化

MVP 跑在单进程里，用 `pg-boss`（基于 Postgres 的轻量队列，不引入 Redis）。
但所有跨阶段调用必须通过"作业 + 事件"，不允许函数直接 import 调用。这样将来要拆成 worker / API / 调度器很容易。

### 2. 每个 Source Adapter 是独立 package

强制隔离。一个 source 改了 schema 不能影响别的。
所有 source adapter 实现 `packages/core` 里定义的同一接口（详见 [module-design.md](./module-design.md)）。

### 3. Entity Resolver 是单点真相

整个系统只能有一个 EntityResolver 实例，所有数据进入 Postgres / Neo4j 之前必须先经过它。
这是为什么实体消歧设计要先于一切关系抽取——错了就全错。

### 4. 写入链是单向、有审计的

```
candidate → review (optional) → approved → graph
                                        ↓
                                  ChangeRecord 落 Postgres
```

不允许直接往 Neo4j 写边而不经过这条流水线。

### 5. 原始数据永不丢

所有 fetch 到的原始字节（PDF / HTML / JSON）必须存进对象存储。
即使后续 schema 改了、解析器改了，也能从原文重新抽取。
这是可重现性与审计的物理基础。

### 6. Postgres 是真相存储；Neo4j 是查询缓存

如果 Neo4j 数据丢了，必须能从 Postgres 全量重建。
反过来不行。
所有"证据 / 文档 / 实体 / 别名 / 变更"都在 Postgres 里。Neo4j 里只是"图谱当前状态的物化视图"。

### 7. LLM 用作"抽取助手"而非"事实生成器"

LLM 调用全部通过 `packages/llm-bridge`。三件事必须做：

- 强制输出符合 zod schema 的结构化结果
- 强制每个抽取的关系附带原文片段（cite_text）
- 每次调用记录 prompt_hash + model + cost

LLM 抽取出的关系只作为候选：默认 `needs_review = true`，未经审核不得入图。LLM 抽取的证据最高为 Level 4，永远不能生成 Level 5；Level 5 只来自规则/人工确认的高可信官方披露。

## 物理部署（MVP）

```
开发机 / 单机
├── docker-compose 起：
│   ├── postgres:16
│   ├── neo4j:5-community
│   └── minio (可选)
├── pnpm 单仓库
└── tsx / node 跑 CLI 与 worker
```

不引入 Kubernetes、Redis、Kafka、Airflow。需要 Airflow 这种东西的时候，再讨论。

## 与"投资推断系统"的边界

```
SupplyStrata (本仓库)         |  外部下游消费者（Phase 4+，独立项目）
                              |
事实图谱 + 证据 + 不确定性          |  → 投资推断 / 回测 / 信号生成
不输出建议                        |  消费 SupplyStrata 的 JSON 输出
                              |  自己负责法律风险与策略决策
```

边界明确：本仓库**只**输出"事实 + 证据 + 不知道什么"。
谁要拿来做投资决策，是另一个项目的事。
