# Quickstart — 从空环境跑到研究输出

本文面向第一次 clone 仓库的人，目标是用最少命令确认三件事：

- 代码能编译、数据库能迁移、seed 能导入。
- Postgres 真相存储能重建 Neo4j 物化图。
- 联网模式下能抓 SEC EDGAR 并输出 NVIDIA 供应链研究结果。

## 先决条件

- Node.js LTS >= 22
- pnpm >= 9
- Docker + Docker Compose v2

本仓库的 CLI 和数据源 adapter 都是 TypeScript。Docker 只用于本地 Postgres / Neo4j 测试环境，不是产品运行时的强依赖。

## 1. 安装依赖

```bash
pnpm install
cp .env.example .env
```

SEC/NVIDIA 规则切片不需要 LLM key。OpenCorporates / Companies House 查询需要在 `.env` 自行填写对应 key。

## 2. 启动本地数据库

```bash
docker compose up -d postgres neo4j
```

第一次启动 Neo4j 可能需要 5-15 秒。

## 3. 本地 smoke

```bash
pnpm smoke:local
```

它会执行：

1. `pnpm db:migrate`
2. `pnpm cli admin seed`
3. `pnpm cli graph rebuild`
4. `pnpm --silent cli graph check --format json`

这个模式不访问外网，只检查本机数据库、seed 和图谱同步链路。

## 4. 联网研究 smoke

```bash
pnpm smoke:network
```

它在本地 smoke 的基础上额外执行：

1. `pnpm cli pipeline nvidia`
2. `pnpm --silent cli company nvidia --format markdown`
3. `pnpm --silent cli unknown-map nvidia --format markdown`

通过后说明当前环境已经能从 SEC EDGAR 抓取 NVIDIA 10-K、解析公开披露、抽取供应链关系、评分证据、落 Postgres、重建 Neo4j，并输出 company card 与 unknown map。

## 5. 发布前体检

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

这条路径不会落库，也不会写 Neo4j，适合未来嵌入 TS 桌面端或 agent 产品。

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
