# Embedding Runtime — 无 Docker 与宿主集成模式

本文定义 SupplyStrata 在三种运行形态下的边界。目标是让开源用户、桌面端、agent 宿主和未来独立前端都能复用同一套核心能力，而不是把系统绑死在 Docker、Neo4j 或某个 CLI 流程上。

## 运行模式矩阵

| 模式                 | 需要 Postgres | 需要 GraphStore / Neo4j | 需要 Docker | 典型命令                                                                     | 用途                                                   |
| -------------------- | ------------- | ----------------------- | ----------- | ---------------------------------------------------------------------------- | ------------------------------------------------------ |
| `preview`            | 否            | 否                      | 否          | `pnpm cli preview sec-edgar --cik <cik> --entity <entity-id>`                | 实时抓取、解析、规则抽取和 seed 消歧，不落库           |
| `workbench_snapshot` | 否            | 否                      | 否          | `pnpm cli research from-workbench --workbench reports/nvidia-workbench.json` | 从已有 Workbench JSON 生成静态研究包                   |
| `truth_store`        | 是            | 否                      | 否          | `pnpm cli research run --company <query> --out reports/research-pack`        | 持久化证据、claims、observations、review/source health |
| `graph_projection`   | 是            | 是                      | 否          | `pnpm cli graph rebuild && pnpm cli graph check`                             | 从 truth store 重建可插拔图投影                        |

Docker 只是本地一键启动 Postgres / Neo4j 的便捷方式。产品运行时不依赖 Docker；宿主可以提供自己的 Postgres、远程 Postgres、托管 SQL 或兼容 `DatabaseStore` 生命周期的 adapter。Neo4j 是当前内置 `GraphStore` adapter，不是事实存储。

## CLI 体检入口

```bash
pnpm --silent cli runtime doctor
pnpm --silent cli runtime doctor --check-db --format json
```

`runtime doctor` 不会自动启动任何服务。它只回答：

- 当前是否有可用的 Workbench JSON。
- 当前是否选择执行 Postgres ping。
- 哪些模式已经 ready，哪些模式需要补输入或服务。
- 每种模式的推荐命令。

这个命令适合 README onboarding、CI smoke、宿主 app 安装向导和调试用户环境。

运行形态判断逻辑位于纯包 `@supplystrata/runtime-profile`。CLI 只负责探测：

- `workbench_path` 是否存在。
- 是否执行 `POSTGRES_URL` ping。
- 当前 `.env` 里的 Postgres / Neo4j 连接串。

宿主 app 可以复用这个包生成自己的安装向导或设置页，不需要 shell 到 CLI。

## 宿主 app 集成建议

宿主 app 有三种集成深度。

### 1. 只消费 JSON

宿主只需要读取：

```text
WorkbenchModel
Research snapshot manifest
ChainViewModel
source-plan.json
evidence-index.json
```

推荐路径：

```bash
pnpm cli research from-workbench --workbench reports/nvidia-workbench.json --out reports/research-snapshot
```

这种方式不需要 Postgres、Neo4j 或 Docker，适合先把 SupplyStrata 的研究结果嵌入已有前端。

### 2. 调用 packages，但不持久化

宿主可以直接调用 source adapter / preview workflow：

```text
source adapter plan/fetch/normalize
rule extractor
seed entity resolver
evidence scorer
```

这条路径适合桌面端或 agent 在本地临时分析一份 SEC / IR 文档。它不产生 review queue、source health 或 changes timeline。

### 3. 注入 truth store

完整研究链路需要 `DatabaseStore`。当前内置实现是 Postgres：

```ts
import { createDatabaseStore } from "@supplystrata/db/write";

const store = createDatabaseStore({ connectionString: process.env.POSTGRES_URL });
```

宿主 app 也可以统一管理连接池生命周期，再把 `DatabaseStore` 传给 pipeline、workbench export、research-pack 等 use-case。GraphStore 保持可选；没有 GraphStore 时写入路径返回 deferred graph sync，不阻塞 truth store。

## 边界原则

1. `DatabaseStore` 是事实边、证据、claims、observations、review 和 changes 的真相边界。
2. `GraphStore` 是可重建物化视图，不保存不可恢复事实。
3. `WorkbenchModel` 是前端/宿主的稳定 JSON 契约，运行时校验位于 `@supplystrata/workbench-export/schema`。
4. `research from-workbench` 是静态再打包，不刷新数据、不写库、不补证据。
5. `research run` 是 DB-backed 打包入口，不抓新源、不写新事实边；默认只读整理现有 truth store 数据，只有显式传入 `--prepare-data` 或单项刷新 flag 时才写 claims、edge intelligence 或 risk views。
6. 任何自动抽取、LLM 候选、弱观测或线索都不能绕过 review/evidence policy 进入事实图。

## 当前限制

- 内置 `DatabaseStore` adapter 仍是 Postgres。其它 SQL/embedded adapter 需要后续按同一事务和 query 契约实现。
- `workbench_snapshot` 只能复用已有 Workbench JSON，不能替代 DB-backed source health / review/apply / changes 写入。
- Neo4j 适合本地图探索和图查询，但宿主 app 可以改用自己的 GraphStore adapter。
