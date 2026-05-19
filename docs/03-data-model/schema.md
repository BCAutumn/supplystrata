# Schema — 数据库 Schema

两个存储：

- **PostgreSQL**：所有元数据、证据、文档、实体、别名、变更、队列。是事件源 / 真相存储。
- **Neo4j**：图谱当前状态的物化视图。可以从 Postgres 全量重建。

下面给出 Phase 0-2 必须存在的表 / 节点 / 关系。MVP 当前的实际 DDL 位于 `packages/db/src/migration-sql/*.ts`，并由 `packages/db/src/migrations.ts` 按版本顺序执行。不要再维护单个大 `schema.ts`，新增表或列必须进入新的 migration 文件。

## PostgreSQL 表清单

### 1. entity_master

```sql
CREATE TABLE entity_master (
  entity_id       TEXT PRIMARY KEY,                -- ENT-uuid 或 ENT-NVIDIA
  kind            TEXT NOT NULL,
  canonical_name  TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  language_of_canonical TEXT NOT NULL,
  identifiers     JSONB NOT NULL DEFAULT '{}'::jsonb,
  primary_country TEXT,
  hq_location     JSONB,
  industry        TEXT[] DEFAULT '{}',
  founded_year    INT,
  status          TEXT NOT NULL DEFAULT 'active',
  merged_into_entity_id TEXT REFERENCES entity_master(entity_id),
  evidence_for_existence TEXT,                      -- evidence_id (可空)
  attrs           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_entity_master_kind ON entity_master(kind);
CREATE INDEX idx_entity_master_country ON entity_master(primary_country);
CREATE INDEX idx_entity_master_identifiers_cik ON entity_master ((identifiers->>'cik'));
CREATE INDEX idx_entity_master_identifiers_lei ON entity_master ((identifiers->>'lei'));
```

### 2. entity_alias

```sql
CREATE TABLE entity_alias (
  alias_id     TEXT PRIMARY KEY,                    -- ALIAS-uuid
  entity_id    TEXT NOT NULL REFERENCES entity_master(entity_id),
  alias        TEXT NOT NULL,
  alias_norm   TEXT NOT NULL,                       -- normalized lowercase + nfkc
  language     TEXT,
  alias_kind   TEXT NOT NULL,
  evidence_id  TEXT,                                -- nullable for seed
  source_type  TEXT,
  added_by     TEXT NOT NULL,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  status       TEXT NOT NULL DEFAULT 'active',
  UNIQUE(entity_id, alias_norm, language)
);

CREATE INDEX idx_entity_alias_norm ON entity_alias(alias_norm);
```

### 3. documents

```sql
CREATE TABLE documents (
  doc_id            TEXT PRIMARY KEY,               -- DOC-uuid
  source_adapter_id TEXT NOT NULL,
  document_type     TEXT NOT NULL,
  primary_entity_id TEXT REFERENCES entity_master(entity_id),
  source_url        TEXT NOT NULL,
  source_date       DATE,
  fetched_at        TIMESTAMPTZ NOT NULL,
  bytes_sha256      TEXT NOT NULL,
  storage_key       TEXT NOT NULL,                  -- 在对象存储中的 key
  language          TEXT,
  parse_status      TEXT NOT NULL DEFAULT 'pending', -- pending|parsed|parse_failed|skipped
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(source_adapter_id, source_url, bytes_sha256)
);

CREATE INDEX idx_documents_source_date ON documents(source_date);
CREATE INDEX idx_documents_primary_entity ON documents(primary_entity_id);
```

### 4. document_chunks

```sql
CREATE TABLE document_chunks (
  chunk_id     TEXT PRIMARY KEY,                    -- CHK-uuid
  doc_id       TEXT NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
  chunk_index  INT NOT NULL,
  text         TEXT NOT NULL,
  locator      TEXT,                                -- e.g. "Item 1A. Risk Factors"
  language     TEXT,
  token_count  INT,
  attrs        JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(doc_id, chunk_index)
);

CREATE INDEX idx_chunks_doc ON document_chunks(doc_id);
-- pgvector 列（Phase 3 再评估）：embedding vector(1024)
```

### 5. chunk_entities

```sql
CREATE TABLE chunk_entities (
  id          BIGSERIAL PRIMARY KEY,
  chunk_id    TEXT NOT NULL REFERENCES document_chunks(chunk_id) ON DELETE CASCADE,
  entity_id   TEXT NOT NULL REFERENCES entity_master(entity_id),
  span_start  INT NOT NULL,
  span_end    INT NOT NULL,
  surface     TEXT NOT NULL,
  confidence  REAL NOT NULL,
  resolver_status TEXT NOT NULL,                   -- resolved|ambiguous|unknown
  context     JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_chunk_entities_entity ON chunk_entities(entity_id);
CREATE INDEX idx_chunk_entities_chunk ON chunk_entities(chunk_id);
```

### 6. evidence

```sql
CREATE TABLE evidence (
  evidence_id        TEXT PRIMARY KEY,              -- EV-uuid
  edge_id            TEXT,                          -- 关联到 edges 表（可后填）
  doc_id             TEXT NOT NULL REFERENCES documents(doc_id),
  chunk_id           TEXT REFERENCES document_chunks(chunk_id),
  cite_text          TEXT NOT NULL,
  cite_locator       TEXT,
  cite_start_char    INT,                           -- chunk 内 0-based inclusive
  cite_end_char      INT,                           -- chunk 内 0-based exclusive
  cite_text_sha256   TEXT,                          -- 原始 cite_text 哈希
  normalized_cite_text_sha256 TEXT,                 -- NFKC + 空白归一后的 cite_text 哈希
  source_snapshot_sha256 TEXT,                      -- documents.bytes_sha256 快照
  parser_version     TEXT,                          -- 产生 chunk/text 的 parser 版本
  extractor_version  TEXT,                          -- 产生 candidate 的 extractor/prompt 版本
  relation_candidate_hash TEXT,                     -- 关系候选稳定指纹
  evidence_level     SMALLINT NOT NULL CHECK (evidence_level BETWEEN 1 AND 5),
  confidence         REAL NOT NULL,
  is_inferred        BOOLEAN NOT NULL,
  extraction_method  TEXT NOT NULL,                 -- rule|llm|manual|hybrid
  extractor_id       TEXT,
  llm_meta           JSONB,                         -- model, prompt_hash, tokens, cost
  reviewer           TEXT,
  reviewed_at        TIMESTAMPTZ,
  superseded_by      TEXT REFERENCES evidence(evidence_id),
  confidence_breakdown JSONB NOT NULL,
  rationale          TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_evidence_edge ON evidence(edge_id);
CREATE INDEX idx_evidence_doc ON evidence(doc_id);
CREATE INDEX idx_evidence_relation_candidate_hash ON evidence(relation_candidate_hash);
```

### 7. edges

```sql
CREATE TABLE edges (
  edge_id            TEXT PRIMARY KEY,              -- EDGE-uuid
  subject_id         TEXT NOT NULL REFERENCES entity_master(entity_id),
  object_id          TEXT NOT NULL REFERENCES entity_master(entity_id),
  relation           TEXT NOT NULL,
  component          TEXT,                          -- 人类可读兼容字段，nullable
  component_id       TEXT REFERENCES components(component_id),
  component_specificity TEXT,                       -- explicit|inferred|unspecified
  attrs              JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_level     SMALLINT NOT NULL,
  confidence         REAL NOT NULL,
  is_inferred        BOOLEAN NOT NULL,
  validity           TEXT NOT NULL DEFAULT 'current',
  effective_from     DATE,
  effective_to       DATE,
  primary_evidence_id TEXT REFERENCES evidence(evidence_id),
  first_observed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_verified_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deprecated_reason  TEXT,
  superseded_by_edge_id TEXT REFERENCES edges(edge_id)
);

CREATE INDEX idx_edges_subject ON edges(subject_id);
CREATE INDEX idx_edges_object ON edges(object_id);
CREATE INDEX idx_edges_relation ON edges(relation);
CREATE INDEX idx_edges_validity ON edges(validity);
CREATE INDEX idx_edges_component_id ON edges(component_id);
CREATE UNIQUE INDEX uniq_edges_identity ON edges (
  subject_id,
  object_id,
  relation,
  COALESCE(component_id, ''),
  COALESCE(component, ''),
  COALESCE(effective_from, DATE '1900-01-01'),
  COALESCE(effective_to, DATE '2999-12-31')
);
```

`component` 暂时保留，目的是兼容旧 evidence 和 CLI 输出；新写入链应优先填 `component_id`。`component_specificity` 表示这条边的组件粒度来自什么证据：

- `explicit`：原文明确说出该具体组件，如 HBM、DRAM、wafer。
- `unspecified`：原文只支持父组件，如 memory。
- `inferred`：未来经人工或规则允许的组件细化推断；默认不用于 Level 4/5 官方边。

### 8. change_records

```sql
CREATE TABLE change_records (
  change_id     TEXT PRIMARY KEY,                   -- CHG-uuid
  detected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  scope_kind    TEXT NOT NULL,                      -- company|component|edge|entity
  scope_id      TEXT NOT NULL,
  change_type   TEXT NOT NULL,
  before        JSONB,
  after         JSONB,
  evidence_ids  TEXT[] NOT NULL DEFAULT '{}',
  caused_by     TEXT NOT NULL                        -- ingestion|manual|review|...
);

CREATE INDEX idx_change_records_scope ON change_records(scope_kind, scope_id);
CREATE INDEX idx_change_records_detected_at ON change_records(detected_at DESC);
```

### 9. source monitoring

```sql
CREATE TABLE source_health (
  source_adapter_id  TEXT PRIMARY KEY,
  tier               TEXT NOT NULL,
  category           TEXT NOT NULL,
  registry_status    TEXT NOT NULL,
  automation         TEXT NOT NULL,
  tos_url            TEXT NOT NULL,
  official_url       TEXT NOT NULL,
  requires_key       BOOLEAN NOT NULL,
  last_checked_at    TIMESTAMPTZ,
  last_success_at    TIMESTAMPTZ,
  last_failure_at    TIMESTAMPTZ,
  failure_count      INT NOT NULL DEFAULT 0,
  last_change_at     TIMESTAMPTZ,
  last_error_message TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE source_policies (
  source_adapter_id     TEXT PRIMARY KEY,
  enabled               BOOLEAN NOT NULL DEFAULT true,
  check_cadence_minutes INT NOT NULL,
  jitter_minutes        INT NOT NULL DEFAULT 0,
  priority              INT NOT NULL DEFAULT 100,
  config_source         TEXT NOT NULL DEFAULT 'default',
  next_check_at         TIMESTAMPTZ,
  notes                 TEXT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE source_check_targets (
  check_target_id   TEXT PRIMARY KEY,
  source_adapter_id TEXT NOT NULL,
  target_kind       TEXT NOT NULL,
  subject_entity_id TEXT,
  enabled           BOOLEAN NOT NULL DEFAULT true,
  priority          INT NOT NULL DEFAULT 100,
  next_check_at     TIMESTAMPTZ,
  target_config     JSONB NOT NULL DEFAULT '{}'::jsonb,
  config_source     TEXT NOT NULL DEFAULT 'default',
  notes             TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE source_items (
  source_item_id       TEXT PRIMARY KEY,
  source_adapter_id    TEXT NOT NULL,
  item_key             TEXT NOT NULL,
  url                  TEXT NOT NULL,
  latest_doc_id        TEXT REFERENCES documents(doc_id),
  latest_bytes_sha256  TEXT,
  latest_storage_key   TEXT,
  first_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_changed_at      TIMESTAMPTZ,
  status               TEXT NOT NULL DEFAULT 'active',
  UNIQUE(source_adapter_id, item_key)
);

CREATE TABLE document_versions (
  version_id     TEXT PRIMARY KEY,
  source_item_id TEXT NOT NULL REFERENCES source_items(source_item_id),
  doc_id         TEXT NOT NULL REFERENCES documents(doc_id),
  bytes_sha256   TEXT NOT NULL,
  storage_key    TEXT NOT NULL,
  observed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_item_id, bytes_sha256)
);

CREATE TABLE source_change_events (
  event_id          TEXT PRIMARY KEY,
  event_type        TEXT NOT NULL, -- DOCUMENT_NEW|DOCUMENT_UNCHANGED|DOCUMENT_CHANGED
  source_adapter_id TEXT NOT NULL,
  source_item_id    TEXT REFERENCES source_items(source_item_id),
  doc_id            TEXT REFERENCES documents(doc_id),
  before            JSONB,
  after             JSONB,
  detected_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  caused_by         TEXT NOT NULL
);

CREATE TABLE fetch_runs (
  fetch_run_id      TEXT PRIMARY KEY,
  source_adapter_id TEXT NOT NULL,
  task_id           TEXT,
  url               TEXT NOT NULL,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ,
  status            TEXT NOT NULL,
  response_sha256   TEXT,
  storage_key       TEXT,
  error_message     TEXT,
  change_type       TEXT,
  attrs             JSONB NOT NULL DEFAULT '{}'::jsonb
);
```

这组表是 source monitoring / change detection 的底座。`source_health` 同步静态 registry；`source_policies` 保存外部可配置检查 cadence；`source_check_targets` 保存具体要检查的公司/源目标，例如 `sec-edgar:nvidia`；`source_items` 表示一个可重复观察的 URL/API item；`document_versions` 保存每次内容版本；`source_change_events` 记录新文档、未变化和内容变化事件；`fetch_runs` 记录抓取尝试本身。

### 10. unknown_items

```sql
CREATE TABLE unknown_items (
  unknown_id     TEXT PRIMARY KEY,                  -- UNK-uuid
  scope_kind     TEXT NOT NULL,                     -- company|component|topic
  scope_id       TEXT NOT NULL,
  question       TEXT NOT NULL,
  why_unknown    TEXT NOT NULL,
  blocking_data_sources TEXT[] DEFAULT '{}',
  proxies        TEXT[] DEFAULT '{}',
  status         TEXT NOT NULL DEFAULT 'open',
  created_by     TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at    TIMESTAMPTZ,
  resolved_evidence_ids TEXT[]
);

CREATE INDEX idx_unknown_items_scope ON unknown_items(scope_kind, scope_id);
CREATE INDEX idx_unknown_items_status ON unknown_items(status);
```

### 11. review_candidates

人工审核统一入口。所有不应自动入图的候选都用同一个 review 信封，不按数据源另建队列。

```sql
CREATE TABLE review_candidates (
  review_id         TEXT PRIMARY KEY,
  candidate_key     TEXT,
  kind              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  candidate         JSONB NOT NULL,
  doc_id            TEXT REFERENCES documents(doc_id),
  source_adapter_id TEXT NOT NULL,
  reviewer          TEXT,
  reviewed_at       TIMESTAMPTZ,
  decision_reason   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 12. extraction_rejections

硬校验失败的候选进入这里，不进入人工 review 队列。人工看过以后拒绝的候选留在 `review_candidates(status='rejected')`。

```sql
CREATE TABLE extraction_rejections (
  rejection_id    TEXT PRIMARY KEY,                -- REJ-uuid
  candidate       JSONB NOT NULL,                  -- 原始 CandidateRelation 或局部字段
  doc_id          TEXT REFERENCES documents(doc_id),
  chunk_id        TEXT REFERENCES document_chunks(chunk_id),
  stage           TEXT NOT NULL,                   -- validate|resolve|score
  reason_code     TEXT NOT NULL,                   -- missing_cite|invalid_kind|...
  reason_detail   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_extraction_rejections_doc ON extraction_rejections(doc_id);
CREATE INDEX idx_extraction_rejections_reason ON extraction_rejections(reason_code);
```

### 13. pending_entities

```sql
CREATE TABLE pending_entities (
  pending_id       TEXT PRIMARY KEY,                -- PND-uuid
  surface          TEXT NOT NULL,
  context          JSONB NOT NULL,
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  occurrence_count INT NOT NULL DEFAULT 1,
  status           TEXT NOT NULL DEFAULT 'pending', -- pending|merged|created|rejected
  resolved_entity_id TEXT REFERENCES entity_master(entity_id),
  reviewer         TEXT,
  reviewed_at      TIMESTAMPTZ
);
```

### 14. pgboss schema（Phase 3 目标）

`v0.1.0-alpha.1` 尚未引入后台队列。Phase 3 如果启动持续监控，再由 `pg-boss` 自带 schema（默认 `pgboss`）管理任务队列：

- `ingest`
- `parse`
- `extract`
- `apply`
- `housekeeping`

不要手写 `pgboss` 表，由库管理。

## 15. Claim / Observation / ChainView

Phase 3 的重点不是先接更多宏观源，而是先把公开供应链情报网的语义层落库。实际 DDL 位于 `packages/db/src/migration-sql/0006_claims_observations_chain_views.ts`，详细方案见 [../06-development/midterm-intelligence-network-plan.md](../06-development/midterm-intelligence-network-plan.md)。

已新增：

```text
claims
claim_evidence
claim_unknowns
observations
lead_observations
chain_views
chain_segments
```

约束：

- `claims` 只能引用 `edges` / `evidence` / `unknown_items` / `review_candidates`，不能自己成为新事实来源。
- `@supplystrata/claim-builder` 第一版只扫描 `current`、非 inferred、`evidence_level >= 4` 且有 `primary_evidence_id` 的事实边，并用确定性 `claim_id` 幂等 upsert；它不做抽取、不提高证据等级、不写 Neo4j。
- `status='draft'` 只用于已确认的语义变化草稿，例如 `semantic_change` review apply 生成的 `CLM-REVIEW-*`；draft 不进入 active claim 查询，也不能被前端画成事实边。
- `observations` 不能被 graph-builder 直接物化成 Neo4j fact edge。
- `@supplystrata/observation-store` 第一版只做幂等写入和输入边界校验；它不调用 graph-builder，不把 observation/lead 升级为边。
- `lead_observations` 必须进入 review 或研究队列，默认不进图谱。
- `chain_segments.semantic_layer` 必须保留 `edge / claim / observation / lead / unknown`，供 CLI、API 和研究工作台统一消费。
- `@supplystrata/chain-view` 第一版已经能把上游 fact edge、active claim、company/component observations、open leads 和 unknown items 组装成前端可消费的 `CompanyChainViewModel`；observation / lead / unknown 是 context segment，不带 `evidence_level`，不改事实边语义。
- `@supplystrata/workbench-export` 会把当前研究公司 scope 内 `status='draft'` 的 claim 作为 `draft_claims` 独立输出；draft claim 不进入 ChainView 主链路。

## Intelligence Context

`edge_strength_estimates` 与 `edge_freshness` 是事实边之外的分析上下文。它们回答“关系有多重要”和“多久没被重新验证”，但不改变事实边本身的证据等级。

```text
edge_strength_estimates
  strength_id
  identity_key
  edge_id
  strength_kind: share | spend_band | dependency | capacity | qualitative
  value / lower_bound / upper_bound
  unit
  evidence_id
  method
  valid_from / valid_to

edge_freshness
  edge_id
  last_verified_at
  decay_model
  age_days
  freshness_score
  computed_at
  source_evidence_id
```

约束：

- `identity_key` 是强度估计的业务唯一键，用来支持幂等写入；不要把 SQL 表达式索引细节泄漏到调用方。
- `strength_kind='share'` 必须有可追溯来源；没有 share 时宁可输出 unknown，也不能均分或猜测。
- `freshness_score` 只能进入 workbench / risk view / intelligence view，不能反向降低或提高 `evidence_level`。
- `@supplystrata/workbench-export` 把这部分导出为 `intelligence.edge_strengths / intelligence.edge_freshness`，前端和宿主 app 应把它当作上下文，而不是新事实边。

## Neo4j 模型

### 节点 labels

```
(:Entity {entity_id, kind, canonical_name, display_name, primary_country, status})
(:Company)            <- 通过 :Entity:Company 双 label 实现 Kind 区分
(:BusinessUnit)
(:Facility)
(:Product)
(:Component)
(:Port)
(:Vessel)
(:GovernmentAgency)
```

`entity_id` 必须有 UNIQUE constraint。

### 关系 types

直接使用 `RelationType` 字符串（大写下划线）：

```
[:BUYS_FROM { edge_id, component, evidence_level, confidence, is_inferred, validity }]
[:USES_FOUNDRY { edge_id, ... }]
[:OWNS_SUBSIDIARY { edge_id, ... }]
[:MANUFACTURES_AT { edge_id, ... }]
...
```

关系属性只放查询常用字段。完整属性 / evidence 永远去 Postgres 拉。

### 索引 / 约束

```
CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (n:Entity) REQUIRE n.entity_id IS UNIQUE;
CREATE INDEX entity_kind IF NOT EXISTS FOR (n:Entity) ON (n.kind);
CREATE INDEX edge_id IF NOT EXISTS FOR ()-[r]-() ON (r.edge_id);
CREATE INDEX edge_validity IF NOT EXISTS FOR ()-[r]-() ON (r.validity);
```

### 物化视图重建

```
supplystrata graph rebuild
```

伪代码：

```
1. 清空 Neo4j: MATCH (n) DETACH DELETE n;
2. 从 entity_master 读所有 active entities → CREATE 节点
3. 从 edges 读所有 validity='current' → MERGE 关系
4. 完成后输出 stats
```

要求：rebuild 是幂等的、可中断重跑的。

## 对象存储 layout

```
data/raw/<source_adapter_id>/<entity_id_or_unknown>/<year>/<month>/<sha256>.<ext>
```

例：

```
data/raw/sec-edgar/ENT-NVIDIA/2025/02/3a7f...c1d8.html
data/raw/apple-suppliers/ENT-APPLE/2024/02/a2bf...09cc.pdf
```

存储字段：

- `storage_key` 是相对路径（不含 base URL / bucket）
- `bytes_sha256` 是文件内容的 hex 摘要

## 迁移管理

- drizzle-kit 生成 SQL migration
- 文件命名：`<n>_<purpose>.sql`，`n` 严格递增
- 每个 PR 修 schema 必须包含 migration + 回滚脚本（.down.sql）
- 不允许在已发布的 migration 上改字段；要改开新 migration

## 关于"删除"

本系统几乎不允许物理删除：

| 数据              | 删除策略                                          |
| ----------------- | ------------------------------------------------- |
| evidence          | 不允许删；只能 supersede                          |
| edges             | 不允许删；只能 deprecate                          |
| documents         | 不允许删；只能 mark `parse_status="skipped"`      |
| entity_master     | 不允许删；只能 status="merged_into" 或 deprecated |
| chunk_entities    | 可重建                                            |
| review_candidates | rejected 后仍保留（作为 negative sample）         |
| change_records    | 永不删                                            |

例外：

- 误录入的 raw bytes 可以删（只在合规要求时）
- pending_entities 可在 reviewed 后归档但不立即删
