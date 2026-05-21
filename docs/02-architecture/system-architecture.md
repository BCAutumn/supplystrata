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
│             Intelligence Maintenance / Derived Context               │
│  - edge_freshness: 根据 last_verified_at 计算确定性新鲜度                    │
│  - edge_strength_estimates: 只从明确 evidence 文本写强度                      │
│  - explicit unknown: strength 缺失时记录公开数据盲区                          │
│  禁止：写 fact edge、改 evidence_level、用 observation/LLM 伪造关系             │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                Query Layer                                            │
│  CLI → Markdown/JSON renderers                                       │
│  Worker → source_check_jobs 常驻消费                                  │
│  REST API (backend Gate 8)                                           │
│  Web UI (Phase 4+)                                                   │
└──────────────────────────────────────────────────────────────────────┘
```

## 设计要点

### 1. 单进程优先，source monitor 已有 Postgres job/outbox

核心 ingest / research 仍可由 CLI 单进程触发，方便本地复现和宿主 app 嵌入。持续 source-check 监控已经使用 Postgres-backed `source_check_jobs` durable job/outbox，并由 `apps/worker` 常驻消费；不引入 `pg-boss`、Redis 或 Kafka。

后续如果拆成 API / worker / 调度器，仍沿用“作业 + 事件 + DTO 契约”，不允许把调度状态散落在 CLI 参数或前端状态里。

### 2. Source Adapter 按业务内聚，不按数量机械拆包

早期文档要求“每个 Source Adapter 独立 package”。实践后发现这会让包数量膨胀，反而增加维护成本。新的规则是：

- adapter 的公共契约仍然统一走 `source-adapter-spec`。
- fetch / rate limit / snapshot runtime 统一走 `source-adapter-runtime`。
- 具体免费源的抓取、预览、监控 connector 编排优先放在 `source-workflows` 的对应 feature 内。
- 只有当某个源有独立发布价值、复杂依赖或明显不同生命周期时，才单独拆 package。

隔离靠接口、registry 和 contract test，而不是靠“每个源一个包”。

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

### 6. DatabaseStore 是真相存储；GraphStore 是查询缓存

如果图投影后端数据丢了，必须能从 DatabaseStore 全量重建。
反过来不行。
所有"证据 / 文档 / 实体 / 别名 / 变更"都在 truth store 里。当前内置 `DatabaseStore` adapter 是 Postgres；GraphStore 里只是"图谱当前状态的物化视图"。

当前内置 GraphStore adapter 是 Neo4j，适合本地图探索和路径查询。嵌入其它 TS 桌面端或 agent 产品时，可以由宿主提供自己的 GraphStore adapter；pipeline 不直接依赖 Neo4j。

### 7. Intelligence context 是派生层，不反写事实层

`edge_strength_estimates`、`edge_freshness`、strength unknown 和第一版 component `risk_views / risk_metrics` 由 `@supplystrata/evidence-maintenance` 维护。它们服务 Workbench、research-pack、card-builder 和未来 risk view，用来解释“关系重要不重要、多久没验证、哪里还不知道、当前派生风险能算到哪一步”。

这层只消费事实边、evidence、strength、freshness 和 unknown map，不允许写 `edges`，也不允许改变 `evidence_level`。没有明确 strength 时必须生成 explicit unknown 或在 risk metric attrs 中暴露不确定性，不能用均分、LLM 判断或 observation 代替事实证据。

### 8. LLM 用作"抽取助手"而非"事实生成器"

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
