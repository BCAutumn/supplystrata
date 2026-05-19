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

如果要配置持续监控频率、初始检查时间和重试策略，先同步外部 source policy config：

```bash
pnpm --silent cli sources policy sync --file config/source-policies.example.json
pnpm --silent cli sources run-due --limit 5 --format markdown
pnpm --silent worker --once --limit 5
```

`policies[]` 配 source 级默认 cadence、jitter、priority、`next_check_at`、max attempts 和 backoff；`check_targets[]` 配具体监控目标，并可覆盖这些参数。`run-due` 和 worker 只读取这份配置入库后的有效值，不从 CLI 临时传重试策略。`worker --once` 适合本地验证，持续运行用 `pnpm worker --interval-ms 60000 --limit 10`。

如果要刷新关系强度、新鲜度和 explicit unknown：

```bash
pnpm --silent cli intelligence refresh --min-evidence-level 4 --limit 1000
```

`research run` 默认会执行同一类 edge intelligence refresh，并对研究包里已有 Level 4/5 component fact edge 的组件刷新 component risk baseline；它随后把 `edge_strength_estimates`、`edge_freshness`、strength unknown、component risk metrics 带进 Workbench JSON、CompanyCard、ComponentCard 与 ChainView：

```bash
pnpm --silent cli research run --company nvidia --depth 3 --out reports/nvidia-research-pack
```

研究包会额外生成 `question-readiness.json/md` 和 `investigation-backlog.json/md`。readiness 文件不调用 AI，也不生成正式答案；它们只根据当前 pack 里的 fact edge、evidence、observation、risk metric、source plan 和 unknown map，判断核心问题是 `ready`、`partial` 还是 `blocked`，并列出 supporting refs、missing requirements 和 unknown ids。backlog 文件会把这些 readiness gap、explicit unknown、组件覆盖缺口和 source-plan item 变成可审计的下一步调查任务；它只规划，不抓取、不落库、不写事实边。这样可以先知道数据是否足够，再决定是否进入人工分析或后续 AI 总结。

如果要让 TSMC / Samsung / SK hynix / ASML 这类已注册官方 IR connector 进入 runnable source target，而不是只停留在 planned backlog，可以给研究包传入披露年份：

```bash
pnpm --silent cli research run --company nvidia --depth 3 --official-year 2025 --source-target-namespace nvidia-memory-2025 --out reports/nvidia-research-pack
```

这只生成 `official-html-disclosure` 检查建议和 backlog runnable target，不自动运行 source、不写事实边。要把研究计划接入持续监控队列，用 source-management 的转换入口把 runnable suggestions 同步成 `source_check_targets`：

```bash
pnpm --silent cli sources policy sync-plan-targets --source-plan reports/nvidia-research-pack/source-plan.json --namespace nvidia-memory-2025
pnpm --silent cli sources policy sync-plan-targets --source-plan reports/nvidia-research-pack/source-plan.json --namespace nvidia-memory-2025 --enable --check-cadence-minutes 10080 --jitter-minutes 120
pnpm --silent cli sources policy enable-plan-targets --source-plan reports/nvidia-research-pack/source-plan.json --namespace nvidia-memory-2025 --next-check-at 2026-05-19T00:00:00.000Z --check-cadence-minutes 10080 --jitter-minutes 120
pnpm --silent cli sources due --source-plan reports/nvidia-research-pack/source-plan.json --namespace nvidia-memory-2025 --format markdown
pnpm --silent cli sources run-due --source-plan reports/nvidia-research-pack/source-plan.json --namespace nvidia-memory-2025 --limit 4 --format markdown
```

`sync-plan-targets` 默认写入 disabled target，适合先审计；显式 `--enable` 后才会被 `sources due/run-due` 和 worker 拾取。审计后如果要受控启用同一批 target，用 `enable-plan-targets` 从同一个 `source-plan.json + namespace` 重新计算 target id，只更新已同步 target 的 `enabled` 和 target 级 cadence / jitter / retry / `next_check_at` 覆盖值。它只修改监控配置，不抓源、不解析 PDF、不写事实边；missing target 会在结果中列出，表示需要先重新同步。

`sources due` 和 `sources run-due` 都支持同一组过滤参数：`--source-plan + --namespace`、`--check-target-id` 或 `--source`。建议先用 `sources due` 预览，确认只包含本轮要跑的小批量目标，再运行 `run-due`。这些过滤参数只限制 due target 范围，不改变 source policy，不改变 target config，也不让 observation 自动升级成 fact edge。

再次运行同一个 `research run --source-target-namespace nvidia-memory-2025` 时，研究包会输出 `source-target-coverage.json/md`。这个文件把 runnable source-plan target 对齐到 `source_check_targets / source_check_jobs / source_change_events / observations`，显示目标是否已同步、是否启用、是否 due、是否 degraded、最近 job/event 是什么，以及有没有产出 observation。`investigation-backlog.md` 也会把这些状态写进每个相关任务的 action 和 coverage 行里，例如“已同步但未启用”时会提示先启用 target，“source fetch degraded” 时会提示先排查源退化，而不是笼统提示去跑 source。它是监控闭环的可见性层，不会自动把 observation 升级成 fact edge。

只想从 truth store 做只读打包时，同时加 `--skip-intelligence-refresh --skip-component-risk-refresh`。只跳过 edge intelligence refresh 时，research-pack 仍会用已有 fact edge 刷新 eligible component risk baseline；没有事实边的组件不会被写入空 risk view。

如果要从 SEC companyfacts JSON 刷新结构化财报指标，先在 source policy config 里启用 `sec-edgar/sec-company-facts` 目标，然后运行：

```bash
pnpm --silent cli sources policy sync --file config/source-policies.example.json
pnpm --silent cli sources run-due --limit 10 --format markdown
```

示例配置已包含 NVIDIA / AMD / Micron / Intel / Microsoft 五个 `sec-edgar/sec-company-facts` target。这条路径只读取 SEC 官方 companyfacts JSON，把 inventory、cost of revenue、capex、purchase obligations、accounts payable 和 revenue 写成 company-scoped `FINANCIAL_METRIC_OBSERVATION`；同一 metric/unit 会用上一期作为 `baseline_value` 并写入 `change_value / change_percent`。它不解析 PDF，不写 fact edge。`segment_revenue` 和 customer concentration 不会由总收入 tag 伪造，后续需要维度/文本证据增强。后续可用 `intelligence observation-anomalies` 对这些财务指标做 baseline/change 检测。

如果要对已有公司财务 observation 做同行横向比较：

```bash
pnpm --silent cli intelligence financial-peers --limit 1000 --min-peer-count 3
```

该命令只写 `financial_metric_peer_zscore` risk view / metric。它只比较同 metric、同单位、同 fiscal period 的 company-scoped observations；没有 fiscal period 的旧数据才退回到同 time window 比较。输出会在 attrs 中保存 percentile、rank、peer_count 和 peer ids；样本不足时跳过，不写 fact edge，不推断供应关系。CompanyCard / research-pack 会在 `financial_peer_metrics` / `Financial peer position` 中显示这些同行位置指标。

如果要基于已刷新过的 strength / freshness 生成组件级 risk baseline：

```bash
pnpm --silent cli intelligence component-risk --component COMP-MEMORY
```

该命令只写 `risk_views / risk_metrics`，不写事实边。ComponentCard / research-pack 会在已有 risk view 时把 `supplier_concentration_hhi`、`single_source_exposure`、`path_redundancy`、`node_knockout_reach`、`node_knockout_weighted_impact`、`betweenness_centrality` 和 `freshness_adjusted_exposure` 带进 JSON/Markdown 输出；其中 `node_knockout_reach` 沿 supplier -> consumer 方向计算下游可达实体数，`node_knockout_weighted_impact` 用已知 `strength_weight * freshness_score` 计算 max-product path 传播影响，缺权重边只显式列为 gap，不补值。CompanyCard 会展示 company-scoped observations，并把与公司上游事实边相关的 component risk metrics 聚合为 `top_exposure_nodes`。如果新版 component risk view 相比上一版存在实质指标变化，会写入 `RISK_METRIC_CHANGED`，可用 `changes --scope risk_metric:<metric-key>` 或 `changes --type RISK_METRIC_CHANGED` 审计。`research run` 会自动批量刷新当前研究包中有可审计 Level 4/5 component fact edge 的组件；对只有 taxonomy/source-plan、还没有 fact edge 的组件保持缺口状态，不生成空风险结论。

如果已有 observations 带 `baseline_value / change_percent`，可以刷新 observation anomaly baseline：

```bash
pnpm --silent cli intelligence observation-anomalies --limit 1000 --threshold-percent 25 --z-threshold 3.5
```

该命令只写 observation-scoped `risk_views / risk_metrics`，不写事实边；真实异常会幂等写入 `OBSERVATION_ANOMALY` semantic change，供 changes timeline 和后续 alert rules 消费。changes timeline 会显示 metric、company/component scope、baseline、change percent、severity 和 source/doc 上下文；CompanyCard / ComponentCard / research-pack 会在已有 anomaly view 时把 `observation_anomaly` summary 带进 JSON/Markdown 输出。ComponentCard 会额外展示当前组件 fact edges 上 supplier/consumer 的 company financial signals，帮助把财务观测放回供应链节点语境。没有显式 baseline 但有足够同序列历史点时，会使用 trailing median/MAD；历史不足的 observation 会保持普通观测，不会被补造成异常。

如果要维护 Level 4/5 fact edge 的人工校准样本，可以先记录人工 label，再生成 calibration run：

```bash
pnpm --silent cli intelligence calibration-label EDGE-EXAMPLE --evidence EV-EXAMPLE --label correct --reviewer analyst
pnpm --silent cli intelligence calibration-label EDGE-BAD --evidence EV-BAD --label incorrect --error-category semantic_misread --reviewer analyst --rationale "generic supplier sentence"
pnpm --silent cli intelligence calibration-run --min-evidence-level 4 --limit 1000
```

`calibration-label` 只写人工 gold label；`calibration-run` 从已有 label 计算 precision、confidence reliability buckets 和错误类型汇总。校准结果用于方法学治理，不能自动改 fact edge，也不能自动修改 `evidence_level`。

如果要把 observation anomaly、source failure 和 component risk baseline 生成可去重的 alert candidates：

```bash
pnpm --silent cli intelligence alerts --since 2026-05-01T00:00:00.000Z --limit 1000
```

该命令只写 `alert_candidates`，alert 必须引用 `observation / risk_view / risk_metric / change / source_event` 等已有对象，不写事实边，也不自动发通知。可以用下面的命令查看和维护候选告警状态：

```bash
pnpm --silent cli intelligence alert-list --status open --limit 50
pnpm --silent cli intelligence alert-status ALT-EXAMPLE --status acknowledged --reviewer analyst --reason "reviewed in daily monitor"
```

`alert-status` 会写入 `ALERT_STATUS_CHANGED` semantic change，changes timeline 可用 `alert:<alert_id>` scope 追踪处理历史。正式 worker loop 和通知通道仍是后续工作。

如果要同时验证 Neo4j 物化图：

```bash
pnpm smoke:network
```

它会在研究链路基础上执行 `graph rebuild/check`，因此需要 Neo4j。

## 6. 发布前体检

```bash
pnpm release:check
```

它会跑本地发布前门禁：ignore rules、secret scan、type-check、unit、integration、fixture e2e、lint、dependency boundary 和无数据库 `smoke:local`。默认不要求 Docker、Postgres 或 Neo4j。

如果你要把本地 truth store / GraphStore 也纳入发布前体检：

```bash
pnpm release:check --with-db
```

这个模式会额外要求可连接的 SQL truth store 和 GraphStore，并运行 `dq run` / `graph check`。

## 不启动 Docker 时能看什么

如果只想快速看解析效果，可以用无数据库预览：

```bash
pnpm --silent cli preview nvidia --format markdown
pnpm --silent cli preview report nvidia --format markdown --lang zh
pnpm --silent cli preview apple-suppliers --limit 10 --format markdown
pnpm --silent cli research from-workbench --workbench reports/nvidia-workbench.json --out reports/nvidia-research-snapshot
pnpm --silent cli runtime doctor
```

这条路径不会落库，也不会写 GraphStore，适合未来嵌入 TS 桌面端或 agent 产品。`research from-workbench` 只消费已有 `WorkbenchModel` JSON，可以把一次 DB-backed 研究结果重新打包成静态目录；`preview` 则重新走抓取/解析/规则抽取。需要 review 队列、source health、changes timeline 或 Postgres truth store 时，需要连接 Postgres；需要图数据库物化视图、`graph rebuild/check` 或 Neo4j Browser 探索时，才需要 Neo4j adapter。

如果不确定自己该跑哪条路径：

```bash
pnpm --silent cli runtime doctor --format markdown
pnpm --silent cli runtime doctor --check-db --format json
```

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
