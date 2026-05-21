# Module: CLI — 命令行接口

`apps/cli`。MVP 阶段对外的**唯一**接口。

当前实现按职责拆分：

- `main.ts`：只创建 `Command` 实例并注册命令模块，避免入口文件继续膨胀。
- `commands/db-admin.ts`：数据库迁移、seed、evidence trace 回填。
- `commands/pipeline-preview.ts`：ingest / pipeline / preview 相关命令。
- `commands/sources-changes.ts`：source registry、source health、source policy、changes timeline。
- `commands/entity-review.ts`：entity lookup / pending entity / review queue。
- `commands/graph-dq-cards.ts`：graph、data quality、company / chain / component / evidence / unknown-map 卡片。
- `cli-utils.ts`：`--format` / `--limit` 等参数解析、JSON/Markdown 输出、`DatabaseStore` 生命周期。
- `preview-render.ts`：NVIDIA / Apple supplier preview 和研究报告渲染。
- `entity-render.ts` / `review-render.ts` / `source-render.ts`：各自领域的展示层。

约束：未来的 TypeScript + Canvas 研究工作台、桌面端或 agent 产品要复用 packages 能力，不能把业务判断写进 CLI render 层。

## 设计原则

1. **结构化输出优先**：默认 `--format` 至少支持 `markdown` 和 `json`。
2. **不在 CLI 输出里夹杂业务逻辑**：CLI 只调用 packages，不做转换。
3. **可脚本化**：所有命令支持 `--quiet`，错误退出码非 0。
4. **可重现**：所有命令幂等（除非显式 mutation），同一命令多次运行结果一致（modulo 数据变化）。

## 命令树

```
supplystrata
├── db
│   ├── migrate
│   └── backfill-evidence-trace [--limit]
├── admin
│   └── seed
├── ingest
│   └── sec-edgar --cik <cik> [--entity] [--types] [--graph-sync]
├── pipeline
│   └── nvidia [--graph-sync]
├── preview
│   ├── nvidia [--format]
│   ├── apple-suppliers [--format] [--limit]
│   ├── sec-edgar --cik <cik> [--entity] [--types] [--format]
│   └── report
│       └── nvidia [--format] [--lang]
├── sources
│   ├── list [--format]
│   ├── status [--format]
│   ├── sync
│   ├── health [--format]
│   ├── due [--limit] [--format]
│   └── policy
│       ├── sync --file <path>
│       ├── preview-plan-targets --source-plan <path> --namespace <name>
│       ├── smoke-plan-targets --source-plan <path> --namespace <name>
│       ├── sync-plan-targets --source-plan <path> --namespace <name>
│       └── enable-plan-targets --source-plan <path> --namespace <name>
├── changes [--since] [--scope] [--type] [--source] [--attention-only] [--limit] [--format]
├── company <ref> [--format]
├── component <name> [--format]
├── evidence <id> [--format]
├── chain <company> [--depth] [--format]
├── workbench export --company <company> [--out]
├── research
│   ├── run --company <company> [--component <ids>] [--out <dir>]
│   └── from-workbench --workbench <file> [--component <ids>] [--out <dir>]
├── runtime
│   └── doctor [--check-db] [--workbench <file>] [--format]
├── unknown-map <company-query> [--format]
├── entity
│   ├── lookup <query> [--source all|opencorporates|companies-house] [--jurisdiction] [--limit] [--format]
│   └── pending
│       ├── list [--status pending|resolved|all] [--limit] [--format]
│       ├── show <PND-id> [--format]
│       └── lookup <PND-id> [--source all|opencorporates|companies-house] [--jurisdiction] [--limit] [--format]
├── review
│   ├── stats
│   ├── next
│   ├── show <id>
│   ├── approve <id>
│   ├── reject <id> [--reason]
│   ├── apply <id>
│   ├── apply-approved [--reviewer] [--limit] [--format]
│   └── enqueue
│       ├── apple-suppliers
│       └── entity-source <query> [--source] [--jurisdiction] [--limit]
├── graph
│   ├── rebuild
│   ├── check [--format]
│   └── retry-projections [--limit]
└── dq
    └── run [--format]
```

## 主要命令规格

卡片命令的实现约束：

```text
company / component / chain / evidence / unknown-map
```

CLI 必须显式先调用对应 loader 生成 card/view model，再调用纯 formatter 输出 Markdown 或 JSON。不要把新的 SQL 查询、实体解析或业务判断塞进 formatter；后续这些 loader 会迁到独立 card/use-case 包，供 API 与 TypeScript + Canvas 工作台复用。

### supplystrata preview

无数据库预览路径，用来检查抓取、解析、抽取和评分，不写 Postgres / Neo4j：

```bash
supplystrata preview nvidia --format markdown
supplystrata preview sec-edgar --cik 0001045810 --entity ENT-NVIDIA --types 10-K --format markdown
supplystrata preview sec-edgar --cik 0001045810 --entity ENT-NVIDIA --types 10-Q --format markdown
supplystrata preview sec-edgar --cik 0001045810 --entity ENT-NVIDIA --types 8-K --format markdown
supplystrata preview apple-suppliers --format csv
```

`--types` 支持逗号分隔的 `10-K,10-Q,20-F,8-K`。SEC adapter 内部也支持 `limit` 计划多份最近 8-K task，供后续 source monitor 调度层复用；当前 CLI preview 仍只消费第一个 task。

### supplystrata pipeline / ingest

数据库研究路径，用来把候选关系写入 Postgres truth store：

```bash
supplystrata pipeline nvidia --graph-sync defer
supplystrata ingest sec-edgar --cik 0001045810 --entity ENT-NVIDIA --types 10-K --graph-sync defer
```

`--graph-sync` 可选：

```text
defer  默认；只写 Postgres，不等待 Neo4j。适合研究工作台、桌面端嵌入和批处理。
sync   写 Postgres 后尝试同步 Neo4j 当前态；Neo4j 不可用时 Postgres commit 仍然保留。
```

需要 Neo4j 当前态时，推荐研究任务结束后统一执行：

```bash
supplystrata graph rebuild
supplystrata graph check --format json
```

### supplystrata company `<ref>`

```
ref         可以是 ticker / cik / lei / entity_id / 别名
--depth N   默认 1（一级上游）；2 = 二级
--format    markdown (默认) | json
--include-inferred       是否包含 Level 1-3 边（默认否）
--lang en|zh             仅影响 markdown 渲染
```

返回：CompanyCard（[output-spec.md](../01-product/output-spec.md)）。

退出码：

- 0：成功
- 2：实体不存在
- 3：歧义（返回候选列表）
- 1：其他错误

### supplystrata component `<name>`

```
name        组件 ID、组件名或别名（如 "COMP-MEMORY" / "memory" / "HBM"）
--format    markdown | json
```

返回 ComponentCard：known_suppliers、known_consumers、evidence_edges、source_coverage、trade_taxonomy、related_observations、unknown_map。它只读取 `components` taxonomy、`component-context` 目录、observation 层和图谱边，不绑定 Apple / NVIDIA。

### supplystrata chain `<company>`

```
company     公司名、别名、ticker 或 entity_id
--depth N   默认 2，最大 5
--format    markdown | json
```

返回 chain-first upstream view。它沿 Level 4-5 的 `BUYS_FROM` / `USES_FOUNDRY` / `SUPPLIES_TO` / `MANUFACTURES_AT` 边递归展开，默认不展示 Level 1-3 推断边。

JSON 输出消费 `@supplystrata/chain-view` 的 `CompanyChainViewModel`，每段都有 `semantic_layer`。当前支持 `edge`、`claim`、`observation`、`lead`、`unknown` 分层；observation / lead / unknown 是上下文 segment，不带 `evidence_level`，不改变事实边语义，也不进入 Neo4j fact edge。

### supplystrata workbench export

```
--company <query>       公司名、别名、ticker 或 entity_id
--depth N               chain 展开深度，默认 2
--since <date>          changes 时间线起点
--change-limit N        changes 最大条数
--source-limit N        source health 最大条数
--out <path>            写入 JSON 文件；不传则输出到 stdout
```

导出 `apps/research-preview` 消费的本地 JSON。这个命令由 `@supplystrata/workbench-export` 组装数据，CLI 只负责参数解析和写文件。JSON 包含 `companies / chain_segments / edges / claims / draft_claims / evidences / unknown_items / sources / changes`，前端不得直连数据库补字段。`draft_claims` 只用于侧栏研究草稿，不属于 ChainView 主链路。`evidences` 会包含 ChainView 事实边上的全部 evidence 和 superseded evidence，方便工作台做证据审计，而不是只展示 primary evidence。

### supplystrata research run

```
--company <query>          公司名、别名、ticker 或 entity_id
--component <ids>          可选；强制加入研究包的组件 ID，逗号分隔
--depth N                  chain/source-plan 深度，默认 3
--since <date>             changes 时间线起点
--trade-month YYYY-MM      可选；生成 Census Trade runnable target 建议
--trade-country <code>     可选；Census partner country code
--official-year YYYY       可选；生成已注册官方 IR / 受控 company-ir / 监管目录 runnable target 建议
--target-profile <id|none> 可选；研究目标 profile，默认自动选择内置 ai-compute-memory.v0，传 none 可关闭
--material-year YYYY       可选；生成 USGS/IEA 风格 planned target 建议
--commodity-month YYYY-MM  可选；生成 World Bank runnable target 建议
--source-target-namespace <name> 可选；匹配 source_check_targets 的命名空间
--source-target-preflight <file> 可选；打包显式 source-plan smoke JSON，不重新抓源
--skip-claims              不先刷新 active claims
--skip-intelligence-refresh 不刷新 edge strength/freshness/strength unknown
--skip-component-risk-refresh 不刷新 eligible component risk baseline
--out <dir>                输出目录，默认 reports/research-pack
```

把已有 truth-store 数据打包成可复现研究包。它不接新源、不联网抓取、不写图谱事实边；默认刷新 claim 层、edge intelligence context，并对研究包里已有 Level 4/5 component fact edge 的组件刷新 component risk baseline，然后导出 `workbench.json`、CompanyCard、ChainView、ComponentCard、source plan、data-quality report、question readiness matrix、official disclosure readiness、investigation backlog、source target coverage 和 manifest。`--source-target-preflight` 只读取显式传入的 smoke JSON，并把它写成 `source-target-preflight.json/md`；research-pack 不会因此重新访问外部源。这个命令由 `@supplystrata/research-pack` 负责，CLI 只做参数解析和写目录。

`question-readiness.json/md` 只回答“当前数据够不够回答核心问题”，不会生成自然语言结论，也不会把缺口补成事实。`official-disclosure-readiness.json/md` 把 Gate 1 相关的研究目标 profile、逐节点覆盖状态、逐 expected source 覆盖状态、Level 4/5 fact edge 数、完整 traceability、严格 cross-source corroboration、strength/freshness 覆盖、explicit unknown、profile expansion candidates 和官方披露 source target 状态量化；它不会把 single-source silence 自动解释为已审计，也不会写事实边。内置 `ai-compute-memory.v0` 是验收锚点，不是全球供应链全集；不在 profile 中但被事实边或官方 source-plan 发现的节点会进入 `profile_expansion` backlog，等待审阅是否纳入 profile。expected source 覆盖会把 profile 期待来源拆成 `covered_fact / official_target_synced / official_target_runnable / official_source_planned / connector_available / source_registered_unimplemented / missing_source_mapping` 等状态，避免把“来源清单”误解成“已经接通监控”。research-pack 会把 target profile hints 下沉给 source-plan：已有 CIK 的 SEC 公司生成 `sec-company-filings` runnable suggestion，已有官方 IR connector 的来源在显式年份存在时生成 node-specific `official-html-disclosure` suggestion，带审计 HTTPS URL 的 `company-ir` 目标生成受控长尾 IR suggestion，DART / EDINET / TWSE 监管目录 connector 在显式年份存在时生成目录 monitor suggestion；缺显式 URL、公司级代码、connector 或 config 的来源仍是缺口。`investigation-backlog.json/md` 把 readiness gap、official disclosure gap、expected source gap、profile expansion candidate、explicit unknown、组件覆盖缺口和 source-plan item 汇总成下一步调查任务，供人工或未来安全 agent 消费；它不运行 adapter，也不写 DB。`source-target-coverage.json/md` 把 runnable source-plan target 与 `source_check_targets / source_check_jobs / source_change_events / observations` 对齐，显示 target 是否已同步、启用、due、运行、重试、degraded、dead 或已经产出 observation。backlog 会消费 coverage 状态，把 action 写成“先同步 / 启用 / 跑 due / 等待 active job / 排查 failed/degraded job / review observation”这类可执行下一步。component risk refresh 只覆盖有可审计 fact edge 的 eligible 组件；只有 taxonomy 或 source-plan 的组件会继续显示为 coverage gap。

示例：

```bash
supplystrata research run --company nvidia --component COMP-HBM,COMP-MEMORY --official-year 2025 --trade-month 2025-12 --commodity-month 2025-12 --source-target-namespace nvidia-memory-2025 --out reports/nvidia-research-pack
```

### supplystrata research from-workbench

```
--workbench <file>        既有 WorkbenchModel JSON
--component <ids>         可选；强制加入 source plan 的组件 ID，逗号分隔
--depth N                 source-plan 深度；默认沿用 workbench.chain.max_depth
--trade-month YYYY-MM     可选；生成 Census Trade runnable target 建议
--trade-country <code>    可选；Census partner country code
--official-year YYYY      可选；生成官方 IR / 监管目录 runnable target 建议
--target-profile <id|none> 可选；研究目标 profile，默认自动选择内置 ai-compute-memory.v0，传 none 可关闭
--material-year YYYY      可选；生成 USGS/IEA 风格 planned target 建议
--commodity-month YYYY-MM 可选；生成 World Bank runnable target 建议
--source-target-namespace <name> 可选；渲染 expected source target coverage 的命名空间
--source-target-preflight <file> 可选；打包显式 source-plan smoke JSON，不重新抓源
--out <dir>               输出目录，默认 reports/research-pack-snapshot
```

无数据库静态路径。它只读取已有 `WorkbenchModel` JSON，通过 `@supplystrata/workbench-export/schema` 做运行时校验，然后输出 `manifest.json / workbench.json / chain.md / source-plan.json / evidence-index.json`。这条路径不连接 Postgres / Neo4j，不需要 Docker；适合把一次 DB-backed 深跑结果交给其它 app、桌面端或静态研究工作台复用。

示例：

```bash
supplystrata research from-workbench --workbench reports/nvidia-workbench.json --component COMP-HBM,COMP-MEMORY --out reports/nvidia-research-snapshot
```

### supplystrata runtime doctor

```
--workbench <file>  用于静态 snapshot 模式的 WorkbenchModel JSON
--check-db          尝试连接 POSTGRES_URL
--format            markdown | json
```

输出当前环境能跑哪些运行模式：`preview`、`workbench_snapshot`、`truth_store`、`graph_projection`。它不会启动 Docker，也不会自动创建数据库；只是把“当前能跑什么、缺什么”讲清楚，适合开源用户和未来宿主 app 的安装向导。

示例：

```bash
supplystrata runtime doctor
supplystrata runtime doctor --check-db --format json
```

### supplystrata claims build

```
--min-level 4|5
--limit N
--generated-by <id>
--format markdown | json
```

从已验证事实边生成 claim 层。它只扫描 current、非 inferred、有 primary evidence 的 Level 4/5 边；重复运行会更新同一个确定性 claim，不会产生重复结论。

### supplystrata evidence `<id>`

```
返回 EvidenceCard。
若 evidence 已 superseded，输出 base 卡片 + supersession chain。
```

### supplystrata unknown-map `<scope> <id>`

```
scope: company | component | topic
id   : 对应 ID
```

返回 UnknownMap。

### supplystrata changes

```
--since YYYY-MM-DD       默认 7 天前，也可传 ISO datetime
--scope <scope>           可选，company:<id> / entity:<id> / edge:<id> / alert:<id> / risk_metric:<key> / risk_view:<id> / source:<id>
--type <change_type>      可选，支持 change_records.change_type 或 source_change_events.event_type
--source <adapter-id>     可选，按 source_adapter_id 过滤
--attention-only          只看需要研究员关注的变化
--limit N                 默认 50
--format markdown | json
```

返回 ChangeRecord + source_change_events 合并后的 timeline。Markdown 默认分成 `Requires attention` 与普通 `Timeline`；JSON 保留结构化字段，供未来 TypeScript + Canvas 工作台消费。

示例：

```bash
supplystrata changes --since 2026-05-01 --format markdown
supplystrata changes --scope company:ENT-NVIDIA --format json
supplystrata changes --source sec-edgar --attention-only
```

### supplystrata intelligence calibration

```bash
supplystrata intelligence calibration-label EDGE-EXAMPLE --evidence EV-EXAMPLE --label correct --reviewer analyst
supplystrata intelligence calibration-label EDGE-BAD --label incorrect --error-category entity_resolution_error --reviewer analyst --rationale "wrong counterparty"
supplystrata intelligence calibration-run --min-evidence-level 4 --limit 1000
```

`calibration-label` 写人工 gold label；`calibration-run` 只从这些 label 计算 precision、reliability buckets 和 error summary。它不写事实边，不改变 evidence level，也不替代 review/apply。

### supplystrata sources check

### supplystrata sources catalog

```
--format markdown | json
```

展示统一数据源管理面：每个 `source_adapter_id` 的 registry 状态、自动化边界、证据上限、是否需要 key、当前已注册的可执行 connector，以及每个 connector 的 `target_config` 字段契约。这个命令不连接数据库，也不抓源，适合开源用户或宿主 App 在配置前先查看“哪些源能直接跑、target_config 应该怎么写、哪些只是 registry 占位、哪些只能手工”。

示例：

```bash
supplystrata sources catalog --format markdown
supplystrata sources catalog --format json
```

`sources policy sync` 会在写入 Postgres 之前调用同一套 source-management 校验：未注册 source、未注册 target kind、`target_config` 字段类型/枚举错误、manual-only 源启用自动 target 都会直接失败；需要 API key 的源会返回 warning，但不阻止同步。

### supplystrata sources plan

```
--component <ids>           组件 ID，支持逗号分隔
--entity <ids>              可选，公司上下文；例如 ENT-APPLE 会允许 Apple Supplier List 进入计划
--depth N                   上游链路深度，默认 3
--trade-month YYYY-MM       可选；给 Census Trade 生成可运行 observation target 建议
--trade-country <code>      可选；Census partner country code
--trade-directions <dirs>   imports,exports，默认两者都生成
--material-year YYYY        可选；给 USGS/IEA 风格年度材料观测生成计划目标
--commodity-month YYYY-MM   可选；给 World Bank 风格月度商品价格观测生成计划目标
--official-year YYYY        可选；给已注册官方 IR、受控 company-ir 和监管目录 connector 生成披露检查目标
--format markdown | json
```

这个命令读取 `@supplystrata/component-context` 的上游依赖目录、`Component-HS-Material taxonomy` 和 `Material taxonomy`。没有 period 参数时，它只回答“该查哪些源”；传入月份或年份后，会生成 `suggested_check_targets`。

- `census-trade / trade-flow-observation` 当前是 runnable target。
- `worldbank-pink / commodity-price-observation` 当前是 runnable target，可按月写入商品价格 observation。
- `usgs-mcs / mineral-supply-observation` 当前是 planned target，先用于配置规划和前端展示，等 adapter 接入后再变成 runnable。
- 所有这些目标只会落 observation 层，不会生成图谱事实边。

示例：

```bash
supplystrata sources plan --component COMP-MEMORY --depth 3 --trade-month 2025-12 --trade-country 5800
supplystrata sources plan --component COMP-HBM --material-year 2025 --commodity-month 2025-12 --official-year 2025 --format json
```

### supplystrata sources policy preview-plan-targets

```
--source-plan <path>              research-pack 生成的 source-plan.json
--namespace <name>                生成 check_target_id 的稳定命名空间
--enable                          可选；按启用状态预览 validation warning
--next-check-at <iso>             可选；target 级初始 next_check_at
--check-cadence-minutes N         可选；target 级检查频率
--jitter-minutes N                可选；target 级 jitter
--max-attempts N                  可选；target 级最大重试次数
--backoff-base-minutes N          可选；target 级退避基数
--backoff-max-minutes N           可选；target 级退避上限
--format markdown | json
```

无数据库审计 `research run` / `research from-workbench` 输出的 runnable `suggested_check_targets`。转换和校验都在 `@supplystrata/source-management` 内完成；CLI 只渲染结果。预览会输出稳定 namespace、将生成的 `check_target_id`、去重后的 target 数、按 source / target kind / priority 的统计、需要凭据的 target 数，以及同一套 source-management validation error/warning。它不写 `source_check_targets`，也不抓源；适合在宿主 App 或命令行里先确认这批监控目标是否值得同步。

示例：

```bash
supplystrata sources policy preview-plan-targets --source-plan reports/nvidia-research-pack/source-plan.json --namespace nvidia-memory-2025 --format markdown
```

### supplystrata sources policy smoke-plan-targets

```
--source-plan <path>              research-pack 生成的 source-plan.json
--namespace <name>                生成 check_target_id 的稳定命名空间
--source <ids>                    可选；只跑这些 source adapter，逗号分隔
--limit N                         可选；限制本次 smoke 的 target 数
--format markdown | json
```

无数据库执行 `source-plan.json` 里的 runnable target：只跑对应 adapter 的 `plan / fetch / normalize`，输出每个 target 的 planned task、fetched document、normalized document、degraded fallback 和错误信息。它不连接 Postgres、不写 `source_check_targets`、不记录 source monitor event，也不写 observation / fact edge；适合在同步到持续监控队列前先验证外部源是否可达、凭据是否缺失、target config 是否真的能执行。

这条路径和 `sources run-due` 复用同一批 adapter 与 target config 解析函数，但不复用 DB 写入流程。也就是说，smoke 成功只说明“源能抓、能 normalize”，不代表已经进入持续监控闭环；正式调度仍要走 `sync-plan-targets / enable-plan-targets / due / run-due`。

示例：

```bash
supplystrata sources policy smoke-plan-targets --source-plan reports/nvidia-research-pack/source-plan.json --namespace nvidia-memory-2025 --source sec-edgar --limit 2 --format markdown
```

### supplystrata sources policy sync-plan-targets

```
--source-plan <path>              research-pack 生成的 source-plan.json
--namespace <name>                生成 check_target_id 的稳定命名空间
--enable                          可选；立即启用生成的 target
--next-check-at <iso>             可选；target 级初始 next_check_at
--check-cadence-minutes N         可选；target 级检查频率
--jitter-minutes N                可选；target 级 jitter
--max-attempts N                  可选；target 级最大重试次数
--backoff-base-minutes N          可选；target 级退避基数
--backoff-max-minutes N           可选；target 级退避上限
```

把 `research run` / `research from-workbench` 输出的 `source-plan.json` 里的 runnable `suggested_check_targets` 同步成 `source_check_targets`。转换规则在 `@supplystrata/source-management` 内完成：只消费 runnable target，不抓源、不写事实边；`check_target_id` 由 namespace、source、target kind 和 target_config 的稳定 hash 生成；默认 `enabled=false`，只有显式 `--enable` 才进入 `sources due/run-due` 或 worker 调度。

示例：

```bash
supplystrata sources policy sync-plan-targets --source-plan reports/nvidia-research-pack/source-plan.json --namespace nvidia-memory-2025
supplystrata sources policy sync-plan-targets --source-plan reports/nvidia-research-pack/source-plan.json --namespace nvidia-memory-2025 --enable --check-cadence-minutes 10080 --jitter-minutes 120
```

### supplystrata sources policy enable-plan-targets

```
--source-plan <path>              research-pack 生成的 source-plan.json
--namespace <name>                已同步 target 使用的稳定命名空间
--next-check-at <iso>             可选；target 级初始 next_check_at
--check-cadence-minutes N         可选；target 级检查频率
--jitter-minutes N                可选；target 级 jitter
--max-attempts N                  可选；target 级最大重试次数
--backoff-base-minutes N          可选；target 级退避基数
--backoff-max-minutes N           可选；target 级退避上限
--notes <text>                    可选；写入启用说明
```

启用已经同步过的 runnable source-plan targets。它会重新从同一个 `source-plan.json + namespace` 计算稳定 `check_target_id`，只更新已存在的 `source_check_targets.enabled` 和 target 级 cadence / jitter / retry / `next_check_at` 覆盖值，不改变 `target_config`，不抓源、不写事实边。manual-only 或 rejected source 会被阻止启用；缺失 target 会在 JSON 结果里列为 `missing_check_target_ids`，方便先回到 `sync-plan-targets`。

示例：

```bash
supplystrata sources policy enable-plan-targets --source-plan reports/nvidia-research-pack/source-plan.json --namespace nvidia-memory-2025 --next-check-at 2026-05-19T00:00:00.000Z --check-cadence-minutes 10080 --jitter-minutes 120
```

```
--source <adapter-id>       source registry / connector id，例如 sec-edgar、tsmc-ir、census-trade、osh
--target-kind <kind>        可选；同一个 source 有多个 target kind 时必须指定
--config <json>             直接传入 connector target_config
--config-file <path>        从 JSON 文件读取 target_config
--cik <cik>                 SEC 便捷字段；会写入 target_config.cik
--entity <entity-id>        便捷字段；会写入 target_config.entity_id
--forms <forms>             SEC 便捷字段；逗号分隔：10-K,10-Q,20-F,8-K
--year <year>               IR / observation 便捷字段；会写入 target_config.year
--query <query>             搜索型 connector 便捷字段；会写入 target_config.query
--limit N                   最多检查几份文件 / 观测项
--format markdown | json
```

运行单个 source check：CLI 只把参数转换成 connector target config，然后交给 `@supplystrata/source-connectors` 注册表分发。具体源的 `plan/fetch/normalize`、文档保存、`source_change_events` 写入和 observation 抽取都在 pipeline connector 内完成。若同一个 source item 的官方披露内容发生变化，还会记录客户集中、库存、backlog、capex、采购义务等语义 section diff，以及供应商、客户、foundry 候选关系新增/移除 diff。采购义务、产能预留、单一供应商风险会从普通 supplier relation diff 中分离出来。这个命令不自动 apply graph edge，适合 monitoring 调度或手工检查源是否变化。

新增免费/公开数据源时，应新增 connector 并注册；不要在 CLI 中继续写 `if source_adapter_id === ...`。如果同一个 source 只有一个 connector，`--target-kind` 可以省略；如果一个 source 有多个 target kind，必须显式传入以避免误跑。

示例：

```bash
supplystrata sources check --source sec-edgar --cik 0001045810 --entity ENT-NVIDIA --forms 10-Q,8-K --limit 3
supplystrata sources check --source tsmc-ir --config '{"entity_id":"ENT-TSMC","year":2025}'
supplystrata sources check --source company-ir --config '{"entity_id":"ENT-EXAMPLE","year":2025,"url":"https://investor.example.com/annual-report"}'
supplystrata sources check --source edinet --target-kind daily-filings --config '{"date":"2025-06-30","type":2,"scope_kind":"component","scope_id":"COMP-SILICON-WAFER","component_id":"COMP-SILICON-WAFER","doc_type_codes":["120"]}'
supplystrata sources check --source twse-mops --target-kind electronic-documents --config '{"stock_code":"2317","entity_id":"ENT-FOXCONN","year":2025,"document_kind":"F","limit":50}'
supplystrata sources check --source osh --target-kind facility-search --config '{"query":"Foxconn","scope_id":"ENT-FOXCONN","limit":10}'
supplystrata sources check --source worldbank-pink --config '{"commodity":"copper","period":"2025-12","material_id":"MAT-COPPER","component_id":"COMP-HBM","scope_kind":"component","scope_id":"COMP-HBM"}'
```

### supplystrata sources run-due

```
--limit N                  最多执行几个到期检查目标
--check-target-id <ids>    可选；只列出 / 执行这些 source_check_targets，逗号分隔
--source <ids>             可选；只列出 / 执行这些 source adapter，逗号分隔
--source-plan <path>       可选；用 research-pack source-plan.json 计算 target id
--namespace <name>         与 --source-plan 搭配，必须和同步 target 时一致
--format markdown | json
```

执行 `source_check_targets` 中已经到期的目标。它先把 due target enqueue 到 `source_check_jobs`，再用 `FOR UPDATE SKIP LOCKED` claim job，通过 `@supplystrata/source-connectors` 找到对应 connector，逐个运行 adapter 的 `plan/fetch/normalize`，然后记录 source event 与 observation。`sources due` 支持同样的 `--check-target-id / --source / --source-plan / --namespace` 过滤参数，用于先审计将要运行的目标；`run-due` 过滤只影响 enqueue/claim 的 target 范围，不改变 target config，不绕过外部 policy。失败 job 会进入 `failed` 并按平方退避重试；超过 `max_attempts` 后进入 `dead`，不会被 cached fallback 误记为成功。当前可执行目标类型包括 `sec-edgar / sec-company-filings`、`sec-edgar / sec-company-facts`、`company-ir` 与 TSMC / Samsung / SK hynix / Micron / ASML 官方 IR 的 `official-html-disclosure`、Apple Supplier List 的 `supplier-list-review`、OpenDART 的 `dart-kr / company-filings`、日本 EDINET 的 `edinet / daily-filings`、台湾 MOPS 的 `twse-mops / electronic-documents`、`census-trade / trade-flow-observation`、`worldbank-pink / commodity-price-observation` 和 `osh / facility-search`。后续公司供应商名单等源只需要新增 connector，不需要改 CLI 调度入口或 run-due 主循环。

示例：

```bash
supplystrata sources policy sync --file config/source-policies.example.json
supplystrata sources due --format markdown
supplystrata sources run-due --limit 5 --format markdown
supplystrata sources due --source-plan reports/nvidia-research-pack/source-plan.json --namespace nvidia-memory-2025 --format markdown
supplystrata sources run-due --source-plan reports/nvidia-research-pack/source-plan.json --namespace nvidia-memory-2025 --limit 4 --format markdown
```

`sources policy sync` 是持续监控参数的统一入口。`policies[]` 配 source 级默认频率、jitter、优先级、初始 `next_check_at`、最大重试次数和 backoff；`check_targets[]` 配具体公司/组件/设施目标，并可覆盖同一组参数。`run-due` 和后续 worker 只读取这些配置入库后的有效值，不接受额外的重试策略 CLI 参数。

### supplystrata review

人工 review 是所有不应自动入图候选的入口。当前已落地：

```
supplystrata review enqueue apple-suppliers
supplystrata review enqueue entity-source <query> [--source all|opencorporates|companies-house] [--jurisdiction] [--limit]
supplystrata review stats
supplystrata review next
supplystrata review show <REV-id>
supplystrata review approve <REV-id> --reviewer <name> [--reason "..."]
supplystrata review reject <REV-id> --reviewer <name> --reason "..."
supplystrata review apply <REV-id> --reviewer <name>
supplystrata review apply-approved --reviewer <name> [--limit N] [--format markdown|json]
```

`approve` 只代表研究员同意候选进入下一步，不等于已经写图。`apply` 会按 candidate kind 分流：

- `supplier_list_row`：生成两条受控关系：buyer `BUYS_FROM` supplier，以及 supplier `MANUFACTURES_AT` facility。apply 前会先做实体解析和证据评分；如果 supplier 还没进入实体库，候选会变成 `blocked`，同时写入 `pending_entities`，不会生成脏边。只有 buyer / supplier 都能解析，并且 facility 实体能由已审核行稳定创建时，才交给 `GraphBuilder.apply()`。
- `entity_source_candidate`：把外部登记源候选写入 `entity_master` / `entity_alias`，并把同 surface 的 `pending_entities` 标记为 resolved。写入前会检查 identifier / alias 是否已经属于其它实体，冲突时 blocked。
- `semantic_change`：官方披露 relation fingerprint 变化的审阅候选。apply 会 acknowledge 该变化，并生成 `status='draft'` 的 claim 草稿；它不生成 edge/evidence。如果研究员要把它升级为事实边，必须另走实体解析、证据评分和 GraphBuilder 路径。

如果实体是高频且低歧义的 curated seed，比如 `3M`，也可以先补 `seeds/entities.csv` / `seeds/aliases.csv`，再执行 `supplystrata admin seed` 和原 review 的 `apply`。supplier list apply 成功后会关闭同 surface 的 pending entity。`blocked` 候选允许人工补完实体后重试；`apply-approved` 批处理仍只扫描 `approved`，不会自动重试所有 blocked 项。

`review apply` 的返回值里会带 `apply_results[].graph_sync`。`synced` 表示 Neo4j 当前态已经同步；`failed` 表示 Postgres 真相存储已经写入成功，但 Neo4j 物化视图没有同步成功，应执行 `supplystrata graph rebuild`。返回值只保留结构化的 `apply_results`，不再维护旧的单边 `apply_result` 字段。

`review apply-approved` 是批处理工具，只扫描 `status='approved'` 的候选，不会自动 approve `pending` 候选。每条候选仍然走同一个 `applyApprovedReviewCandidate()` 严格路径：无法解析实体会变成 `blocked`，写图异常会进入 `error`，Neo4j 同步失败会体现在单条结果的 `apply_results[].graph_sync`。

### supplystrata graph check

检查 Neo4j 当前态是否与 Postgres 真相存储的投影计数一致：

```bash
supplystrata graph check --format markdown
supplystrata graph check --format json
```

`synced` 表示节点数和当前边数一致；`out_of_sync` 或 `unreachable` 时应先排查 Neo4j，再运行 `supplystrata graph rebuild`。

### supplystrata entity lookup `<query>`

外部实体源候选查询。当前用于 OpenCorporates / UK Companies House，目的是帮 review/import 决策补 identifier 和别名，不直接修改 `entity_master`。

```bash
supplystrata entity lookup "ARM HOLDINGS" --source companies-house --limit 5 --format markdown
supplystrata entity lookup "3M" --source opencorporates --jurisdiction us_mn --format json
```

配置：

- `OPEN_CORPORATES_API_TOKEN`：OpenCorporates 官方 API token
- `COMPANIES_HOUSE_API_KEY`：UK Companies House API key

输出里每个候选都带 `external_id`、管辖区、注册号、状态、地址、历史名/别名和 provenance。CLI 不会自动合并，避免把同名公司误并到已有实体。

要把 lookup 结果进入人工导入队列：

```bash
supplystrata review enqueue entity-source "3M" --source opencorporates --jurisdiction us_mn
supplystrata review next
supplystrata review approve <REV-id> --reviewer <name> --reason "matched official registry"
supplystrata review apply <REV-id> --reviewer <name>
```

### supplystrata entity pending

查看 resolver / apply 阶段留下的未解析实体 surface：

```bash
supplystrata entity pending list --status pending --limit 25
supplystrata entity pending show PND-...
supplystrata entity pending lookup PND-... --source opencorporates --jurisdiction us_mn
```

`pending lookup` 只根据 pending surface 发起外部实体源查询，不自动 enqueue。研究员确认候选方向后，再执行 `review enqueue entity-source "<surface>" ...`。

### supplystrata search `<query>`

简单全文搜索：

- entity 名 / 别名
- evidence cite_text
- chunk text（仅返回元信息，不展示原文段落）

实现使用 Postgres tsvector（MVP 阶段）。

## 状态码与错误

| 退出码 | 含义               |
| ------ | ------------------ |
| 0      | 成功               |
| 1      | 通用错误           |
| 2      | 资源不存在         |
| 3      | 歧义 / 多候选      |
| 4      | 校验失败（参数错） |
| 5      | 网络 / 上游错误    |
| 6      | 数据完整性错误     |
| 7      | 权限 / 法律边界    |

错误消息走 stderr；正常输出走 stdout，方便管道。

## 输出格式约定

### markdown

- 默认包含 EV-xxx / EDGE-xxx / ENT-xxx 的 inline 引用
- ID 用反引号包：`EV-000123`
- 每个 section 用 `## ` 开头
- 不输出无意义的装饰（不要 emoji，不要 ASCII art）

### json

- 严格符合 schema_version
- 输出顶层带 `schema_version` 字段
- 字段顺序按 schema 文档（提高 diff 可读性）
- 未知项一律是 null（不省略字段）

## 可观测性

每条命令记录结构化日志（pino）：

```
{ level:"info", cmd:"company", args:{...}, duration_ms:..., status:"ok" }
```

`--verbose` 提升日志等级到 debug。
`--quiet` 静默 stderr 上的非关键日志。

## 测试

- 黑盒 CLI 测试（基于已 seed 的本地 db）
- 输出 snapshot 测试
- 退出码测试

## 不做的事

- **不**实现交互式 REPL（增加复杂度而无价值）
- **不**自动安装依赖
- **不**直接连远端只读副本（避免泄露）
- **不**支持自动 update（手工 git pull）
