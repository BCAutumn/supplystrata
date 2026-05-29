# Data Flow — 端到端数据流

本文是 SupplyStrata 的**单一主数据流**。如果系统行为与本文不一致，应改实现而不是改本文；如要改本文，先回到 [decisions.md](../10-decisions/decisions.md) 调整决策。

历史上曾有"两条必须同时成立的数据流"（read-through 流 + NVIDIA 10-K 流），它制造了"我们是 agent 形态还是 ETL 形态"的歧义。新形态统一为**一条 9 步主流程**，NVIDIA / Tesla 等具体公司只作为附录 worked example。

## 顶层视角：一次研究请求的端到端

```
┌──────────────────────────────────────────────────────────────────────────┐
│  外部 AI agent (Cursor / Claude Desktop / 自建) 或 @supplystrata/cli      │
│  ⇣ MCP tool: resolve_company / start_research_session / read_*           │
├──────────────────────────────────────────────────────────────────────────┤
│  @supplystrata/mcp  (Layer 3 接入面)                                      │
│  ⇣ 调用 workflow                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│  research-session + source-workflows + pipeline + graph-builder           │
│  受控 LLM 调用走 @supplystrata/llm-helpers（单步、返回候选、不写事实）      │
│  ⇣ 读官方源 ↑ 写本地 cache                                                 │
├──────────────────────────────────────────────────────────────────────────┤
│  Layer 1: 本地 cache (Postgres) + community-pack baseline + 官方源 truth   │
└──────────────────────────────────────────────────────────────────────────┘
```

任何客户端（前端 / agent / CLI / 集成方）都走同一组 MCP tools，**没有平行私有路径**。

## 主流程：9 步

```
[1] company query
       (LVMH / MC.PA / 969500FP1Q07I98R6P10 / 路易威登 / 任意上市公司)
       ↓
[2] universal identity bootstrap
       (a) 本地 cache → 命中即返回
       (b) GLEIF / OpenFIGI / Wikidata 通用身份
       (c) 国家专属官方目录（US: SEC, KR: DART, JP: EDINET, TW: TWSE,
           HK: HKEX, UK: Companies House, EU: 各国 OAM, ...）
       (d) 命中歧义时，调 llm-helpers.disambiguate_entity 返回候选（不直接写）
       (e) 命中成功 → 写 entity_master + entity_alias + provenance
       (f) 不可达 / 未覆盖市场 → 显式状态返回，不伪装成"公司不存在"
       ↓
[3] dynamic profile derive  (plan-context only, 不持久化, 不写事实)
       (a) 检查是否匹配内置 verification anchor profile
       (b) 否则调 llm-helpers.derive_dynamic_profile 读公司公开简介 /
           SIC/NAICS / 10-K Item 1 → 输出 expected upstream components
           + source targets
       (c) 用户/agent 可通过 MCP tool 参数显式覆盖
       ↓
[4] source plan & routing
       (a) 按国家路由：US → SEC EDGAR, KR → DART, JP → EDINET, ...
       (b) 按组件 / profile 加 expected source targets
       (c) 按 source registry 过滤 ToS / credential 状态
       (d) 调用方可 llm-helpers.suggest_source_targets 加候选（仅 plan）
       ↓
[5] source checks
       (a) 抓官方源（rate limit、UA、retry/backoff）
       (b) 归档原始字节 → ObjectStore data/raw/<sha256>
       (c) 写 documents / source_change_events / source_check_jobs
       (d) 失败 → 显式状态（unreachable / blocked / missing_credentials）
       ↓
[6] normalize & parse
       (a) HTML / PDF / JSON / XBRL → text + locator
       (b) 写 document_chunks
       (c) 解析失败 → parse_failed 状态，不阻塞其它文档
       ↓
[7] extract
       (a) 词表硬匹配 + EntityResolver → chunk_entities
       (b) rule extractors → 候选 fact edge / observation / semantic change
       (c) （opt-in）LLM helper 抽取兜底 → 候选必须有 cite text
       ↓
[8] evidence-gated promote
       (a) extractor=rule AND source=官方 AND evidence_level≥4 → 自动写入
           edges + evidence + change_records
       (b) 双源 corroboration（独立官方源同关系）→ 自动写入
       (c) LLM 单源 / 弱源 / 单一来源 / 有冲突 → 留作 review_candidates
       (d) graph-builder 投影 Postgres → GraphStore（Neo4j）
       (e) observation / lead / source health 永不写 fact edge
       ↓
[9] consume via MCP
       resources (按需读):
         supplystrata://entity/{id}
         supplystrata://scbom/company/{lei}
         supplystrata://evidence/edge/{id}
         supplystrata://unknowns/company/{id}
         supplystrata://changes/entity/{id}
         supplystrata://source-health
       tools (主动调):
         resolve_company / start_research_session / poll_research_run
         run_source_check / read_evidence_for_edge / traverse_chain
         list_unknowns / list_source_targets
```

`supplystrata://scbom/company/{lei}` 返回原始 SCBOM v0.0.1 document，而不是 API envelope；MCP 层仍经 `api-orchestration` 调用 `getCompanyScbomDocument`，再由 `workbench-export.toScbomDocument()` 按 `@scbom/spec` schema 校验后输出。

完整 MCP 契约见 `@supplystrata/mcp` package README（在该 package 落地时）。

## 关键不变式

| 不变式                                                                                            | 在哪一步生效 | 违反后果                      |
| ------------------------------------------------------------------------------------------------- | ------------ | ----------------------------- |
| 任何写 `edges` / `evidence` / `claims` 的代码路径不允许 import `llm-helpers`                      | [7][8]       | 事实层被 LLM 污染，方法学失效 |
| LLM 调用必须返回 candidate（不能返回 final fact）                                                 | [2][3][4][7] | 同上                          |
| agent loop 不允许写库；MCP write tool 必须经过 server-side pending gate + 单次 confirmation token | [9]          | 外部 agent 可绕过方法学       |
| observation / lead / source health 永不写 fact edge                                               | [8]          | 把变化信号误读成关系事实      |
| community-pack 是 read-only baseline；本地写覆盖 pack 字段但不污染 pack                           | [warm-start] | pack 升级时本地工作丢失       |
| terminal state (`deprecated` / `superseded` / `rejected` / `resolved`) 不能被普通 upsert 复活     | [8]          | 审计断裂                      |

参见 [intelligence-methodology.md](../03-data-model/intelligence-methodology.md) "Fact 写入不变式"和 [decisions.md](../10-decisions/decisions.md) #3、#9、#13、#14。

## 状态语义

`supply-chain-report` 的 `report_quality`：

| 状态                    | 含义                                                       |
| ----------------------- | ---------------------------------------------------------- |
| `facts_ready`           | 有 reviewed L4/L5 fact edge，可引用                        |
| `review_needed`         | 找到官方文本候选，需要 agent 或用户决定写入                |
| `observations_only`     | 有官方文件或财务指标，但还没有 reviewed supplier graph     |
| `source_checks_pending` | source check 在 worker 队列里                              |
| `source_checks_failed`  | source check 失败；看 failure_kind，不能当"没有供应链关系" |
| `no_coverage`           | 当前实例无可用覆盖；agent 必须独立说明信息来源             |

`source check failure_kind`：`unreachable` / `blocked` / `missing_credentials` / `target_config_invalid` / `rate_limited` / `adapter_error`。每一种都对应一组 `next_actions`，不混合归类成"失败"。

## community-pack warm start

```
首次启动：
  pnpm api --pack=supplystrata-pack-YYYY.QN.parquet
    ↓
  Layer 1 加载 pack (read-only baseline)
    ↓
  本地 Postgres 镜像为 cache（pack 内容 + 本地新写）
    ↓
  研究任意公司时：
    - pack 已覆盖 → 第 [9] 步直接出结果
    - pack 未覆盖 → 走完整 [1]-[9]，本地写入

后续启动：
  本地 cache 已有 → 直接用
  pack 升级（新季度发布）→ 与本地 cache 合并，本地写入保留

删本地 Postgres：
  只丢 cache；可重新拉 pack + 重跑 source check 完整重建
```

详见 [decisions.md](../10-decisions/decisions.md) #14。

## 失败模式

| 失败点                           | 处理                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| identity bootstrap 全部失败      | 返回 `unresolved` 或 `ambiguous`；不写 entity，不走后续步骤                                |
| dynamic profile derive LLM 失败  | 退回到 generic profile（仅按国家 + SIC code 路由 source target），不阻断流程               |
| source HTTP 失败                 | source-check job 写 failed + failure_kind；按 policy backoff 重试；超 max_attempts 进 dead |
| 文档已存在（同 sha256）          | 跳过 fetch；但仍重新跑 parse + extract（用最新规则）                                       |
| 解析器抛错                       | 文档标 `parse_failed`，入失败队列；不阻塞其它文档                                          |
| EntityResolver `ambiguous`       | 抽取器跳过该 mention；mention 进 review queue                                              |
| LLM helper 超时 / cost 超限      | 候选 status = `deferred`；下次跑                                                           |
| MCP tool 调用被用户拒绝          | 不执行；返回 `user_denied`，agent 应明示用户决定                                           |
| community-pack 校验失败 (sha256) | 拒绝加载；走纯本地 cache 模式；显式告警                                                    |
| Neo4j 写失败                     | Postgres 已写，Neo4j 重试；可通过 `rebuild()` 全量重建                                     |

## 不允许的反模式

- 在 ingestion 中"顺手"做关系抽取（数据流断点）
- 跳过 EntityResolver 直接写 entity name（实体污染）
- 在 graph builder 里物理删除边
- 在 LLM 抽取中不写 cite_text
- 在 review 之外的地方 promote evidence_level
- 在 MCP write tool 里跳过 evidence-gated promote
- 让 agent loop 直接读 LLM helper 输出当 fact
- 让 community-pack 覆盖本地已审 fact
- 把"数据库当前没有"误报成"公司不存在"
- 把 source-check 抓取成功 (`succeeded`) 等同于"已抽出供应链事实"

## 可观测性钩子

每一步打 structured log：

```
{ stage: "identity_bootstrap", query, source: "gleif", status, duration_ms }
{ stage: "profile_derive",     entity_id, mode: "anchor|llm|generic", components: N }
{ stage: "source_plan",        entity_id, targets: N, blocked: N }
{ stage: "source_check",       adapter, target_id, status, doc_count }
{ stage: "parse",              doc_id, chunks, tables }
{ stage: "extract",            doc_id, candidates, by_extractor }
{ stage: "promote",            doc_id, auto_written, review_queued }
{ stage: "mcp_call",           tool, agent_hint, duration_ms, status }
```

实现见 `packages/observability/README.md`，本地运行入口见 [quickstart.md](../06-development/quickstart.md)。

---

## 附录 A：NVIDIA 10-K 作为第 [5]-[8] 步的 worked example

旧版数据流文档把这条具体路径作为"传统数据流"独立列出。新形态下它只是主流程在 NVIDIA + SEC EDGAR 这一对参数下的具体实例。

### Step 5（在 NVIDIA 上）

```
sec-edgar adapter:
  plan()  → EDGAR submissions API 拿到最近 10-K accession
  fetch() → HTTPS 下载 HTML（UA + 1 req/s）
  archive → data/raw/sec-edgar/0001045810/<accession>/...-index.html
  write    documents (doc_id, source_adapter_id="sec-edgar",
                      document_type="10-K", primary_entity_id="ENT-NVIDIA",
                      source_url, fetched_at, sha256, storage_key)
```

### Step 6（在该 doc 上）

```
parser: cheerio + readability-like
chunk: 以 H1/H2/H3 为锚点；超长段 2000 token 切
locator: e.g. "Item 1A. Risk Factors > Manufacturing"
write document_chunks
```

### Step 7（在该 chunk 上）

```
rule.sec.official-supply-chain 命中:
  "We utilize foundries such as TSMC and Samsung."
  → 候选 NVIDIA USES_FOUNDRY TSMC   [evidence_level=5, extractor=rule]
  → 候选 NVIDIA USES_FOUNDRY Samsung [evidence_level=5, extractor=rule]
  cite_text = 原文 + chunk offset + sha256 fingerprint
```

### Step 8（auto-promote 触发）

```
extractor=rule AND source=sec-edgar AND evidence_level=5
  → 满足自动写入条件
  → tx: 写 edges + evidence + change_records
  → tx commit 后投影 Neo4j (MERGE node + MERGE edge)
  → 不入 review queue
```

如果同一关系在 TSMC 自己的 SEC 20-F / 年报中再次出现：

```
独立官方源 corroboration
  → claim fusion: support_confidence 提升
  → edge 不变，evidence 列表 +1
  → 不重复创建 edge
```

### Step 8 的另一面（review 路径）

```
若是 LLM helper 抽取的关系：
  candidate.needs_review = true
  写 review_candidates 而不是 edges
  → 由调用 agent 通过 MCP review.approve / review.reject 决定
  → 默认配置下不阻塞 facts_ready 状态（review 是 opt-in，#13）
```

---

## 附录 B：Tesla 作为"覆盖未深 + observations_only"的 worked example

参考 `tests/llm_research/D.md`：当前 Tesla 报告是 `partial / observations_only / reviewed supplier fact edges = 0`，原因是：

- 第 [5] 步：SEC source checks succeeded（10-K 抓到了）
- 第 [6] 步：parse 成功
- 第 [7] 步：rule extractor 没有命中（10-K 措辞是"we rely on suppliers including Panasonic and CATL"，不是 hard-coded 模式之一）
- 第 [8] 步：没有 auto-promote 候选，没有 review 进入
- 第 [9] 步：consumer-read-model 显示 `observations_only` 但 `extraction_summary.fact_edges = 0`

修复路径不是改方法学，而是：

1. 在 `rule.sec.memory-supplier` / `rule.sec.battery-supplier` 加 Tesla 措辞模式
2. 或 opt-in LLM helper 抽取，让 candidate 进 review 队列，由 agent 处理
3. 或扩展 `ev-battery-energy.v0` profile 让 expected source 包含 Tesla 10-K 关键段落 locator

这是**数据深度问题**，不是**架构问题**。
