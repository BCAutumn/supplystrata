# Data Flow — 端到端数据流

本文用具体例子（NVIDIA 10-K）走一遍从原始数据到图谱再到 CLI 输出的全流程。任何对系统的修改必须先复核这条数据流不会断。

## 流程图

```
[1] Trigger        : "fetch NVIDIA latest 10-K"
        ↓
[2] Source Adapter : sec-edgar adapter
   - plan() → 找到目标 10-K 的 URL
   - fetch() → 下载 HTML
   - persist 原始字节 → ObjectStore 落 data/raw/sec-edgar/<sha256>.html
   - 写 documents 表
        ↓
[3] Parser         : html parser → 清洗 → chunk
   - 写 document_chunks
        ↓
[4] Entity tagging : 对 chunks 做 entity 候选识别 (规则 + 词表)
   - 调用 EntityResolver
   - 已知实体 → 标 entity_id
   - 未知 → 入 pending_entities + review queue
        ↓
[5] Relation extract: rule extractors 优先 → llm extractor 兜底
   - 输出 CandidateRelation
        ↓
[6] Evidence scoring: scorer 给每条 candidate 打 evidence_level / confidence
   - LLM 抽取 → needs_review = true
   - 高等级官方披露 → 可自动通过
        ↓
[7] Review queue   : (人工 or auto)
   - approved → 进入 graph
   - rejected → review queue 标记为 rejected（保留作 negative sample）
        ↓
[8] Graph builder  : apply()
   - 先写 Postgres（edge/evidence/change）
   - 再写 Neo4j 当前态视图（失败可重试/rebuild）
        ↓
[9] Query layer    : CLI / API
   - 读 Neo4j（结构）+ Postgres（证据/元数据）
   - 渲染 Markdown / JSON
        ↓
[10] User
```

## 详细步骤（NVIDIA 10-K 为例）

### Step 1: Trigger

CLI 命令或 cron：

```
supplystrata ingest sec-edgar --cik 0001045810 --types 10-K --since 2024-01-01
```

pipeline 创建 `pg-boss` job：

```json
{ "queue": "ingest", "data": { "adapter": "sec-edgar", "input": { "cik": "0001045810", "types": ["10-K"], "since": "2024-01-01" } } }
```

### Step 2: Source Adapter

`sec-edgar` adapter:

1. `plan(input)`：调 EDGAR submissions API 拿到 NVIDIA 最近 10-K 的 accession，生成 FetchTask。
2. `fetch(task)`：下载 HTML（官方域名 + User-Agent + rate limit）。
3. 保存原始文件：`data/raw/sec-edgar/0001045810/<accession>/0001045810-25-000023-index.html`。
4. 写一行 `documents`：`(doc_id, source_adapter_id="sec-edgar", document_type="10-K", primary_entity_id="ENT-NVIDIA", source_url, fetched_at, sha256, storage_key)`。
5. `normalize()`：HTML 清洗 + 主体内容抽取（去样式 / nav / footer），切 chunks，写 `document_chunks`。

### Step 3: Parser

对 HTML：

- 使用 cheerio + 自写 readability-like 算法
- 切 chunk：以 H1/H2/H3 为锚点；超长段落按 2000 token 切
- 每个 chunk 带 `locator`（如 `Item 1A. Risk Factors > Manufacturing`）

对 PDF（其他场景）：

- pdfjs-dist 拿文本 + 页码
- 复杂表格（Apple Supplier List）MVP 走半自动 CSV + 人工 review；Phase 3 之后再考虑 Python sidecar

输出：`document_chunks` 表，含 text / locator / language / token_count。

### Step 4: Entity tagging

Pipeline 拿每个 chunk 跑：

1. 词表硬匹配（all entities + aliases，Aho-Corasick）→ 找出所有 surface 命中
2. 对每个命中调 `EntityResolver.resolve({ surface, context: { nearby_text, document_type, co_mentioned_entities, inferred_country, industry_hint } })`
3. 根据返回的 status：
   - `resolved` → 落 `chunk_entities(chunk_id, entity_id, span_start, span_end, confidence)`
   - `ambiguous` → 入 `entity_review_queue`，pipeline 跳过这个 mention
   - `unknown` → 入 `pending_entities`

这一步不做关系抽取，只是给 chunk 打实体标签。

### Step 5: Relation Extraction

按 priority 顺序跑：

1. `rule.10k.foundry-disclosure`（高优先级）
   - 模式：`utiliz(e|es) foundr(y|ies) such as (X(?:, Y)*( and Z)?)`
   - 命中 NVIDIA 10-K 中 "We utilize foundries such as TSMC and Samsung" → 提出候选 `NVIDIA USES_FOUNDRY TSMC` / `NVIDIA USES_FOUNDRY Samsung`
2. `rule.10k.memory-disclosure`
3. `rule.10k.contract-manufacturer`
4. `llm.10k.relations`（兜底）
   - 给 LLM 一个 chunk + zod schema，让它输出候选关系
   - 默认低 confidence、`needs_review = true`
5. `corroborator`：跨文档对同一关系增加证据数

每个候选必须填：

- `subject_resolve / object_resolve`（待 EntityResolver 解析；如果在 step 4 已经标过实体，可以直接用 entity_id）
- `cite_text`：原文片段（>=30 字符）
- `cite_locator`：在文档内的位置
- `extractor_id`：抽取器 ID
- `raw_evidence_level_hint` / `raw_confidence_hint`

不允许：抽取器自己直接写图谱。

### Step 6: Evidence Scoring

scorer 输入候选 + 文档元数据，输出 evidence_level / confidence / is_inferred / needs_review / rationale。

打分规则（落 [evidence-model.md](../03-data-model/evidence-model.md) 与 [confidence-scoring.md](../03-data-model/confidence-scoring.md)）：

```
if extractor is rule AND document_type in ("10-K", "10-Q", "20-F"):
   evidence_level = 5
   needs_review = false  (官方披露 + 规则强匹配)

if extractor is rule AND document_type in ("supplier_list", "annual_report"):
   evidence_level = 4
   needs_review = false

if extractor is llm AND document_type in ("10-K", "10-Q"):
   evidence_level = 4 (上限)
   needs_review = true

if extractor is llm AND document_type in ("press_release", "news"):
   evidence_level = max 2
   needs_review = true

# Comtrade / BOL 推断（Phase 3）
if extractor is "trade.bol.repeat-importer" AND evidence_count >= 6:
   evidence_level = 3
   is_inferred = true
   needs_review = true
```

### Step 7: Review Queue

如果 `needs_review = true`：

- 写 `extraction_review_queue`
- CLI 命令 `supplystrata review next` 取出一条
- 研究员看：原文片段 + 抽取器 ID + 候选 → 选择 approve / reject / fix

如果 `needs_review = false`：

- 自动 approve

approved 候选写入 review queue 的 approved 状态。批处理命令只能 apply approved 候选，不能把 pending 候选直接写图。

### Step 8: Graph Builder

对 approved candidate：

1. 解析 subject / object 实体 ID（最后保险）
2. 找是否已有 edge：`(subject_id, object_id, relation, component)` 唯一键
3. 如有 → append evidence；如无 → 创建新 edge
4. 在 Postgres 事务内写 `evidence`、`edges`、`change_records`
5. Postgres commit 成功后写 Neo4j：MERGE node + MERGE edge
6. Neo4j 写失败则进入 `pgboss.failed-graph-write` 重试；必要时通过 `rebuild()` 恢复
7. 触发 `change.detected` 事件（可选，给将来用）

物理上：

- Neo4j 是单一真相视图（当前态）
- Postgres 是事件源（全历史）

### Step 9: Query

`supplystrata company nvidia --depth 1`:

1. 读 Neo4j：`MATCH (n {entity_id:'ENT-NVIDIA'})-[r]-(m) RETURN ...`
2. 对每条 edge_id 去 Postgres `evidence` 拉证据列表
3. 拉 unknown_map（Postgres `unknown_items`）
4. 拉 changes（Postgres `change_records` where entity in scope）
5. 渲染 Markdown / JSON

### Step 10: User

研究员看到结果，可能：

- 提交 PR 加新别名
- 通过 `supplystrata unknown add` 加新未知项
- 手动 reject 一条边（落 ChangeRecord，validity = deprecated）

## 失败模式与重试

| 失败点                       | 处理                                                 |
| ------------------------- | -------------------------------------------------- |
| 数据源 HTTP 失败                | pg-boss 自动重试，指数退避；3 次后入 dead-letter，开 CLI 命令查看      |
| 文档已存在（同 sha256）            | 跳过 fetch；但仍重新跑 parse+extract（用最新规则）                 |
| 解析器抛错                      | 文档标 `parse_failed`，入失败队列；不阻塞其它文档                    |
| EntityResolver `ambiguous` | 抽取器跳过该 mention；mention 进 review queue                |
| LLM 超时 / cost 超限          | 候选 status = "deferred"；下次跑                          |
| Neo4j 写失败                  | Postgres 已写，Neo4j 重试；可通过 `rebuild()` 全量重建            |

## 不允许的反模式

- 在 ingestion 中"顺手"做关系抽取（数据流断点）
- 跳过 EntityResolver 直接写 entity name（实体污染）
- 在 graph builder 里物理删除边
- 在 LLM 抽取中不写 cite_text
- 在 review 之外的地方 promote evidence_level

## 可观测性钩子

每一步都打 structured log：

```
{ stage: "ingest", adapter: "sec-edgar", task_id, doc_id, status: "ok", duration_ms }
{ stage: "parse",  doc_id, chunks: 134, tables: 0 }
{ stage: "tag",    doc_id, mentions: 56, ambiguous: 3 }
{ stage: "extract", doc_id, candidates: 12, by_extractor: {...} }
{ stage: "score",   doc_id, by_level: {3: 2, 4: 7, 5: 3} }
{ stage: "apply",   edge_id, is_new: true }
```

详见 [observability.md](../07-operations/observability.md)。
