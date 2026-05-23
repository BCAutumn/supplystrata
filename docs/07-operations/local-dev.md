# Local Dev — 本地开发

MVP 阶段一切都跑在本地 / 单机。

## 先决条件

- macOS / Linux（Windows 通过 WSL2）
- Node.js LTS ≥ 22
- pnpm ≥ 9
- Docker + Docker Compose v2（可选，只是本地 Postgres / Neo4j 的便捷启动方式）
- 可连接的 Postgres（持久化 pipeline / review / source monitor 需要；可以是 Docker，也可以是本机或远端服务）
- Neo4j（可选；只有图谱物化、`graph check/rebuild` 和可视化验证需要）
- (可选) Python 3.11+（XBRL sidecar，Phase 3 起）

## 一次性初始化

```bash
git clone <repo>
cd supplystrata

cp .env.example .env
# 编辑 .env：本地默认值已能跑通 SEC/NVIDIA 规则切片；LLM key 可先不填

pnpm install
```

到这里已经能跑无数据库 preview。Docker 不是必须安装项；只有当你想在本机同时启动 Postgres / Neo4j 时，才需要下面这一步：

```bash
docker compose up -d postgres neo4j
# 第一次启动等 ~10s

pnpm smoke:local --with-db
```

## 无 Docker 预览

如果只想看供应链解析，不需要启动 Postgres / Neo4j：

```bash
pnpm --silent cli examples nvidia preview --format markdown
pnpm --silent cli preview sec-edgar --cik 0001045810 --entity ENT-NVIDIA --types 10-K --format json
pnpm --silent cli examples nvidia report --format markdown --lang zh
pnpm --silent cli preview apple-suppliers --entity ENT-APPLE --fiscal-year 2022 --format markdown
pnpm --silent cli preview apple-suppliers --entity ENT-APPLE --fiscal-year 2022 --format csv > data/tmp/apple-supplier-review.csv
pnpm cli review enqueue apple-suppliers --entity ENT-APPLE --fiscal-year 2022
pnpm cli review stats
pnpm cli review next
pnpm cli review approve <REV-id> --reviewer <name> --reason "..."
pnpm cli review apply <REV-id> --reviewer <name>
pnpm cli review enqueue entity-source "3M" --source opencorporates --jurisdiction us_mn
pnpm cli entity pending list --status pending
pnpm cli entity pending show <PND-id>
pnpm cli entity pending lookup <PND-id> --source opencorporates --jurisdiction us_mn
pnpm --silent cli sources status
pnpm --silent cli sources list
pnpm --silent cli entity lookup "ARM HOLDINGS" --source companies-house --format markdown
pnpm --silent cli entity lookup "3M" --source opencorporates --jurisdiction us_mn --format json
```

这条路径只做 source adapter `plan/fetch/normalize`、规则抽取、seed 实体消歧和证据评分。它不会落库，也不会写 Neo4j，适合未来嵌入 TS 桌面端或 agent 产品。

`examples nvidia report` 还会并行读取 TSMC / Samsung / SK hynix / Micron / ASML 的公开官方披露作为背景证据。单个公司官网临时不可用时，报告会在对应章节标注失败原因，不会拖垮 NVIDIA 主链路；已缓存过的原始 HTML 会优先作为降级输入。

`preview apple-suppliers` 是半自动链路：只把 Apple Supplier List PDF 转成候选 CSV，所有行默认 `needs_review=true`。人工复核前，这些候选不会进入 Postgres / Neo4j。当前 Apple 官方静态 PDF 的元数据是 FY22，所以输出会标 `source_fiscal_year=2022`，不能把它当成 2025 或 2026 的最新供应商名单。

供应商名单解析逻辑已经抽成通用模块：`@supplystrata/supplier-list` 负责固定宽度表格到 review candidate，`apple-suppliers` 只是其中一个 source adapter。以后接其它公司的官方 supplier list 时，应新增 adapter 并复用这套候选结构，不要写 Apple 专用主路径。

review CSV 会同时带 `source_row_text` 和 `normalized_record_text`：前者保留 PDF 文本行，后者把跨行继承的 supplier / buyer 上下文显式补齐。未来 apply 时应展示两者，避免研究员只凭拆散后的字段确认关系。

`review enqueue apple-suppliers` 会把候选写入通用 `review_candidates` 表。这个表不是 Apple 专用，后续其它 supplier list、LLM fallback、manual evidence 都应复用同一 review 信封。

`review apply` 是严格路径：approved candidate 会先转成 `CandidateRelation`，再走实体解析。无法解析 supplier 时状态变成 `blocked`，并写入 `pending_entities`；不会为了跑通 demo 自动创建实体或写边。

需要批处理时用 `review apply-approved --limit N`。它只处理已经 approved 的候选，不会替研究员批准 pending 候选；适合把人工审核后的队列分批写入 Postgres。Neo4j 只是当前态物化视图，可以在研究任务之后用 `graph rebuild` 统一同步。

`entity lookup` 是实体源 preview：OpenCorporates 和 Companies House 都只返回外部候选，不写入实体主表。开源用户需要自己在 `config/source-credentials.local.json` 或环境变量里配置 `OPEN_CORPORATES_API_TOKEN` / `COMPANIES_HOUSE_API_KEY`；没有 key 时命令会显示上游认证缺失，而不是退化成网页抓取。

`review enqueue entity-source` 会把 lookup 结果转成 `entity_source_candidate`，复用通用 `review_candidates` 队列。approved 后执行 `review apply` 才会写入 `entity_master` / `entity_alias`；如果 identifier 或 alias 已属于其它实体，apply 会 blocked，避免误合并。

`entity pending` 是 blocked 供应商的工作台：`list` 看所有 unresolved surface，`show` 看触发上下文，`lookup` 用该 surface 查 OpenCorporates / Companies House。它不自动入队，避免把错误 registry 候选批量塞进 review。

如果 blocked surface 是 `3M` 这种高频、低歧义实体，可以走 curated seed 路径：补 `seeds/entities.csv` / `seeds/aliases.csv`，执行 `pnpm cli admin seed`，再 retry 原来的 `review apply`。apply 成功后会把同 surface 的 `pending_entities` 标记为 resolved。

## 日常工作流

### 启动 / 停止数据库

这只是本地开发方案之一。如果你已经有 Postgres / Neo4j，直接修改 `.env` 的 `POSTGRES_URL` / `NEO4J_*` 即可，不需要 Docker。

```bash
docker compose up -d
docker compose ps                  # 检查状态
docker compose logs -f postgres    # 看日志
docker compose down                # 停（保留数据）
docker compose down -v             # 停 + 清数据（慎用）
```

### CLI

```bash
pnpm --silent cli examples nvidia preview --format markdown
pnpm cli examples nvidia ingest --graph-sync defer
pnpm cli claims build --format json
pnpm cli workbench export --company nvidia --depth 3 --out reports/nvidia-workbench.json
pnpm cli graph rebuild
pnpm cli company nvidia --format markdown
pnpm cli evidence <EV-id> --format markdown
pnpm cli unknown-map nvidia --format markdown
pnpm cli ingest sec-edgar --cik 0001045810 --entity ENT-NVIDIA --types 10-K
pnpm worker --once --limit 5
```

`examples nvidia ingest` 默认 `--graph-sync defer`，也就是只写 Postgres truth store，不等待 Neo4j。需要边写边同步 Neo4j 时再显式传：

```bash
pnpm cli examples nvidia ingest --graph-sync sync
```

这个设计是为了未来嵌入 TS 桌面端或 agent 产品：宿主只需要提供 `DatabaseStore`（内置实现是 Postgres，也可以由宿主包装自己的兼容 SQL truth store），即可跑研究链路和 workbench export；Neo4j 可以作为可选的图查询加速层。

`pnpm worker --once --limit 5` 会跑一轮 source-check worker cycle；本地排查时用 `--once`，持续运行时用 `pnpm worker --interval-ms 60000 --limit 10`。监控频率和重试策略来自 `sources policy sync` 写入的配置，不在 worker 命令里临时覆盖。

### 测试

```bash
pnpm test                          # 离线单元测试，等同 pnpm test:unit
pnpm test:all                      # 所有 vitest 测试；无数据库时 integration/e2e 会按测试条件 skip
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm type-check
pnpm lint
pnpm dep-check
pnpm smoke:local                   # 无数据库 CLI smoke
pnpm smoke:local --with-db         # 本地 DB + seed + graph 同步
pnpm smoke:network                 # 额外跑 SEC/NVIDIA 联网研究切片
```

合并或移动 workspace package 依赖后，不要只更新 lockfile；还要跑一次 `pnpm install` 刷新本地 workspace symlink。`pnpm build` 会按独立 package 编译，依赖的是 `node_modules` 中的 workspace 链接，链接陈旧时会出现 type-check 通过但 build 找不到内部包的情况。

`test:integration` 和 `test:e2e` 会先探测 `POSTGRES_URL`。没有本地 Postgres 时会自动 skip，需要真实端到端写库验证时再启动你自己的 Postgres 服务；Docker 只是可选的本地启动方式，不是项目运行前提。

### 当前已验证命令链

```bash
pnpm install
docker compose up -d postgres neo4j
pnpm smoke:network
pnpm cli company nvidia --format markdown
pnpm cli unknown-map nvidia --format markdown
```

## 目录约定

```
data/
├── raw/                   原始字节（不入仓）
├── pg/                    Postgres 数据卷（不入仓）
├── neo4j/                 Neo4j 数据卷（不入仓）
├── minio/                 MinIO 数据卷（不入仓，可选）
├── backups/
│   ├── pg/                pg_dump 输出
│   └── object/            原始字节备份（rsync 出）
└── tmp/

seeds/                     种子数据（入仓）
├── entities.csv
├── aliases.csv
├── components.csv
└── hs-codes.csv

docs/                      本目录
packages/                  TS 包
apps/                      cli / worker
sidecars/                  Python sidecar
tests/                     fixtures / golden / e2e
```

## 重置数据库

```bash
docker compose down -v
docker compose up -d postgres neo4j
pnpm db:migrate
pnpm cli admin seed
```

## 常见问题

### Neo4j 启动慢

第一次启动会慢（5-15 s），等就行。日志看 `Started.`。

### Postgres 端口冲突

本地已有 Postgres：

```yaml
ports: ["55432:5432"]
```

并改 `.env` 的 `POSTGRES_URL`。

### pnpm 安装失败

- 清缓存：`pnpm store prune`
- 检查 Node 版本：必须 ≥ 22
- 网络代理问题：调整 `~/.npmrc`

### 数据库迁移失败

- 检查 `migrations/` 目录文件
- 手动连 Postgres 看 `_drizzle_migrations` 表
- 必要时 reset 数据库

### CLI 看不到 entity

- 确认 seed 已跑：`pnpm cli admin seed`
- 确认 entity 在 `seeds/entities.csv`
- 确认别名能归一化匹配。seed 导入会自动把 `canonical_name` 和 `display_name` 加入 `entity_alias`，高频简称仍应显式写进 `seeds/aliases.csv`

## 开发环境的"非生产"假设

本地开发允许：

- 跳过 robots.txt 检查（`--ignore-robots`）—— **仅** 在调试 fixture 时
- 用 fake LLM provider 返回固定结果
- 直接连 Neo4j 浏览器（http://localhost:7474）观察数据

不允许：

- 把生产 API key 写进本地 .env 后入仓
- 提交 data/ 下的内容
