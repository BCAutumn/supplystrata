# Quickstart — 从空环境跑到研究输出

本文面向第一次 clone 仓库的人，目标是用最少命令确认三件事：

- 代码能编译、数据库能迁移、seed 能导入。
- Postgres 真相存储能重建 Neo4j 物化图。
- 联网模式下能抓 SEC EDGAR 并输出 NVIDIA 供应链研究结果。

## 先决条件

- Node.js LTS >= 22
- pnpm >= 9
- Docker + Docker Compose v2（可选）
- 可连接的 Postgres（持久化 pipeline / review / source monitor 需要）
- GraphStore 后端（可选；仓库内置 Neo4j adapter，图谱物化视图需要）

本仓库的 CLI 和数据源 adapter 都是 TypeScript。Docker 只用于一键启动本地 Postgres / Neo4j 测试环境，不是产品运行时的强依赖；嵌入其它 TS 桌面端或 agent 产品时，可以只调用无数据库 preview / adapter API，也可以连接宿主项目提供的 Postgres，并按需实现自己的 GraphStore adapter。

## 1. 安装依赖

```bash
pnpm install
cp .env.example .env
```

SEC/NVIDIA 规则切片不需要 LLM key。OpenCorporates / Companies House 查询需要在 `.env` 自行填写对应 key。

## 2. 先跑无数据库预览

如果只想确认 SEC 抓取、HTML normalize、规则抽取和 seed 消歧，先跑这个：

```bash
pnpm --silent cli preview nvidia --format markdown
pnpm --silent cli preview report nvidia --format markdown --lang zh
```

这条路径不会落库，也不会写 Neo4j。它走的是 source adapter `plan/fetch/normalize` 契约，所以适合验证未来嵌入式调用方式。

## 3. 启动本地数据库

```bash
docker compose up -d postgres neo4j
```

第一次启动 Neo4j 可能需要 5-15 秒。

如果你不用 Docker，改 `.env` 的 `POSTGRES_URL` / `NEO4J_*` 指向已有服务即可。

## 4. 本地 smoke

```bash
pnpm smoke:local
```

它会执行：

1. `pnpm db:migrate`
2. `pnpm cli admin seed`
3. `pnpm cli graph rebuild`
4. `pnpm --silent cli graph check --format json`

这个模式不访问外网，只检查本机数据库、seed 和图谱同步链路。

如果要跑真实 schema 上的 integration suite：

```bash
pnpm test:integration
```

它需要上一步的 Postgres 正在运行；否则会报 `ECONNREFUSED localhost:5432`。这类失败表示 Docker/Postgres 环境没起来，不是 parser、extractor 或 graph 逻辑失败。

## 5. 联网研究 smoke

```bash
pnpm smoke:research
```

它只要求 Postgres 可连接，不要求 Neo4j。它会执行：

1. `pnpm db:migrate`
2. `pnpm cli admin seed`
3. `pnpm cli pipeline nvidia --graph-sync defer`
4. `pnpm cli claims build --format json`
5. `pnpm cli workbench export --company nvidia --depth 3 --out reports/nvidia-workbench.json`

通过后说明当前环境已经能从 SEC EDGAR 抓取 NVIDIA 10-K、解析公开披露、抽取供应链关系、评分证据、落 Postgres，并输出 research workbench JSON。Neo4j 物化图可以稍后用 `pnpm cli graph rebuild` 单独重建。

如果要同时验证 Neo4j 物化图：

```bash
pnpm smoke:network
```

它会在研究链路基础上执行 `graph rebuild/check`，因此需要 Neo4j。

## 6. 发布前体检

```bash
pnpm release:check
```

它会跑本地发布前门禁：ignore rules、secret scan、type-check、unit、integration、fixture e2e、lint、dependency boundary、`smoke:local`、`dq run` 和 `graph check`。它不访问 SEC 外网。

## 不启动 Docker 时能看什么

如果只想快速看解析效果，可以用无数据库预览：

```bash
pnpm --silent cli preview nvidia --format markdown
pnpm --silent cli preview report nvidia --format markdown --lang zh
pnpm --silent cli preview apple-suppliers --limit 10 --format markdown
```

这条路径不会落库，也不会写 GraphStore，适合未来嵌入 TS 桌面端或 agent 产品。需要 review 队列、source health、changes timeline 或 Postgres truth store 时，需要连接 Postgres；需要图数据库物化视图、`graph rebuild/check` 或 Neo4j Browser 探索时，才需要 Neo4j adapter。

## 常见失败

### `graph check` 不同步

先跑：

```bash
pnpm cli graph rebuild
pnpm --silent cli graph check --format json
```

如果仍不同步，优先看 Neo4j 是否启动完成。

### SEC 抓取失败

`smoke:network` 依赖 SEC EDGAR 当前可访问。网络或 SEC 临时限流会导致失败；这不代表本地 DB/Graph 链路坏了，可以先跑 `pnpm smoke:local` 缩小问题范围。

### OpenCorporates / Companies House 没结果

这两个源需要用户自己配置 API key。没有 key 时命令应明确报认证缺失，不应该退化成网页抓取。
