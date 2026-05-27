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
cp config/source-credentials.example.json config/source-credentials.local.json
```

SEC/NVIDIA 规则切片不需要 LLM key，也不需要 source API key。GLEIF LEI 查询不需要 key；TWSE MOPS 电子文件目录 monitor 当前也不需要 API key。需要 key 的公开数据源统一配置在 `config/source-credentials.local.json`，该文件被 git 忽略，仓库只提交 `config/source-credentials.example.json`。当前包括 OpenDART、EDINET、OpenCorporates、Companies House、Census Trade 和 Open Supply Hub；不配置这些 key 时，research-pack 仍可生成报告，source-plan smoke / backlog 会把对应目标稳定标记为 `missing_credentials`，而不是阻断整轮研究输出。`.env` 仍可设置同名变量覆盖本地 credentials 文件，方便 CI 或宿主 App 注入密钥。这些运行凭据由 `@supplystrata/config` 的 source credential 定义和 source-check connector capability 共同声明，`sources catalog`、source-management preview 和 source-plan smoke 会读取同一份契约。

## 2. 先跑无数据库预览

如果只想确认 SEC 抓取、HTML normalize、规则抽取和 seed 消歧，先跑这个：

```bash
pnpm --silent cli examples nvidia preview --format markdown
pnpm --silent cli examples nvidia report --format markdown --lang zh
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
3. `pnpm cli examples nvidia ingest --graph-sync defer`
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

`research run` 默认只读打包，不会为了生成报告隐式写 claims、edge intelligence、root unknown 或 risk views。若要在导出前显式刷新派生上下文，传 `--prepare-data`；也可以用 `--build-claims`、`--refresh-intelligence`、`--materialize-root-unknowns`、`--refresh-component-risk` 分别启用单个写入步骤。刷新后，研究包会把已有 `edge_strength_estimates`、`edge_freshness`、strength unknown、root research unknown、component risk metrics 带进 Workbench JSON、CompanyCard、ComponentCard 与 ChainView：

```bash
pnpm --silent cli research run --company nvidia --depth 3 --prepare-data --out reports/nvidia-research-pack
```

需要本地 HTML 读物时，直接把 research-pack 目录交给统一渲染入口。这个脚本不再读取早期 preview JSON，也不绑定 NVIDIA 专用输出结构：

```bash
node scripts/render-research-html.mjs reports/nvidia-research-pack reports/latest-nvidia-research.html
```

研究包会额外生成 `attention-queue.json/md`、`question-readiness.json/md`、`observation-coverage.json/md`、`official-disclosure-readiness.json/md`、`supply-chain-expansion-plan.json/md`、`propagation-readiness.json/md`、`investigation-backlog.json/md` 和 `corroboration-source-plan.json/md`。attention queue 会把 claim conflict、claim lifecycle warning、open alert candidates、degraded source health 和 requires-attention change 统一成即时处理入口；它只读已有上下文，不自动裁决冲突、不修改事实边、不关闭 unknown。Workbench JSON 里的 `review_queue` 会导出相关 source adapter 下的 open review candidates；official disclosure readiness 会单独列出 `official_disclosure_signal`，并输出 `official_disclosure_signal_correlation_hints`，把这些 signal 和 edge-level corroboration queue 做 review-only 关联提示；这些 signal/hint 只说明“有官方句子值得复核”，不能替代 fact edge 或二源 corroboration。人工对 hint 做出结论后，后端会把 disposition 作为 review-scoped change 带回 Workbench/research-pack，readiness 会显示 open/recorded hint；这仍然只是审阅结论，不写 evidence、unknown、source target 或 fact edge。若 disposition 明确为 `record_single_source_unknown`，后续由 `evidence-maintenance.materializeOfficialSignalDispositionUnknowns()` 读取审计 change 并受控写入 edge-scoped unknown；这一步仍默认检查 edge 当前有效，且不会把 signal 计为二源证据。readiness 文件不调用 AI，也不生成正式答案；它们只根据当前 pack 里的 fact edge、evidence、observation、risk metric、source plan 和 unknown map，判断核心问题是 `ready`、`partial` 还是 `blocked`，并列出 supporting refs、missing requirements 和 unknown ids。`propagation-readiness` 还内置 `ai_compute_propagation.v0` matrix，把 demand、server、PCB/materials、fab capacity、cleanroom、equipment、process inputs、raw materials 逐层标成 covered_fact、observation_ready、official_target_runnable、lead_only、unknown_open 或 blocked_source，并列出 fact / observation / source target / lead / frontier / unknown refs；未覆盖层还会输出 deterministic `unknown_backlog_seeds` 和 `execution_queue`，给未来 AI/前端展示“创建/保留 unknown、运行 target、修 source、审查 context”的受控动作。这张 matrix 是未来 AI/前端研究输入，不是最终结论。observation coverage 文件会汇总本研究包里可见的 typed signal、source adapter、scope、component、geography、metric、样本 id、series readiness 和缺失 methodology type，避免只看 Markdown 时误以为所有信号都已覆盖；series readiness 会标出某组观测是 `sparse`、`explicit_baseline_ready` 还是 `time_series_ready`。official disclosure readiness 文件会把 Gate 1 的内置研究 target profile、Gate 1 scorecard、逐节点覆盖状态、显式 target node 覆盖、逐 expected source 覆盖、edge-level corroboration queue、profile expansion candidates、Level 4/5 fact edge、完整 traceability、严格 cross-source corroboration、strength/freshness gap 和官方披露 source target 状态显式列出；它不会把 single-source silence 当作已解释，也不会写事实边。`supply-chain-expansion-plan` 会把当前 L4/L5 fact frontier 变成下一层递归研究计划：只有带 component/process 语义的边才能成为 `expand_candidate`，缺 `component_id` 的边会要求先补 component context，达到 `max_depth`、catalog boundary 或 logistics/route observation layer 会显式停止。它只生成 planning/backlog context，不创建事实边。scorecard 会分开显示 `data_progress` 和 `source_path_progress`：前者只看事实边、证据、corroboration 和 traceability，后者只看预期官方源路径是否已进入 source-plan/target/observation 准备态。corroboration queue 会把每条 single-source / missing-evidence L4/L5 edge 对应的已有来源、候选 counterparty/source target、linked unknown 和处置动作列出来；没有二源路径时必须保留显式 single-source disposition，而不是把沉默算作验证。expected source 覆盖会区分“已有事实证据 / 已有 observation / target 已同步 / target 可同步 / 只有计划 / connector 存在但节点未接线 / source 已注册但未实现 / profile source 未映射”，所以 profile 不是一张自我安慰清单，而是可执行缺口账本。CLI 会在 NVIDIA、TSMC、Samsung、SK Hynix、Micron、ASML、云需求端或相关组件命中时自动选择 `ai-compute-memory.v0`，不用用户手写 profile；需要关闭时可传 `--target-profile none`。profile 是验收锚点，不是全球供应链全集；内置 profile 中已有 CIK 的 SEC 公司会进入 `source-plan.json` 的 `sec-company-filings` runnable suggestion，并同时进入 observation-only `sec-company-facts` runnable suggestion，用于把库存、资本开支、采购义务、收入等结构化财报指标接进 source-target coverage；官方 IR source 会在提供 `--official-disclosure-year` 时进入 node-specific runnable suggestion，带审计 HTTPS URL 的 `company-ir` 长尾目标也会进入受控 runnable suggestion，Samsung / SK Hynix 还会生成 `dart-kr/company-filings` runnable suggestion，silicon wafer / ABF substrate 会生成 `edinet/daily-filings` runnable suggestion，Foxconn / Quanta 会生成 `twse-mops/electronic-documents` runnable suggestion，manufacturing-services 目标会进入 Apple Supplier List FY2022 的 `supplier-list-review` runnable suggestion。DART / EDINET / TWSE 当前只监控官方披露目录元数据，用来建立官方 target / observation / backlog 覆盖，不自动下载或解析正文、不写事实边；缺显式 URL、公司级代码、connector 或 target config 的其它来源仍会保留为缺口。不在 profile 里但已被发现的节点会进入 expansion candidates/backlog。backlog 文件会把这些 readiness gap、official disclosure gap、expected source gap、corroboration queue item、profile expansion candidate、supply-chain expansion item、explicit unknown、组件覆盖缺口、source-plan item 和 sparse observation series 变成可审计的下一步调查任务；`corroboration_review` 会逐 edge 继承 runnable target、source target coverage 和 preflight 状态，用来提示先同步、启用、运行、排错或记录 explicit disposition；backlog summary / manifest 会汇总 corroboration reviews 的 runnable target、coverage、need sync、need enable、due、failed preflight、missing credentials、invalid config、unsupported connector、source unreachable 和 disposition-only 数量；它只规划，不抓取、不落库、不写事实边。`corroboration-source-plan.json` 会把这些逐 edge review 里的 runnable target 去重成标准 source-plan 子集，可直接交给已有 `preview-plan-targets / smoke-plan-targets / sync-plan-targets / enable-plan-targets`，让二源检查从 backlog 进入 source monitor 同一条转换链路；它仍然只调度源检查，不代表二源事实已成立。这样可以先知道数据是否足够，再决定是否进入人工分析或后续 AI 总结。

如果要让 TSMC / Samsung / SK hynix / Micron / ASML 这类已注册官方 IR connector 进入 runnable source target，而不是只停留在 planned backlog，可以给研究包传入披露年份。`company-ir` 的长尾入口还需要 profile/review/host app 提供审计过的显式 HTTPS URL；它不会从公司名自动猜 IR 页面：

当前内置 profile 也会把 AI server / PCB 上游 frontier 带进研究包：server 会展开到 GPU、HBM、manufacturing services、PCB、optical module、power supply 和 cooling，PCB 会展开到 CCL、copper foil、electronic glass cloth 和 laminate resin，wafer/fab 会保留 cleanroom construction context。这些只会出现在 source-plan、coverage、unknown、backlog 和 expansion plan 中；它们不是 fact edge，也不会因为跑 `research run` 自动写入供应关系。对 Samsung Electronics 这类父级法人研究入口，如果 `--prepare-data` 发现当前没有任何 reviewed L4/L5 fact edge 且没有 open company unknown，会物化一个 company-scoped root unknown，明确说明“研究范围已打开但官方关系证据仍缺失”；这一步仍不写 evidence、不写 fact edge。

```bash
pnpm --silent cli research run --company nvidia --depth 3 --prepare-data --official-year 2025 --source-target-namespace nvidia-memory-2025 --out reports/nvidia-research-pack
```

这只生成 `official-html-disclosure` 检查建议和 backlog runnable target，不自动运行 source、不写事实边。要把研究计划接入持续监控队列，用 source-management 的转换入口把 runnable suggestions 同步成 `source_check_targets`：

如果要先用无数据库路径跑 Gate 1 二源检查闭环，可以从已有 Workbench snapshot 开始。注意：当命令输出要重定向成 JSON 文件时，用 `pnpm --silent cli ...`，否则 pnpm 的脚本横幅会一起写进文件头，导致后续 `--source-target-preflight` 不能按纯 JSON 解析。

```bash
pnpm --silent cli research from-workbench --workbench reports/nvidia-workbench.json --component COMP-HBM,COMP-MEMORY --source-target-namespace nvidia-memory-2025 --out reports/gate1-action-batch-check
pnpm --silent cli sources policy smoke-plan-targets --source-plan reports/gate1-action-batch-check/corroboration-source-plan-smoke.json --namespace nvidia-memory-2025 --limit 5 --format json > reports/gate1-action-batch-check/corroboration-source-plan-smoke-result.json
pnpm --silent cli research from-workbench --workbench reports/nvidia-workbench.json --component COMP-HBM,COMP-MEMORY --source-target-namespace nvidia-memory-2025 --source-target-preflight reports/gate1-action-batch-check/corroboration-source-plan-smoke-result.json --out reports/gate1-action-batch-check-with-preflight
pnpm --silent cli sources policy preview-plan-targets --source-plan reports/gate1-action-batch-check-with-preflight/corroboration-source-plan-sync.json --namespace nvidia-memory-2025 --format markdown
```

第一步会根据当前 Workbench、target profile 和默认 source-plan 窗口生成 `corroboration-source-plan-smoke.json` 等 action-specific 批次；默认窗口由 `generatedAt` 派生：官方披露和年度材料观测取上一 UTC 年，贸易和商品价格观测取上一 UTC 月。需要复现历史研究时仍可显式传 `--official-year`、`--trade-month`、`--commodity-month` 或 `--material-year` 覆盖。第二步只对需要 `smoke_target` 的二源 target 执行 plan/fetch/normalize 预检，不写数据库。第三步把 smoke 结果回灌进 research-pack，`corroboration-source-plan` 的 next action 会从笼统的 smoke 细化成 `sync_target`、`configure_credentials`、`retry_preflight` 或 `review_observations`；如果 DB-backed coverage 已经显示 target `succeeded`，即使没有 preflight 快照，也会直接进入 `review_observations`。`gate1-run-ledger.action_queue` 也会同步改成 review、补凭据、排查 preflight 或 sync 等精确动作，不会继续提示重复 smoke；当 action 需要人工审查 observation 时，command hint 会指向 `review edge-corroboration-disposition` 或 `intelligence observation-calibration-label` 这类 review-only 入口，而不是自动写 evidence 或 fact edge。第四步只预览已经通过 smoke、下一步确认为 `sync_target` 的目标，输出稳定 `check_target_id` 和 validation 结果；它仍然不写库。这个闭环适合没有 Postgres 的宿主 App 先体检官方源可达性，也适合本地开发时把 DART 凭据缺失、IR 超时、target config 错误这类问题提前暴露出来。只有当 sync batch 预览无 error、且研究员确认目标应该进入持续监控后，才进入后面的 `sync-plan-targets / enable-plan-targets / due / run-due`。

```bash
pnpm --silent cli sources policy preview-plan-targets --source-plan reports/nvidia-research-pack/source-plan.json --namespace nvidia-memory-2025 --format markdown
pnpm --silent cli sources policy preview-plan-targets --source-plan reports/nvidia-research-pack/corroboration-source-plan.json --namespace nvidia-memory-2025 --format markdown
pnpm --silent cli sources policy smoke-plan-targets --source-plan reports/nvidia-research-pack/source-plan.json --namespace nvidia-memory-2025 --source sec-edgar --limit 2 --format json > reports/nvidia-research-pack/source-target-preflight.json
pnpm --silent cli research from-workbench --workbench reports/nvidia-workbench.json --component COMP-HBM,COMP-MEMORY --source-target-namespace nvidia-memory-2025 --source-target-preflight reports/nvidia-research-pack/source-target-preflight.json --out reports/nvidia-monitoring-loop-snapshot
pnpm --silent cli sources policy sync-plan-targets --source-plan reports/nvidia-research-pack/source-plan.json --namespace nvidia-memory-2025
pnpm --silent cli sources policy sync-plan-targets --source-plan reports/nvidia-research-pack/source-plan.json --namespace nvidia-memory-2025 --enable --check-cadence-minutes 10080 --jitter-minutes 120
pnpm --silent cli sources policy enable-plan-targets --source-plan reports/nvidia-research-pack/source-plan.json --namespace nvidia-memory-2025 --next-check-at 2026-05-19T00:00:00.000Z --check-cadence-minutes 10080 --jitter-minutes 120
pnpm --silent cli sources due --source-plan reports/nvidia-research-pack/source-plan.json --namespace nvidia-memory-2025 --format markdown
pnpm --silent cli sources run-due --source-plan reports/nvidia-research-pack/source-plan.json --namespace nvidia-memory-2025 --limit 4 --format markdown
```

`preview-plan-targets` 不连接数据库，只把 source-plan 的 runnable suggestions 转成稳定 target id、按 source / target kind / priority 汇总，并用同一套 source-management validation 报出缺 connector、字段错误、manual-only 自动化或 credentials warning；适合宿主 App 先审计。`preview-plan-targets / sync-plan-targets / enable-plan-targets` 都支持 `--source`，可以把全量 Gate 1 计划收窄到 SEC、官方 IR 或其它当前已审计来源；也支持 `--check-target-id`，用于只操作 `gate1-run-ledger.action_queue` 或 propagation execution queue 指定的精确 target，避免因为同一个 source adapter 里还有其它 runnable target 而扩大执行范围。Gate 1 propagation action 会进一步按 source adapter / target kind 分组，并把同类大批量 target 切成小批次；宿主 App 可以把每个 action 当作独立审批/运行单元，而不需要重新拆命令。credential warning 来自 connector capability 的 `credential_requirements`，不是 CLI 自己维护的 env key 清单。`smoke-plan-targets` 也不连接数据库，但会真正执行 adapter 的 `plan / fetch / normalize`，用于提前发现外部源不可达、凭据缺失或 target config 失效；它在访问外部源前按同一 credential 契约检查 `config/source-credentials.local.json`、`.env` 和环境变量，缺 key 会稳定归类为 `missing_credentials`，并在 JSON/Markdown 里输出具体 env key。它不写 `source_check_targets`、不写 monitor event、不写 observation，也不会生成事实边。smoke summary 会额外输出 source readiness matrix，把每个 source 的 checked/failed/skipped、normalized/degraded、target kind、issue kind、只读 observation draft 和 semantic section 分布列清楚，方便一次性看 Gate 1 的 SEC / DART / EDINET / TWSE / Apple / IR 目标卡在哪里以及文本是否真的进入了可抽取层；配置字段错误会归为 `target_config_invalid`。这些 observation/section 计数只是预检信号，不代表 observation 已落库。需要把这次体检随研究包归档时，显式把 smoke JSON 传给 `research run/from-workbench --source-target-preflight`，research-pack 会打包成 `source-target-preflight.json/md`，并把匹配 target 的 failed/skipped/degraded preflight 写进 `investigation-backlog` 的 action 和 coverage 行；它不会重新抓源，也不会把 smoke 成功解释成事实覆盖。`sync-plan-targets` 默认写入 disabled target，适合先审计；显式 `--enable` 后才会被 `sources due/run-due` 和 worker 拾取。审计后如果要受控启用同一批 target，用 `enable-plan-targets` 从同一个 `source-plan.json + namespace` 重新计算 target id，只更新已同步 target 的 `enabled` 和 target 级 cadence / jitter / retry / `next_check_at` 覆盖值。它只修改监控配置，不抓源、不解析 PDF、不写事实边；missing target 会在结果中列出，表示需要先重新同步。

`sources due` 和 `sources run-due` 都支持同一组过滤参数：`--source-plan + --namespace`、`--check-target-id` 或 `--source`。建议先用 `sources due` 预览，确认只包含本轮要跑的小批量目标，再运行 `run-due`。这些过滤参数只限制 due target 范围，不改变 source policy，不改变 target config，也不让 observation 自动升级成 fact edge。

DB-backed `sources run-due` 的 Markdown summary 会显示每份文档产生的 `Review candidates` 数量。对 TSMC / Samsung / SK hynix / Micron / ASML 等官方 IR 文档，这些候选可能包含 `official_disclosure_signal`：它们只是可引用官方信号的复核入口，不是事实边，也不是自动 corroboration。

对 Apple Supplier List 这类已经落入 review queue 的官方候选，可以先跑 Gate 1 受控批处理找出低歧义、可审计的候选：

```bash
pnpm --silent cli review gate1-supplier-list-batch --reviewer codex-gate1-rule-review --limit 500
pnpm --silent cli review gate1-supplier-list-batch --reviewer codex-gate1-rule-review --limit 500 --apply
```

第一条只做 dry-run；第二条才会把 eligible 候选先 approve 再 apply。这个入口只接受 Apple Supplier List、Apple buyer、curated supplier entity 和可复现 citation 同时成立的候选。其余候选不会被猜测成事实边；summary 里的 `entity_resolution_backlog` 会列出下一批最值得先补的 supplier entity，后续应先补实体种子/别名、走 entity-source review，或保留为 explicit unknown / disposition。

如果要把这个 backlog 推进一步进入实体解析 review 队列，先用 GLEIF 批量生成候选：

```bash
pnpm --silent cli review enqueue gate1-supplier-entity-backlog --source gleif --scan-limit 500 --supplier-limit 10 --candidate-limit 3
```

这一步只 enqueue `entity_source_candidate`，不自动合并实体，也不重试 supplier-list apply。研究员确认候选后仍要走 `review approve/apply`，然后再重新运行 `review gate1-supplier-list-batch --apply`。

低歧义的 GLEIF 候选可以先用 Gate 1 受控批处理审计：

```bash
pnpm --silent cli review gate1-entity-source-batch --limit 20
pnpm --silent cli review gate1-entity-source-batch --reviewer codex-gate1-rule-review --limit 20 --apply
```

第一条只列出 eligible / skipped；第二条只会 approve/apply `ACTIVE`、`FULLY_CORROBORATED`、supplier surface 与 GLEIF legal name 精确匹配且 proposed entity id 使用 `ENT-GLEIF` 命名空间的候选。它只补实体解析，不直接写供应链边；实体合并后再跑 supplier-list batch，让官方供应商名单路径决定是否释放事实边。

再次运行同一个 `research run --source-target-namespace nvidia-memory-2025` 时，研究包会输出 `source-target-coverage.json/md`。这个文件把 runnable source-plan target 对齐到 `source_check_targets / source_check_jobs / source_change_events / observations`，显示目标是否已同步、是否启用、是否 due、是否 retry_wait、是否 degraded、最近 job/event 是什么，以及有没有产出 observation。若同一官方源 target 已在其它 namespace 跑过，coverage 会按 `target_config` 复用该运行态，但 `gate1-data-depth-workbench` 会同时显示 `expected`、`matched` 和 `match`，避免把跨包复用误读成当前研究包新建了 target。summary 还会汇总 total observations、observed subject entities、observations by source、observations by target kind 和 observations by metric，用来判断数据是否真的跑深；`observation_review` 会把 metric 覆盖转成 P0/P1/P2 review seeds，并从样本生成只读 `calibration_candidates`。候选标签限定为 `useful_signal / background_context / needs_context / not_useful`，给前端/host app 做人工或规则审查、calibration / gold label 抽样；truth-store 模式会回填已落库的 `observation_calibration_labels`，在 candidate 上显示 `existing_labels / latest_label / review_status`，并在 manifest 里统计 labeled/unlabeled 和 persisted label 分布。`labeling_plan` 会从未标注 candidate 中按 priority 和 metric 分层抽取下一批建议样本，帮助扩大 gold set 时保持覆盖面。它们都带 `review_only_no_fact_mutation` policy，不会自动写 fact edge、risk 结论、observation 或 evidence level。失败 job 还会带 `failure_kind`，用于区分缺凭据、target config 错误、源不可达/响应错误、限流、adapter 错误或未知失败；它只是排障分类，不是事实证据。`investigation-backlog.md` 也会把这些状态写进每个相关任务的 action 和 coverage 行里，例如“已同步但未启用”时会提示先启用 target，“source fetch degraded” 时会提示先排查源退化；如果显式传入 `--source-target-preflight`，failed/skipped/degraded preflight 会优先提示先修 target config、凭据、connector 注册或源连通性，而不是笼统提示去同步 source。`gate1-data-depth-workbench.json/md` 会把 L4/L5 边增长、entity affiliation context、二源 corroboration、source blocker、strength 缺口、下一批 gold label 和 propagation context 缺口排成 review-only 优先级清单，方便本轮跑数后直接看下一步补哪里；它还会输出 `gate1-data-depth-p0.json`、`gate1-data-depth-source-blockers.json`、`gate1-data-depth-labeling.json`、`gate1-data-depth-corroboration.json`、`gate1-data-depth-entity-context.json` 和 `gate1-data-depth-intelligence-context.json` 等非空 action batch。entity context 专门暴露 Samsung Memory / Samsung Foundry 这类业务单元到 Samsung Electronics 这种父级法人的研究范围断点；如果父级法人已有 open company unknown，entity context 会把 unknown ref 一起带回 NVIDIA 报告，提示递归研究目标的未知边界已经存在；它只提示审查递归研究范围，不合并实体、不自动继承父级 evidence、不传播 fact edge。每个 action item 都带 `frontend_action_kind`、推荐/允许决策、写入影响和命令提示，供前端/host app 分别展示优先审查、排障、标注、实体上下文审查、二源复核和推理上下文动作；这些 batch 仍不写事实层。递归 frontier 命令会把父公司、父组件、seed edge 和 seed unknown 写进 `research_lineage`，README / manifest 会显示这条来源；它只解释为什么打开子研究，不继承父包事实。`gate1-run-ledger.json/md` 的 `monitoring_config.batches[]` 会把这些状态汇总为 `state_counts`、`recommended_operational_action` 和 `attention_hint`，给未来前端/host app 直接生成同步、启用、运行、等待、排查失败或 review observation 的动作。它是监控闭环的可见性层，不会自动把 observation 升级成 fact edge。

如果当前环境没有 SQL truth store，也可以先用静态 Workbench 跑同一套 source-plan / readiness 输出：

```bash
pnpm --silent cli research from-workbench --workbench reports/nvidia-workbench.json --component COMP-HBM,COMP-MEMORY --source-target-namespace nvidia-memory-2025 --out reports/nvidia-monitoring-loop-snapshot
```

静态 snapshot 不连接 Postgres，因此 `source-target-coverage.json/md` 会把 expected targets 全部标为 `not_synced`。这不是假闭环，而是迁入宿主 App 前的可审计准备态：它明确告诉调用方“source-plan 已生成稳定 target id，但还没有进入 source_check_targets”。真正持久化闭环仍要由上面的 `sync-plan-targets / enable-plan-targets / due / run-due` 在可达 SQL truth store 上执行。

只想从 truth store 做只读打包时，不需要额外参数；这是 `research run` 的默认行为。`--skip-claims`、`--skip-intelligence-refresh`、`--skip-root-unknowns`、`--skip-component-risk-refresh` 只用于搭配 `--prepare-data`，在组合刷新里关闭某个写入步骤。

如果 claim 出现反证或 `CONFLICTING_EVIDENCE` unknown，Workbench / research-pack 的 `workbench.json` 会在 claim DTO 里输出 `conflict_review`。它是后续 agent safe write path 的输入契约：`review_queue_kind='claim_conflict_review'` 表示需要审阅，`safe_write_status='blocked_pending_review'` 表示禁止自动写事实层，`fact_write_policy.automatic_fact_mutation_allowed=false` 表示不同来源不一致时不能由系统自动“校准”或 deprecate edge。要把 unresolved conflict 放进持久化人工队列，可以运行：

```bash
pnpm --silent cli claims enqueue-conflicts --limit 500
```

该命令只写 `review_candidates(kind='claim_conflict_review')`，不修改 `edges`、不修改 claim status、不 resolve unknown。后续仍需通过 `review next/show/approve/reject/block/apply` 路径处理。`review apply` 对 approved claim conflict review 只写 `CLAIM_CONFLICT_REVIEW_APPLIED` / `REVIEW_APPLIED` 审计事件并标记 review applied，不会自动 deprecate edge，也不会自动关闭 unknown。

official disclosure signal 也走 review-only 写路径。`review apply` 对 `official_disclosure_signal` 只 acknowledge，不写 fact edge / evidence；如果研究员或未来安全 agent 已经判断某个 signal 与某条 edge 的关系，用 disposition 记录结论：

```bash
pnpm --silent cli review signal-disposition REV-OFFICIAL-SIGNAL-EXAMPLE --edge EDGE-EXAMPLE --decision needs_more_evidence --reviewer analyst --reason "Signal confirms category context but not a bilateral supply relation."
pnpm --silent cli review signal-disposition REV-OFFICIAL-SIGNAL-EXAMPLE --edge EDGE-EXAMPLE --decision record_single_source_unknown --reviewer analyst --reason "Reviewed counterparty disclosure still does not name an independent official second source."
pnpm --silent cli intelligence official-signal-unknowns --review REV-OFFICIAL-SIGNAL-EXAMPLE
```

`review signal-disposition` 只写 `OFFICIAL_DISCLOSURE_SIGNAL_DISPOSITION_RECORDED` change，并带 `fact_write_policy.automatic_fact_mutation_allowed=false`；`intelligence official-signal-unknowns` 只把 `record_single_source_unknown` disposition 物化为 edge-scoped unknown。二者都不写 `edges`，不写 `evidence`，也不把 signal 自动算作 corroboration。

edge corroboration queue 也有独立 review-only 写路径。研究包里的 edge corroboration command hint 会给出类似下面的命令：

```bash
pnpm --silent cli review edge-corroboration-disposition EDGE-EXAMPLE --decision record_single_source_unknown --reviewer analyst --reason "No second official counterparty source is currently visible for this relationship." --unknown UNK-EDGE-EXAMPLE
pnpm --silent cli review edge-corroboration-disposition EDGE-EXAMPLE --decision needs_more_evidence --reviewer analyst --reason "Runnable counterparty target exists, but reviewed observations are not enough to corroborate the edge." --check-target CHK-EXAMPLE
```

`review edge-corroboration-disposition` 只写 `EDGE_CORROBORATION_DISPOSITION_RECORDED` change，并带 `fact_write_policy.automatic_fact_mutation_allowed=false`；重新跑 research-pack 后，official disclosure readiness 会读回每条 edge 的最新 disposition。若记录为 `record_single_source_unknown`，corroboration queue 会显示 `single_source_disposition_recorded`，不会继续把这条边当成沉默缺口；它仍然不写 evidence、不写 fact edge，也不把单源处置算成二源 corroboration。

entity affiliation context 也有独立 review-only disposition。研究包里的 entity context command hint 会给出类似下面的命令：

```bash
pnpm --silent cli review entity-affiliation-disposition gate1-entity-affiliation:ENT-SAMSUNG-MEMORY:ENT-SAMSUNG-ELECTRONICS --subject ENT-SAMSUNG-MEMORY --parent ENT-SAMSUNG-ELECTRONICS --decision research_parent_entity --reviewer analyst --reason "Parent legal entity owns the official disclosure path for this business unit."
```

这个命令只写 `ENTITY_AFFILIATION_DISPOSITION_RECORDED` change，并带 `fact_write_policy.automatic_fact_mutation_allowed=false`；它不合并实体、不继承父级 evidence、不传播 fact edge，也不关闭 unknown。它的作用是给前端/host app 留下可审计的“下一轮该研究哪个实体范围”的决定。重新跑 research-pack 后，系统会读回该 context 的最新 disposition：未裁决时它会出现在 `gate1-run-ledger.review_workbench`，已裁决为 `research_parent_entity` 或 `research_both_scopes` 时才继续把父级法人列为递归 research target；裁决为子实体、无关或保持 unknown 时，不会反复推荐父级法人 research。

当研究包里还有 open official signal correlation hints 时，`gate1-run-ledger.action_queue` 会输出 `gate1:official-signals:disposition`。前端或宿主 App 可以把这个 action 和 `review_workbench.items[kind="official_signal_disposition"]` 对齐，展示批准/驳回/记录 unknown 的受控入口；这仍然只是审阅入口，不会自动写事实边。

人工处理 claim conflict 时，用 `claims resolve-conflict` 记录明确 resolution action：

```bash
pnpm --silent cli claims resolve-conflict CLM-EXAMPLE --action confirm-claim-valid --unknown UNK-CONFLICT-EXAMPLE --evidence EV-RESOLUTION --reviewer analyst --reason "Latest official filing confirms the relation."
pnpm --silent cli claims resolve-conflict CLM-EXAMPLE --action recommend-edge-deprecation --reviewer analyst --reason "Counterparty disclosure contradicts the current edge."
pnpm --silent cli claims resolve-conflict CLM-EXAMPLE --action request-more-evidence --reviewer analyst --reason "Need second official source before closing the conflict."
```

`confirm-claim-valid` 必须带 linked unknown 和 resolution evidence，并只通过 unknown 边界关闭 unknown；`recommend-edge-deprecation` 和 `request-more-evidence` 只写 `CLAIM_CONFLICT_RESOLUTION_ACTION_RECORDED` 审计上下文，不修改事实边或 claim status。

真正废弃事实边必须走显式 edge lifecycle workflow，并提供至少一个可验证 source ref：

```bash
pnpm --silent cli graph deprecate-edge EDGE-EXAMPLE --source evidence:EV-CONTRA,review:REV-CONFLICT --reviewer analyst --reason "Reviewed official counterparty disclosure contradicts the current edge."
pnpm --silent cli graph deprecate-edge EDGE-OLD --source claim:CLM-CONFLICT --superseded-by EDGE-NEW --reviewer analyst --reason "Superseded by narrower reviewed component edge."
```

`graph deprecate-edge` 默认 `--graph-sync defer`，只维护 Postgres truth store 并记录 `EDGE_DEPRECATED`；需要同步删除 Neo4j 当前态边时显式传 `--graph-sync sync`。source refs 支持 `evidence:*`、`review:*`、`claim:*`、`unknown:*` 和 `semantic-change:*`，缺 source ref 或引用不存在都会失败。该流程只 soft-deprecate current edge，不删除 evidence，不自动修改 claim status。

再次运行 `research run` 或 `workbench export` 时，claim DTO 会显示 edge lifecycle context。active claim 如果仍挂在 deprecated/historical edge 上，会带 `lifecycle_warnings[].code='active_claim_on_inactive_edge'`；research-pack README 的 stats 也会汇总 `Claim lifecycle warnings`。这是维护提醒，不会自动 supersede / reject claim。

维护这类 claim 时，用显式 claim lifecycle 命令：

```bash
pnpm --silent cli claims lifecycle CLM-OLD --action supersede-claim --superseded-by-claim CLM-NEW --source evidence:EV-CONTRA,claim:CLM-NEW --reviewer analyst --reason "Deprecated edge has been replaced by a narrower reviewed claim."
pnpm --silent cli claims lifecycle CLM-OLD --action reject-claim --source evidence:EV-CONTRA --reviewer analyst --reason "Reviewed counterparty disclosure invalidates this claim."
pnpm --silent cli claims lifecycle CLM-OLD --action keep-with-context --source review:REV-CONFLICT --reviewer analyst --reason "Keep visible until replacement evidence review is complete."
```

`supersede-claim` / `reject-claim` 只更新 `claims.status` 并写 `CLAIM_LIFECYCLE_ACTION_RECORDED`；`keep-with-context` 只写审计上下文。三者都要求 source refs，且都不修改 fact edge。

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

该命令只写 `risk_views / risk_metrics`，不写事实边。ComponentCard / research-pack 会在已有 risk view 时把 `supplier_concentration_hhi`、`single_source_exposure`、`path_redundancy`、`node_knockout_reach`、`node_knockout_weighted_impact`、`betweenness_centrality` 和 `freshness_adjusted_exposure` 带进 JSON/Markdown 输出；其中 `supplier_concentration_hhi` 会用明确 share 乘以 edge freshness 后再计算，attrs 保留 raw HHI 和缺口；`path_redundancy` 沿 supplier -> consumer 方向计算 source supplier 到 terminal consumer 的 simple upstream paths，attrs 会同时保留 direct supplier count、terminal path 明细和 weighted alternate-path context，避免把单条多级链误当成替代路径；`node_knockout_reach` 沿 supplier -> consumer 方向计算下游可达实体数，`node_knockout_weighted_impact` 用已知 `strength_weight * freshness_score` 计算 max-product path 传播影响，缺权重边只显式列为 gap，不补值；`betweenness_centrality` 的 attrs 会额外输出 weighted path centrality context，用于识别高权重路径瓶颈。CompanyCard 会展示 company-scoped observations，并把与公司上游事实边相关的 component risk metrics 聚合为 `top_exposure_nodes`。如果新版 component risk view 相比上一版存在实质指标变化，会写入 `RISK_METRIC_CHANGED`，可用 `changes --scope risk_metric:<metric-key>` 或 `changes --type RISK_METRIC_CHANGED` 审计。`research run --prepare-data` 或 `research run --refresh-component-risk` 会批量刷新当前研究包中有可审计 Level 4/5 component fact edge 的组件；对只有 taxonomy/source-plan、还没有 fact edge 的组件保持缺口状态，不生成空风险结论。

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

如果要把 `source-target-coverage.json` 里的 observation calibration candidate 记录成可持久化样本，可以直接标注对应 observation：

```bash
pnpm --silent cli intelligence observation-calibration-label OBS-EXAMPLE --candidate observation-calibration:purchase_obligations:OBS-EXAMPLE --label useful_signal --reviewer analyst --rationale "useful as purchase obligation calibration seed"
pnpm --silent cli intelligence observation-calibration-label OBS-REVENUE --label background_context --reviewer analyst
```

`observation-calibration-label` 只写 `observation_calibration_labels` 样本池；它不会修改 `observations`，不会写 `edges`，也不会把 observation 升级成 fact edge。正式 precision / reliability run 要等 observation gold set 样本量足够后再建。

如果要把 `gate1-data-depth-workbench.json/md` 里的 adjacent company ranking candidate 记录成可持久化样本，可以标注对应 ranking context 和 candidate：

```bash
pnpm --silent cli intelligence ranking-calibration-label ranking:adjacent-company:COMP-PCB:adjacent-company-ranking.v1 --candidate ENT-IBIDEN --rank 1 --label useful_target --reviewer analyst --rationale "useful upstream PCB research target"
pnpm --silent cli intelligence ranking-calibration-label ranking:adjacent-company:COMP-PCB:adjacent-company-ranking.v1 --candidate ENT-APPLE --rank 3 --label brand_center_bias --reviewer analyst --rationale "disclosure center, not the upstream PCB supplier to chase next"
```

`ranking-calibration-label` 只写 `ranking_calibration_labels` 样本池；它不会修改 research-pack ranking 输出、不会写 fact edge、不会关闭 unknown，也不会把 rank 解释成概率。样本足够前，adjacent company ranking 仍然只能作为 candidate-generation hint。

observation 标注后再次生成 truth-store research pack，`source-target-coverage.json/md` 会在对应 candidate 上显示已持久化 label，并在 manifest 中更新 labeled/unlabeled 和 persisted label 分布。ranking 标注后再次生成 truth-store research pack，`gate1-data-depth-workbench.json/md` 会在对应 ranking candidate 上显示 `review_status / latest_label / existing_labels`，manifest / README 也会汇总 labeled/unlabeled 和 persisted label 分布。静态 snapshot 不连接数据库，因此不会回填这些持久化 label。ranking calibration run 仍是下一步；样本足够前，ranking 继续保持 candidate-generation only。

如果要把 observation anomaly、source failure 和 component risk baseline 生成可去重的 alert candidates：

```bash
pnpm --silent cli intelligence alerts --since 2026-05-01T00:00:00.000Z --limit 1000
```

该命令只写 `alert_candidates`，alert 必须引用 `observation / risk_view / risk_metric / change / source_event` 等已有对象，不写事实边，也不自动发通知。可以用下面的命令查看和维护候选告警状态：

```bash
pnpm --silent cli intelligence alert-list --status open --limit 50
pnpm --silent cli intelligence alert-status ALT-EXAMPLE --status acknowledged --reviewer analyst --reason "reviewed in daily monitor"
```

`alert-status` 会写入 `ALERT_STATUS_CHANGED` semantic change，changes timeline 可用 `alert:<alert_id>` scope 追踪处理历史。再次运行 `research run` 或 `workbench export` 时，open alert 会出现在 `workbench.json.attention_queue` 和 research-pack 的 `attention-queue.json/md` 中；已 acknowledged / resolved / suppressed 的 alert 仍保留在 alert 表和 changes timeline 里，不再作为 open attention item 输出。正式通知通道仍是后续工作。

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
pnpm --silent cli examples nvidia preview --format markdown
pnpm --silent cli examples nvidia report --format markdown --lang zh
pnpm --silent cli preview apple-suppliers --entity ENT-APPLE --fiscal-year 2022 --limit 10 --format markdown
pnpm --silent cli research from-workbench --workbench reports/nvidia-workbench.json --out reports/nvidia-research-snapshot
pnpm --silent cli runtime doctor
```

这条路径不会落库，也不会写 GraphStore，适合未来嵌入 TS 桌面端或 agent 产品。`research from-workbench` 只消费已有 `WorkbenchModel` JSON，可以把一次 DB-backed 研究结果重新打包成静态目录；`preview` 则重新走抓取/解析/规则抽取。需要 review 队列、source health、changes timeline 或 Postgres truth store 时，需要连接 Postgres；changes timeline 会结构化显示 evidence supersession、official relation semantic diff、observation anomaly 和 risk metric change。需要图数据库物化视图、`graph rebuild/check` 或 Neo4j Browser 探索时，才需要 Neo4j adapter。

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

### GLEIF / OpenCorporates / Companies House 没结果

GLEIF LEI 查询不需要 API key，适合先做全球法人标识候选；OpenCorporates / Companies House 需要用户自己配置 API key。没有 key 时命令应明确报认证缺失，不应该退化成网页抓取。所有 entity-source lookup 都只生成候选和 review 输入，不自动 merge `entity_master`。
