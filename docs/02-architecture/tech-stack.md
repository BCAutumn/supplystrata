# Tech Stack — 技术选型

主语言决议见 [ADR-001](../10-decisions/ADR-001-language-choice.md)，图库决议见 [ADR-002](../10-decisions/ADR-002-graph-db.md)，LLM 用法见 [ADR-003](../10-decisions/ADR-003-llm-strategy.md)，monorepo 拆包见 [ADR-004](../10-decisions/ADR-004-monorepo-structure.md)。本文档是这些决议的"工程清单视图"。

## 总览

| 层             | 选型                                  | 备选 / 备注                                                            |
| -------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| 主语言         | TypeScript (strict)                   | XBRL 与个别 NLP 任务通过 Python sidecar                                |
| 运行时         | Node.js LTS (>= 22)                   | 不用 Bun（生态稳定优先）                                               |
| 包管理         | pnpm + workspaces                     | 不用 npm/yarn                                                          |
| 构建/任务      | Turborepo                             | 仅作 task pipeline 用，不强依赖                                        |
| 测试           | vitest                                | + supertest（API 测试 phase 3）                                        |
| 代码规范       | eslint + prettier + typescript-eslint | + dependency-cruiser (循环/反向依赖检查)                               |
| 类型/校验      | zod                                   | 所有外部 IO 必须过 zod                                                 |
| HTTP           | undici                                | Node 内置；不引入 axios                                                |
| HTML 解析      | cheerio                               | + parse5（备）                                                         |
| 抓取（必要时） | Playwright (Chromium)                 | 仅在数据源明确允许且必要时                                             |
| PDF 解析       | pdfjs-dist 或 unpdf                   | MVP 复杂 PDF 走半自动 CSV + 人工 review；Phase 3 再评估 Python sidecar |
| XBRL           | SEC company facts JSON                | Phase 3 起完整 XBRL 再接 Python sidecar (arelle)                       |
| Excel/CSV      | xlsx + papaparse                      |                                                                        |
| 主数据库       | PostgreSQL 16                         | 通过 docker-compose                                                    |
| 图数据库       | Neo4j 5 Community                     | 仅作"图谱当前状态"物化视图                                             |
| ORM            | drizzle-orm                           | 不用 prisma（drizzle 更贴近 SQL，迁移控制更细）                        |
| 队列           | Postgres-backed `source_check_jobs`   | `apps/worker` 常驻消费 source-check job；不引入 pg-boss / Redis        |
| 对象存储       | 本地 FS（默认）/ MinIO（可选）        | S3 接口兼容                                                            |
| LLM            | Anthropic / OpenAI（任一）            | 通过 `llm-bridge` 抽象                                                 |
| 嵌入向量       | （Phase 3 再评估）pgvector            | MVP 不做语义检索                                                       |
| 全文搜索       | Postgres tsvector（够用）             | OpenSearch 留 Phase 3                                                  |
| 日志           | pino                                  | + pino-pretty (dev)                                                    |
| 指标           | （Phase 3）prom-client                | MVP 用结构化日志                                                       |
| CLI            | commander                             | 简单。oclif 太重                                                       |
| 配置           | env + zod schema                      | 不引入 config 库                                                       |
| Docker         | docker-compose v2                     | 不上 K8s                                                               |
| CI             | GitHub Actions                        | 单 workflow，分 lint/test/build 三 job                                 |

## 为什么是 TypeScript（与不是别的）

被认真考虑过的：

- **Python**：在 NLP / 数据处理 / arelle / pdfminer 上更成熟。但对 monorepo、严格类型、长期维护上的体感不如 TS。最终决定 TS 主栈 + Python sidecar 组合。
- **Go**：系统能力强，但 LLM SDK / NLP / PDF 解析生态弱。
- **Rust**：性能优秀但 dev velocity 不利于研究类项目。
- **Bun**：太新，部分库 native 模块兼容性问题，留观。

承认 TS 在以下场景不如 Python：

1. XBRL 解析（arelle 是事实标准）
2. 复杂 PDF（pdfminer.six / pypdf）
3. NER / spaCy 这种成熟 NLP

这些在后续完整 XBRL / 复杂 PDF 阶段再用 Python sidecar 调用，不强行 TS 化。当前主路径保持纯 TypeScript；复杂 PDF 以半自动流程和人工 review 兜底。

## docker-compose（开发用）

```yaml
# docker-compose.yml (示意，不直接写代码)
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: supplystrata
      POSTGRES_USER: supplystrata
      POSTGRES_PASSWORD: dev
    ports: ["5432:5432"]
    volumes: ["./data/pg:/var/lib/postgresql/data"]

  neo4j:
    image: neo4j:5-community
    environment:
      NEO4J_AUTH: neo4j/devpassword
      NEO4J_PLUGINS: '["apoc"]'
    ports: ["7474:7474", "7687:7687"]
    volumes: ["./data/neo4j:/data"]

  minio: # 可选
    image: minio/minio
    command: server /data --console-address :9001
    environment:
      MINIO_ROOT_USER: supplystrata
      MINIO_ROOT_PASSWORD: devsecret
    ports: ["9000:9000", "9001:9001"]
    volumes: ["./data/minio:/data"]
```

## Python Sidecar（XBRL / PDF）

`sidecars/xbrl-py/`：

- 独立的 Python 项目（uv / poetry）
- 通过 stdio 或本地 HTTP server 与 TS 通信（MVP 用 stdio + JSON Lines）
- 接口被 TS 端 `packages/parsers/xbrl/` 包装为 promise-based API
- 沙箱化：sidecar 只读输入文件、只写输出 JSON，不接触 DB

## LLM 选型

MVP 阶段：

- **首选**：Anthropic Claude（结构化输出、长 context、对法律/事实类任务的可控性）
- **备选**：OpenAI GPT
- **本地模型**：暂不考虑（成本/质量不达标）

通过 `packages/llm-bridge` 抽象：

```ts
interface LlmExtractor<TIn, TOut> {
  schema: z.ZodSchema<TOut>;
  extract(input: TIn): Promise<TOut>;
}
```

每次调用必须记录：

- model
- prompt_hash
- input_tokens / output_tokens
- cost_usd
- latency_ms

详见 [ADR-003](../10-decisions/ADR-003-llm-strategy.md)。

## 严格的 TypeScript 配置

`tsconfig.base.json` 关键项（不可妥协）：

```jsonc
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true,
    "isolatedModules": true,
    "skipLibCheck": true
  }
}
```

理由：研究类系统的 bug 90% 来自类型偷懒和悄悄的 undefined。`noUncheckedIndexedAccess` 和 `exactOptionalPropertyTypes` 会前期烦人，但能挡掉一大类后期 debug 灾难。

## 不引入 / 故意排除的依赖

| 不用                  | 理由                                                                               |
| --------------------- | ---------------------------------------------------------------------------------- |
| Express / Koa         | 暂无 HTTP API；后续 `apps/api` 优先评估 Hono                                       |
| Prisma                | 偏 ORM 重，迁移控制粒度不如 drizzle                                                |
| Knex                  | 老旧                                                                               |
| Redis                 | 现有 source-check worker 使用 Postgres job/outbox，不需要 Redis                    |
| Kafka                 | 单机够用；持续监控用 Postgres job/outbox + 事件表替代                              |
| Airflow / Prefect     | 单进程 + 队列足够                                                                  |
| LangChain / LangGraph | 抽象太重，等价功能用直接 SDK + zod 几十行即可，且 LLM 流水线太复杂会变 fail-silent |
| ChromaDB              | 用 pgvector                                                                        |
| Mongoose / MongoDB    | 用 Postgres                                                                        |
| Lerna                 | pnpm workspaces 已经够用                                                           |

## 版本固定与升级

- `package.json` 固定 minor 版本（`^x.y.z` -> `~x.y.z`）
- `pnpm-lock.yaml` 必须入仓
- 关键依赖（drizzle / neo4j-driver / undici / playwright / cheerio / pdfjs / vitest / zod）任何升级都要在 PR 标题写 `[deps]` 并跑全测试

## 性能目标（MVP）

不追求极致性能。以"能跑通 + 可观测"为主：

- 单次 SourceAdapter 抓取 < 30s
- 单文档解析 + 抽取 + 评级 < 60s（不含 LLM 调用）
- LLM 调用 < 30s 单次
- CLI 查询响应 < 2s（一级深度）

如果某条数据流跑了几小时还没完，应当先看代码，不是先扩机器。
