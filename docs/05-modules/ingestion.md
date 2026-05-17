# Module: Ingestion — 数据采集

`packages/sources/*` + `packages/pipeline/ingest`。本文是 source adapter 的契约与实施细节。

## 模块职责

- 拉取原始字节
- 落到 ObjectStore
- 写 `documents` 元数据
- 触发 parse / extract 后续作业
- **不做**任何关系抽取
- **不做**任何实体写入（写入由 entity-resolver 处理）

## 接口（已在 module-design.md 给出，本节展开）

### plan(input, ctx) → AsyncIterable<FetchTask>

输入：触发参数（如 `{ cik: "0001045810", types: ["10-K"], since: "2024-01-01" }`）。

输出：一个 task 流。每个 task 描述"我要去抓什么"。

要求：

- plan 阶段不实际抓取（除非数据源的发现是免不了 HTTP 的，例如要先调 submissions API 才能知道 accession）
- plan 必须是确定的（input 相同时输出顺序相同），方便重跑
- plan 出来的 task_id 必须稳定（基于 url + input hash），同一 task 重跑时能去重

### fetch(task, ctx) → RawDocument

要求：

- 严格遵守 adapter 声明的 rate_limit
- HTTP UA：`SupplyStrata/<version> (+contact email)`
- 超时与重试：默认 30s 超时，3 次指数退避，retry-after header 优先
- HTTP 状态码 4xx（除 429）→ 立即失败、入 dead-letter；不重试
- HTTP 200：写文件 → 计算 sha256 → 检查 `documents.bytes_sha256` 是否已存在
  - 已存在：跳过 fetch，但仍触发 normalize+下游（用最新规则解析）
  - 不存在：落 ObjectStore + 写 documents 行
- 大文件流式写盘，不全读入内存
- 全部 fetch 必须可中断，支持 `AbortController`

### normalize(raw, ctx) → NormalizedDocument

要求：

- `normalize()` 的产物必须是**完整** `NormalizedDocument`，不能只是 `doc_id/source_url` 这类元数据壳。
- 可解析文档必须填充 `text` 与 `chunks`；HTML / PDF / 文本解析应在 adapter 的 `normalize()` 内调用通用 parser，而不是把解析散落到 pipeline。
- 结构化 JSON 源（例如 company registry）也要生成可读文本摘要并切 chunk，方便 source monitor、review 和检索统一消费。
- 解析失败要 friendly：标 `documents.parse_status = "parse_failed"`，写一行错误，但不阻塞
- 输出的 chunks 必须各自有稳定 `chunk_index`（chunk_id 永不变）
- 输出 text 必须 NFKC 规范化 + 去 BOM + 行终止符统一为 `\n`

职责边界：

- source adapter 负责 `plan → fetch → normalize` 的源内闭环。
- parser 包负责通用 HTML / PDF / text 清洗与切块。
- pipeline 只负责保存、抽取、评分、review/apply 编排；不得绕过 adapter 自行解析源文档。

这样 source monitor 后续可以独立调度 `plan/fetch/normalize`，并确信拿到的是完整 normalized document，而不是需要 pipeline 再补解析的半成品。

## Pipeline 编排

### 队列设计（Phase 3 目标：pg-boss）

`v0.1.0-alpha.1` 没有后台队列，ingest / parse / extract / score / apply 仍由 CLI 单进程串起。下面是 Phase 3 进入持续监控后的目标形态，不能当作当前 alpha 已实现能力。

```
queue: ingest.plan        → 接收 trigger，扇出到 ingest.fetch
queue: ingest.fetch       → 抓取单个 task
queue: ingest.normalize   → 解析单文档
queue: extract            → 抽取候选关系
queue: score              → 评级
queue: review.notify      → 通知人工 review
queue: apply              → 写图谱
queue: housekeeping       → daily 任务
```

任务彼此通过 Postgres 表传递；不直接传 in-memory 大对象。

### 幂等性

- `ingest.fetch` 任务以 `task_id` 为 idempotency key
- `documents` 表以 `(source_adapter_id, source_url, bytes_sha256)` 唯一
- `extract` 任务以 `(doc_id, extractor_version)` 唯一

### 失败与 DLQ（Phase 3 目标）

- pg-boss 自动重试（指数退避，最多 3 次）
- 失败入 `pgboss.archive`；CLI 命令 `supplystrata jobs failed` 列出
- 失败 dump 必须含：task input + 完整 stacktrace + 上次调用的 HTTP context

## 速率控制

每个 adapter 自带 token bucket：

```ts
const limiter = createTokenBucket({
  capacity: rate_limit.requests,
  refillEverySec: rate_limit.per_seconds,
});
await limiter.acquire(1);
const resp = await undici.request(url, ...);
```

如果数据源在 429 / 503 时返回 retry-after，必须沿用。多 adapter 同时跑时各自独立 bucket，不共享。

## Robots.txt 与 ToS 检查

每个 adapter 启动时（process boot）：

1. 抓 robots.txt（如适用）
2. 校验 adapter 计划访问的路径是否被禁止
3. 任一路径被禁止 → adapter 拒绝启动 + 报错

ToS 链接必须在 README 与 `tos_url` 字段中保持新鲜。每月 housekeeping 任务检查 tos_url 仍可访问。

## ObjectStore 写入约定

```
key = "<source_adapter_id>/<entity_id_or_unknown>/<YYYY>/<MM>/<sha256>.<ext>"
```

写入的同时：

```
documents:
  storage_key = key
  bytes_sha256 = sha256
```

不允许：

- 同一 sha256 多次写入（write-once-read-many）
- 在 Postgres 中存大字节（base64 之类一律禁止）

## 文档元数据

每个 document 必须填：

- `document_type`：固定枚举
- `language`：通常由 adapter 推断（IR 网站可能含语言后缀），失败则 `und`
- `source_date`：文档自身发布日期（不是 fetched_at）；缺失则空，但要在 metadata 里说明为什么

## 监控点

每次 ingest 周期发布 metrics（结构化日志）：

```
event=ingest.adapter.start  adapter=sec-edgar
event=ingest.task           task_id=... url=... status=ok|fail|skip
event=ingest.adapter.done   adapter=sec-edgar tasks_total=120 ok=118 fail=2
```

参数化报警阈值：

- 任一 adapter 单次 ingest 失败率 > 20% 报警
- 任一 adapter 连续 3 次 ingest 全失败报警

## 测试约束

- 每个 adapter 至少 5 条 fixture（保存的真实 HTTP 响应或文件）
- fetch / normalize 必须能在不联网情况下跑通
- HTTP mock 用 nock 或自写 fixture loader
- 增加新 adapter 必须新增至少：
  - 1 个 happy path
  - 1 个 rate_limit 重试场景
  - 1 个 4xx 错误场景
  - 1 个文档已存在的去重场景
  - 1 个解析异常场景

## Manual Source（手工录入）

`source_adapter_id = "manual"` 是一个特殊 adapter。CLI 接口：

```
supplystrata manual document add \
  --type "earnings_call_transcript" \
  --entity ENT-NVIDIA \
  --url <orig-url> \
  --date 2026-02-26 \
  --file ./local.pdf

supplystrata manual evidence add \
  --doc DOC-... \
  --cite "..." \
  --relation BUYS_FROM \
  --subject ENT-NVIDIA \
  --object ENT-SK-HYNIX \
  --component "memory" \
  --note "manual entry by xxx"
```

要求：

- 必填 reviewer
- evidence_level 由 reviewer 在 [1-5] 范围给出，受规则约束（如 LLM 仍上限 4）
- 进 ChangeRecord
