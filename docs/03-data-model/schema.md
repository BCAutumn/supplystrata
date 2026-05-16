# Schema — 数据库 Schema

两个存储：

- **PostgreSQL**：所有元数据、证据、文档、实体、别名、变更、队列。是事件源 / 真相存储。
- **Neo4j**：图谱当前状态的物化视图。可以从 Postgres 全量重建。

下面给出 Phase 0-2 必须存在的表 / 节点 / 关系。MVP 当前的实际 DDL 位于 `packages/db/src/schema.ts`；后续引入正式 migrations 时，必须从该文件迁移到版本化 migration 文件，不能在多个地方维护两份 DDL。

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
```

### 7. edges

```sql
CREATE TABLE edges (
  edge_id            TEXT PRIMARY KEY,              -- EDGE-uuid
  subject_id         TEXT NOT NULL REFERENCES entity_master(entity_id),
  object_id          TEXT NOT NULL REFERENCES entity_master(entity_id),
  relation           TEXT NOT NULL,
  component          TEXT,                          -- nullable
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
CREATE UNIQUE INDEX uniq_edges_identity ON edges (
  subject_id,
  object_id,
  relation,
  COALESCE(component, ''),
  COALESCE(effective_from, DATE '1900-01-01'),
  COALESCE(effective_to, DATE '2999-12-31')
);
```

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

### 9. unknown_items

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

### 10. extraction_review_queue

```sql
CREATE TABLE extraction_review_queue (
  review_id        TEXT PRIMARY KEY,                -- REV-uuid
  candidate        JSONB NOT NULL,                   -- 完整 CandidateRelation
  scoring          JSONB NOT NULL,                   -- ScoringResult
  doc_id           TEXT NOT NULL REFERENCES documents(doc_id),
  chunk_id         TEXT REFERENCES document_chunks(chunk_id),
  status           TEXT NOT NULL DEFAULT 'pending',  -- pending|approved|rejected|fixed
  reviewer         TEXT,
  reviewed_at      TIMESTAMPTZ,
  decision_reason  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_review_queue_status ON extraction_review_queue(status);
```

### 11. extraction_rejections

硬校验失败的候选进入这里，不进入人工 review 队列。人工看过以后拒绝的候选仍留在 `extraction_review_queue(status='rejected')`。

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

### 12. pending_entities

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

### 13. pgboss schema

`pg-boss` 自带 schema（默认 `pgboss`）。任务队列：

- `ingest`
- `parse`
- `extract`
- `apply`
- `housekeeping`

不要手写 `pgboss` 表，由库管理。

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

| 数据                | 删除策略                                  |
| ----------------- | ------------------------------------- |
| evidence          | 不允许删；只能 supersede                     |
| edges             | 不允许删；只能 deprecate                     |
| documents         | 不允许删；只能 mark `parse_status="skipped"` |
| entity_master     | 不允许删；只能 status="merged_into" 或 deprecated |
| chunk_entities    | 可重建                                   |
| extraction_review_queue | rejected 后仍保留（作为 negative sample）   |
| change_records    | 永不删                                   |

例外：

- 误录入的 raw bytes 可以删（只在合规要求时）
- pending_entities 可在 reviewed 后归档但不立即删
