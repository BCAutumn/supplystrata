# Observability — 日志与可观测性

MVP 阶段不引入 Prometheus / Grafana。结构化日志 + Postgres 中的状态表已经够用。Phase 3 之后再讨论 metrics。

## 日志要求

- 全部走 pino（structured JSON）
- dev 模式 `pino-pretty` 美化输出
- 生产模式输出到 stdout，由调度器/进程管理收集

## 日志级别

| 级别  | 用法                                                |
| ----- | --------------------------------------------------- |
| trace | 不用                                                |
| debug | 调试用，CI / 生产关闭                               |
| info  | 业务里关键状态（pipeline stage 完成、CLI 命令完成） |
| warn  | 异常但可恢复（rate limit 触发、ambiguous resolver） |
| error | 不可恢复 / 需要 attention                           |
| fatal | 启动失败                                            |

## 必备结构化字段

每条日志至少应当含：

- `service`：app 名（cli / worker）
- `stage`：流水线阶段（ingest / parse / extract / score / apply 等）
- `task_id` / `job_id`（如适用）
- `entity_id` / `doc_id` / `chunk_id`（如适用）
- `status`：ok / fail / skip / retry
- `duration_ms`

错误必须含 `err`：

```json
{
  "level": "error",
  "stage": "extract",
  "doc_id": "DOC-...",
  "extractor_id": "rule.sec.official-supply-chain",
  "err": { "name": "...", "message": "...", "stack": "..." }
}
```

## 关键事件

下列事件在生产中必须被持续监控：

| 事件                                         | 关注                       |
| -------------------------------------------- | -------------------------- |
| 任一 source adapter 单次 ingest 失败率 > 20% | 数据源失效或被限流         |
| 任一 source adapter 连续 3 次 ingest 全失败  | 法律或网络层面问题         |
| review_queue 中 pending > 200                | 抽取器质量下降或评审跟不上 |
| pending_entities 单 surface occurrence ≥ 10  | 漏录入实体                 |
| schema 不一致（Postgres vs Neo4j）           | 写流水线断了               |
| LLM 月度 cost 超过阈值                       | prompt / 模型策略问题      |
| evidence_level 5 边的占比突然变化            | 抽取规则被改动且未察觉     |

## 状态表（Postgres）

不另起 Prometheus，关键状态用 Postgres 表 + view：

当前 alpha 已落地 source monitoring 的基础表：

- `source_health`：每个 `source_adapter_id` 的 registry 状态、自动化策略、最近检查、成功、失败、变化时间。
- `source_policies`：每个源的检查 cadence、优先级、是否启用、下一次检查时间；可由外部 JSON 配置同步。
- `source_items`：可重复观察的 URL/API item，比如某个 SEC filing URL 或某个 IR PDF URL。
- `document_versions`：同一个 source item 的内容版本；按 `bytes_sha256` 去重。
- `source_change_events`：`DOCUMENT_NEW` / `DOCUMENT_UNCHANGED` / `DOCUMENT_CHANGED` / `SOURCE_FAILED` / `SOURCE_RECOVERED` 事件流。
- `fetch_runs`：抓取尝试记录，后续接入 pipeline 后用于失败率和限速分析。

CLI:

```bash
pnpm --silent cli sources health --format markdown
pnpm --silent cli sources due --format markdown
pnpm --silent cli sources check --source sec-edgar --cik 0001045810 --entity ENT-NVIDIA --forms 10-Q,8-K --limit 3
pnpm --silent cli sources policy sync --file config/source-policies.example.json
pnpm --silent cli sources run-due --limit 5 --format markdown
pnpm --silent worker --once --limit 5
pnpm --silent worker --interval-ms 60000 --limit 10
```

`@supplystrata/source-monitor` 是唯一允许计算 source item change type 和 source policy cadence 的包；pipeline 只调用它，不在各 adapter 里自己判断“新/旧/变化”。

`sources check` 是当前 monitoring 的单目标执行入口：它运行 source adapter 的 `plan/fetch/normalize`，保存文档，记录 source event，并抽取 observation；它不会自动写 graph edge。

`sources run-due` 是调度入口：它读取 `source_check_targets` 中已经到期的目标，先写入 `source_check_jobs`，再 claim due job，并通过 `@supplystrata/source-connectors` 的 connector registry 分发到对应 runner。当前已注册 `sec-edgar / sec-company-filings`、`sec-edgar / sec-company-facts`，`company-ir` 与 `tsmc-ir`、`samsung-ir`、`skhynix-ir`、`micron-ir`、`asml-ir` 的 `official-html-disclosure`，`apple-suppliers / supplier-list-review`，`dart-kr / company-filings`，`edinet / daily-filings`，`twse-mops / electronic-documents`，`census-trade / trade-flow-observation`，`worldbank-pink / commodity-price-observation`，以及 `osh / facility-search`。监控目标和 cadence 分离后，同一个 adapter 可以同时监控 NVIDIA、AMD、Apple、Tesla 等不同公司、不同组件或不同设施查询，而一次成功或失败只推进对应 target 的 `next_check_at`，不会误跳过同源下的其它目标。失败 job 会进入 `failed` 并按 backoff 重试，超过 `max_attempts` 进入 `dead`，后续真正 worker loop 会复用同一套 claim/mark 语义。新增免费源时应新增 connector，不在 `run-due` 主循环里继续加 source-specific 分支。

`sources catalog` 是配置前的统一管理视图：它把 source registry 与已注册 connector 能力、`target_config` 字段契约合并展示，不需要数据库。外部 `sources policy sync --file ...` 在写库前会用同一套校验拦截不存在的 source、不可运行的 target kind、字段错误的 target_config 和 manual-only 自动化配置。这样用户自由配置数据源时，错误会停在管理层，而不是进入调度表后才失败。

持续监控参数只从外部 source policy config 进入：source 级 `policies[]` 提供默认 cadence、jitter、priority、`next_check_at`、max attempts 和 backoff；target 级 `check_targets[]` 可以覆盖这些参数。运行时 enqueue job 使用 target 覆盖后的有效值，worker/CLI 不再单独接收重试策略参数，避免同一目标在不同入口表现不一致。

`pnpm worker` 是常驻 source-check worker 入口。它只负责循环、退出信号和每轮 claim 数量；每轮实际执行仍调用 `source-workflows.runDueSourceChecks()`，因此与 `sources run-due` 共用同一套 durable job、connector、retry/backoff 和 dead-letter 语义。生产环境应优先运行 worker；CLI `sources run-due` 保留为手工排查和一次性运维入口。

`census-trade` 是第一条宏观贸易观测 connector：它需要 `CENSUS_API_KEY`，保存 `trade_dataset` 文档，并把 HS code 月度进口/出口值写成 `TRADE_FLOW_OBSERVATION`。它不会写 `edges`，也不会把国家-商品流量推断成公司-公司关系。

`osh` 是第一条设施候选 connector：它需要 `OSH_API_TOKEN`，保存 `facility_dataset` 文档，并把 facility search 结果写成 `FACILITY_PROFILE_OBSERVATION`。OSH contributor 声明只证明设施候选、地理和行业背景；交叉验证和 review/apply 之前不会写 `BUYS_FROM` / `MANUFACTURES_AT`。

当同一个 source item 的官方披露文档内容变化时，pipeline 会对固定语义 section 做 fingerprint diff，并写入 `CUSTOMER_CONCENTRATION_CHANGED`、`INVENTORY_CHANGED`、`BACKLOG_CHANGED`、`CAPEX_CHANGED`、`PROCUREMENT_CHANGED` 或对应 `*_SECTION_ADDED / *_SECTION_REMOVED`。这不是自然语言报告 diff，而是可复现的披露信号 diff。

同一条 source check 还会对规则抽取出的候选关系做 fingerprint diff，写入 `SUPPLIER_RELATION_ADDED / REMOVED`、`CUSTOMER_RELATION_ADDED / REMOVED`、`FOUNDRY_RELATION_ADDED / REMOVED`。采购义务、产能预留、单一供应商风险会进一步拆成 `PURCHASE_OBLIGATION_*`、`CAPACITY_RESERVATION_*`、`SINGLE_SOURCE_RISK_*`。这些事件属于 semantic layer：用于提醒研究员“披露里的关系候选变了”，不会绕过 review/scoring 直接写 graph fact edge。每条 relation semantic change 会同步进入 `review_candidates(kind='semantic_change')`；approve/apply 只是 acknowledge 这次变化，不会生成事实边。

`refreshComponentRiskView()` 还会把新版 component risk view 与上一版指标做稳定 key 对比；超过阈值的派生指标变化写成 `RISK_METRIC_CHANGED`，在 changes timeline 中归为 risk family。它只用于监控和审计 risk 派生层变化，不会修改 fact edge 或 evidence level。

人工校准样本通过 `intelligence calibration-label` 进入 `edge_calibration_labels`；`intelligence calibration-run` 会输出 Level 4/5 fact edge precision、confidence reliability buckets 和错误分类汇总。这个结果用于观察 evidence scoring 是否可靠，不会自动修边，也不会自动改 evidence level。

```sql
CREATE VIEW v_pipeline_stats AS
SELECT
  date_trunc('day', fetched_at) AS day,
  source_adapter_id,
  count(*) AS docs_total,
  count(*) FILTER (WHERE parse_status = 'parsed') AS docs_parsed,
  count(*) FILTER (WHERE parse_status = 'parse_failed') AS docs_failed
FROM documents
GROUP BY 1, 2
ORDER BY 1 DESC;

CREATE VIEW v_review_backlog AS
SELECT status, count(*) AS n
FROM review_candidates
GROUP BY status;

CREATE VIEW v_evidence_level_distribution AS
SELECT evidence_level, count(*) AS n
FROM evidence
GROUP BY 1
ORDER BY 1 DESC;
```

CLI 命令直接查这些 view：

```
supplystrata stats pipeline
supplystrata stats review
supplystrata stats evidence
```

## LLM 调用记录

`packages/llm-bridge` 必须为每次调用写一行 `llm_calls` 表：

```sql
CREATE TABLE llm_calls (
  call_id        TEXT PRIMARY KEY,
  model          TEXT NOT NULL,
  prompt_hash    TEXT NOT NULL,
  input_tokens   INT NOT NULL,
  output_tokens  INT NOT NULL,
  cost_usd       NUMERIC(10, 4) NOT NULL,
  latency_ms     INT NOT NULL,
  status         TEXT NOT NULL,                -- ok|error
  error_text     TEXT,
  caller         TEXT NOT NULL,                -- e.g. "relation-extractor.llm"
  related_doc_id TEXT,
  related_chunk_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

CLI 命令：

```
supplystrata stats llm --since YYYY-MM-DD
```

输出按 caller 聚合的 cost / token / 错误率。

## 健康检查

`supplystrata admin health`：

- Postgres 可连
- Neo4j 可连
- ObjectStore 可读写
- LLM provider key 可用（轻量 ping）
- 关键 view 可查询

退出码 0=健康；非 0=问题。可挂在 cron / launchd。

## 数据漂移监控

每周 housekeeping：

- entity_master 总数变化 / 趋势
- evidence 总数 / 各 level 分布
- edges 各 relation 分布
- review queue 平均停留时间

任何指标突变（按日 / 周环比）→ 写一行警告日志，等运维人 review。

## 错误案例分类

`incidents.md`（PR 时新增）：

- 日期 / 简述 / 影响范围 / 根因 / 修复 / 验证方式
- 即使是个人项目也写，强迫复盘

## 不做的事

- 不上 Sentry / Datadog 等付费服务
- 不上 ELK / Loki（量级不够）
- 不打 metrics 到 prom-client（Phase 3 再说）
- 不做 distributed tracing（单机够用）
