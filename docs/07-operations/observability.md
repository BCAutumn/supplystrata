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
- `source_change_events`：`DOCUMENT_NEW` / `DOCUMENT_UNCHANGED` / `DOCUMENT_CHANGED` 事件流。
- `fetch_runs`：抓取尝试记录，后续接入 pipeline 后用于失败率和限速分析。

CLI:

```bash
pnpm --silent cli sources health --format markdown
pnpm --silent cli sources due --format markdown
pnpm --silent cli sources policy sync --file config/source-policies.example.json
```

`@supplystrata/source-monitor` 是唯一允许计算 source item change type 和 source policy cadence 的包；pipeline 只调用它，不在各 adapter 里自己判断“新/旧/变化”。

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
