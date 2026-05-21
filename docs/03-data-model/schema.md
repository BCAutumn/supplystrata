# Schema — 数据库 Schema

两个存储：

- **PostgreSQL**：所有元数据、证据、文档、实体、别名、变更、队列。是事件源 / 真相存储。
- **Neo4j**：图谱当前状态的物化视图。可以从 Postgres 全量重建。

下面记录当前核心表 / 节点 / 关系的文档化视图。实际 DDL 位于 `packages/db/src/migration-sql/*.ts`，并由 `packages/db/src/migrations.ts` 按版本顺序执行。不要再维护单个大 `schema.ts`，新增表或列必须进入新的 migration 文件。

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

`component` 暂时保留，目的是兼容旧 evidence 和 CLI 输出；新写入链应优先填 `component_id`。事实边废弃必须走受控 soft-delete：只能把 current edge 改成 `validity='deprecated'`，不能删除 edge/evidence/claim；调用方必须提供至少一个可验证 source ref（`evidence`、`review`、`claim`、`unknown` 或 `semantic_change`），并写入 `EDGE_DEPRECATED` change record。claim conflict 的 `recommend-edge-deprecation` 只是人工建议，不能直接授权事实层变更。

`component_specificity` 表示这条边的组件粒度来自什么证据：

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

`changes timeline` 是 `change_records` / `source_change_events` 的读取层，不是单独事实表。它会把下列 JSON payload 解析成结构化 DTO 字段，供 CLI、Workbench、attention queue 和 research-pack 使用：

- `evidence_superseded` 规范化为 `EVIDENCE_SUPERSEDED`，并导出 `superseded_evidence_ids`、`superseded_by_evidence_id`、`edge_id`、`evidence_id`。
- 官方披露 relation semantic diff 会导出 `semantic_relation_kind`、`relation_subject_surface`、`relation_object_surface`、`relation`、`component`、`relation_fingerprint`、`previous_doc_id` / `next_doc_id`。
- 这些字段只是审计/监控上下文；relation diff 仍然是披露变化提醒，不自动写 fact edge。

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
  max_attempts          INT NOT NULL DEFAULT 3,
  backoff_base_minutes  INT NOT NULL DEFAULT 1,
  backoff_max_minutes   INT NOT NULL DEFAULT 60,
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
  check_cadence_minutes INT,
  jitter_minutes        INT,
  max_attempts          INT,
  backoff_base_minutes  INT,
  backoff_max_minutes   INT,
  target_config     JSONB NOT NULL DEFAULT '{}'::jsonb,
  config_source     TEXT NOT NULL DEFAULT 'default',
  notes             TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE source_check_jobs (
  job_id            TEXT PRIMARY KEY,
  check_target_id   TEXT NOT NULL REFERENCES source_check_targets(check_target_id),
  source_adapter_id TEXT NOT NULL,
  target_kind       TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending', -- pending|in_progress|failed|succeeded|dead
  attempts          INT NOT NULL DEFAULT 0,
  max_attempts      INT NOT NULL DEFAULT 3,
  backoff_base_minutes INT NOT NULL DEFAULT 1,
  backoff_max_minutes  INT NOT NULL DEFAULT 60,
  last_error        TEXT,
  next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
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
  check_target_id   TEXT, -- source_check_targets.check_target_id or manual source-check id
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

这组表是 source monitoring / change detection 的底座。`source_health` 同步静态 registry；`source_policies` 保存外部可配置的 source 级默认 cadence、jitter、priority、retry/backoff 和初始 `next_check_at`；`source_check_targets` 保存具体要检查的公司/源目标，例如 `sec-edgar:nvidia`，并可覆盖 cadence、jitter、retry/backoff 和初始检查时间；`source_check_jobs` 是到期目标的 durable worker job/outbox，使用 `pending / in_progress / failed / succeeded / dead` 状态、`FOR UPDATE SKIP LOCKED` 领取和配置化退避重试；`source_items` 表示一个可重复观察的 URL/API item；`document_versions` 保存每次内容版本；`source_change_events` 记录新文档、未变化和内容变化事件，并通过 `check_target_id` 回链到触发它的具体 monitor target；`fetch_runs` 记录抓取尝试本身。当前已接通的官方披露 target 包括 `sec-edgar/sec-company-filings`、官方 IR 的 `official-html-disclosure`（显式 company-ir URL、TSMC / Samsung / SK hynix / Micron / ASML）、Apple Supplier List 的 `supplier-list-review`、OpenDART 的 `dart-kr/company-filings`、日本 EDINET 的 `edinet/daily-filings`，以及台湾 MOPS 的 `twse-mops/electronic-documents`。其中 DART / EDINET / TWSE 现阶段只持久化披露目录元数据和 source monitor 事件，用来建立官方覆盖账本，不自动把目录项升级成事实边；`company-ir` 只接受显式 URL，不负责发现任意公司 IR 页面。

外部配置统一走 `source policy config` JSON：

- `policies[]`：按 `source_adapter_id` 配置 source 级默认 `check_cadence_minutes / jitter_minutes / priority / next_check_at / max_attempts / backoff_base_minutes / backoff_max_minutes`。
- `check_targets[]`：配置具体 target 的 connector、subject、`target_config`，并可覆盖同一组 monitoring 参数。
- 运行时调度优先使用 target 覆盖值，缺失时回落到 source policy；调用方不能在 enqueue 阶段绕过配置传入重试参数。

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

当前 `kind` 包括 `supplier_list_row`、`entity_source_candidate`、`semantic_change`、`osh_facility_candidate` 和 `claim_conflict_review`。`claim_conflict_review` 来自 `conflict_review` safe-write packet：它必须保留 `safe_write_status='blocked_pending_review'` 和 `fact_write_policy.automatic_fact_mutation_allowed=false`，只表示“该 claim 需要人工处理”，不能作为自动 deprecate edge 或自动改 claim status 的授权。approved 后执行 `review apply` 只会写 `CLAIM_CONFLICT_REVIEW_APPLIED` 和 `REVIEW_APPLIED` 审计事件；事实边、claim status、unknown status 仍保持原样。更细的人工 resolution action 通过 `CLAIM_CONFLICT_RESOLUTION_ACTION_RECORDED` 写入 `change_records`：`confirm_claim_valid` 会在 resolution evidence 存在时关闭 linked unknown，`recommend_edge_deprecation` 只记录建议，`request_more_evidence` 只记录继续调查要求；这些 action 仍不修改 `edges` 或 claim status。

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

### 14. Source check jobs

项目没有引入 `pg-boss`。持续 source monitor 使用项目自有的 Postgres-backed job/outbox 表，实际 DDL 位于：

```text
packages/db/src/migration-sql/0016_source_check_jobs.ts
packages/db/src/migration-sql/0017_source_monitoring_controls.ts
```

核心表：

```text
source_check_jobs
```

它支持 pending / in_progress / succeeded / failed / dead 状态、attempts、next_attempt_at、last_error 和 target-level retry/backoff。`apps/worker` 只负责循环和 signal 退出，具体 enqueue / claim / retry / connector dispatch 仍在 `source-workflows` / `source-monitor` 内。

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
- `claim_evidence.role` 记录 claim 与 evidence 的关系：`primary` / `supporting` / `contradicting` / `context`。反证只能让 claim 进入冲突边界，不能自动删除或改写事实边。
- `claim_unknowns.role` 记录 claim 与 unknown 的关系：`boundary` / `blocking` / `context`。`CONFLICTING_EVIDENCE` 类 unknown 必须通过这里挂到 claim，不能只散落在 Markdown 说明里。
- `status='draft'` 只用于已确认的语义变化草稿，例如 `semantic_change` review apply 生成的 `CLM-REVIEW-*`；draft 不进入 active claim 查询，也不能被前端画成事实边。
- `observations` 不能被 graph-builder 直接物化成 Neo4j fact edge。
- `@supplystrata/observation-store` 第一版只做幂等写入和输入边界校验；它不调用 graph-builder，不把 observation/lead 升级为边。
- `FINANCIAL_METRIC_OBSERVATION` 来自 SEC companyfacts 结构化 JSON，保存 company-scoped 财报指标时序；同一 metric/unit 可以用上一期写入 `baseline_value / change_value / change_percent`，provenance 必须记录 `accession / form / filed / taxonomy / xbrl_tag / source_url`，并且不得由此直接生成供应链事实边。
- `TRADE_FLOW_OBSERVATION` / `COMMODITY_PRICE_OBSERVATION` / 官方披露语义 observation / `FACILITY_PROFILE_OBSERVATION` 同样只能作为可复现 signal；即使它们关联 component、country、material、facility 或公司 scope，也不能单独证明公司间供应关系。
- ComponentCard 的 `linked_company_observations` 是读取层 DTO，不是新表：它通过当前组件已有 Level 4/5 fact edges 找到 supplier/consumer 公司，再读取这些公司的 company-scoped `FINANCIAL_METRIC_OBSERVATION`。这个关联只用于研究上下文展示，不会把财务 observation 升级成供应关系。
- `lead_observations` 必须进入 review 或研究队列，默认不进图谱。
- `chain_segments.semantic_layer` 必须保留 `edge / claim / observation / lead / unknown`，供 CLI、API 和研究工作台统一消费。
- `@supplystrata/chain-view` 第一版已经能把上游 fact edge、active claim、company/component observations、open leads 和 unknown items 组装成前端可消费的 `CompanyChainViewModel`；observation / lead / unknown 是 context segment，不带 `evidence_level`，不改事实边语义。
- `@supplystrata/workbench-export` 会把当前研究公司 scope 内 `status='draft'` 的 claim 作为 `draft_claims` 独立输出；draft claim 不进入 ChainView 主链路。Workbench claim DTO 同时导出 `evidence_refs`、`unknown_refs`、派生 `conflict_state`、`conflict_adjudication` 和 `conflict_review`，用于让研究包和未来 AI 读取结构化支持/反证/未知边界。`conflict_adjudication.allowed_edge_mutation` 当前固定为 `none`；`conflict_review.fact_write_policy.automatic_fact_mutation_allowed` 当前固定为 `false`，表示冲突只能建议 review，不能授权自动改 facts。`claims enqueue-conflicts` 会把 unresolved conflict 幂等写入 `review_candidates(kind='claim_conflict_review')`，但导出 `conflict_review` 本身仍是只读上下文，不会自动入队。
- Workbench claim DTO 还会导出 `edge_validity`、`edge_deprecated_reason`、`edge_superseded_by_edge_id` 和 `lifecycle_warnings`。如果 active claim 仍挂在 `deprecated` 或 `historical` edge 上，Workbench / research-pack 必须显示 `active_claim_on_inactive_edge` warning；这只是可见性与维护提醒，不会自动 supersede / reject claim。
- claim lifecycle 维护动作通过 `CLAIM_LIFECYCLE_ACTION_RECORDED` 进入 `change_records`。`supersede_claim` / `reject_claim` 只更新 `claims.status`，`keep_with_context` 不更新 status；三者都必须带可验证 source ref，并保留 reason、edge lifecycle context 和 reviewer。该流程不修改 `edges`，也不删除 claim/evidence 历史。

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
- `@supplystrata/evidence-maintenance` 提供 `refreshEdgeIntelligenceContext()` 后端编排：扫描 `current`、非 inferred、Level 4/5 且有 `primary_evidence_id` 的事实边，刷新 `edge_freshness`；只从 primary evidence 的命名、明确文本中确定性写入 `share / dependency / capacity / qualitative` strength；没有明确强度时写入 edge-scoped explicit unknown。
- 该 refresh 不写 `edges`，不改变 `evidence_level`，不把 observation / lead 升级为事实边；它只写 intelligence context 和 unknown map。

## Risk Views

`risk_views` 与 `risk_metrics` 是 risk / intelligence 派生层。它们消费事实边、strength、freshness、observation 等可追溯输入，输出可复算指标；它们不是事实边，也不能反写 `edges`。

```text
risk_views
  risk_view_id
  scope_kind
  scope_id
  generated_at
  model_version
  inputs_fingerprint
  summary
  attrs

risk_metrics
  metric_id
  risk_view_id
  metric_kind: supplier_concentration_hhi | single_source_exposure | path_redundancy | node_knockout_reach | node_knockout_weighted_impact | betweenness_centrality | freshness_adjusted_exposure | observation_anomaly | financial_metric_peer_zscore
  subject_kind
  subject_id
  component_id
  value
  confidence
  provenance
  attrs
```

当前第一版由 `@supplystrata/evidence-maintenance` 的 `refreshComponentRiskView()` 生成 component-scoped baseline：

- 调用方在批量刷新前应先按同一事实边条件筛选 eligible component：`validity='current'`、`evidence_level>=4`、`is_inferred=false`、有 `component_id`，且 relation 属于 `BUYS_FROM / SUPPLIES_TO / USES_FOUNDRY / MANUFACTURES_AT`。research-pack 使用 `listRefreshableComponentRiskComponentIds()` 做这一步，避免给无事实边组件写空 risk view。
- `supplier_concentration_hhi` 只有在相关供应边都有明确 `share` strength 和 freshness 时才写 `value`；计算时 share 会先乘 `freshness_score`，缺 share 或 freshness 时 `value=NULL`，并在 `attrs.share_unknown / attrs.freshness_missing / attrs.missing_share_edge_ids / attrs.missing_freshness_edge_ids` 中显式暴露缺口。`attrs.raw_hhi` 保留未做 freshness 调整的 HHI 供审计。
- `single_source_exposure` 只来自事实边 topology（仅一个供应商）或明确 `dependency=single_source` strength。
- `path_redundancy` 当前是 component fact-edge 图 baseline：按 supplier -> consumer 方向寻找 source supplier 到 terminal consumer 的 simple upstream paths，`value = Σ max(path_count_by_terminal - 1, 0)`，并在 attrs 里标明 `redundancy_scope='terminal_consumer_simple_paths'`。attrs 保留 `direct_supplier_count / direct_alternate_supplier_count / terminal_path_redundancy`，用于审计直接 supplier 数与真实替代路径数的差异；同向重复 route edge 会先折叠，避免重复证据变成假冗余。若路径完整带有 strength/freshness，attrs 还会输出 `weighted_alternate_path_score / weighted_terminal_path_redundancy`；任一路径缺权重时正式加权分数保持 `null`，缺口进入 `weighted_missing_edge_ids`。
- `node_knockout_reach` 当前是有向 component fact-edge 图 reachability baseline：按 supplier -> consumer 方向输出该节点失效会影响多少个下游实体。
- `node_knockout_weighted_impact` 当前是 strength/freshness 加权传播 baseline：边权重为可追溯 `strength_weight * freshness_score`，每个下游实体取当前已知最强路径，`value` 为这些实体 impact 求和；缺 strength 或 freshness 的边写入 `attrs.missing_weight_edge_ids`，不补值、不均分。
- `betweenness_centrality` 当前是有向 component fact-edge 图 baseline：按 supplier -> consumer 方向计算 unweighted shortest-path betweenness，只输出 raw score > 0 的瓶颈节点；attrs 同时输出 `weighted_path_centrality_score / weighted_path_centrality_raw_score / weighted_contributing_path_edge_ids`，用 strength/freshness path product 标出高权重路径瓶颈。缺权重边只进入 `weighted_missing_weight_edge_ids`。
- `freshness_adjusted_exposure` 以可追溯 strength weight 乘以 `freshness_score`；缺 strength 或 freshness 时不伪造数值，而是在 attrs 中标出 `strength_unknown` / `freshness_missing`。
- 每次生成必须写 `model_version` 和 `inputs_fingerprint`，同一输入应得到稳定 risk view / metric id。
- 新版 component risk view 会与上一版派生指标按稳定 metric key 对比；实质变化写入 `change_records.change_type='RISK_METRIC_CHANGED'`，并在 `before / after` 中记录 risk view id、指标值、方向、severity 和触发阈值。
- risk change 是派生层事件，`scope_kind='risk_metric'`；它不能反写 `edges`，也不能作为事实关系证据。

### Research Pack Readiness / Investigation Outputs

`@supplystrata/research-pack` 会导出只读研究辅助产物：

- `question-readiness.json/md`：根据当前 pack 中的 fact edge、evidence、observation、risk metric、source plan 和 unknown map，判断核心问题是 `ready / partial / blocked`。
- `investigation-backlog.json/md`：把 readiness gap、explicit unknown、组件覆盖缺口和 source-plan item 转成下一步调查任务。
- `source-target-coverage.json/md`：把 runnable source-plan target 与 `source_check_targets / source_check_jobs / source_change_events / observations` 对齐，展示数据准备链路的 sync、enable、due、job、event、degraded 和 observation 状态。
- `source-target-preflight.json/md`：可选；打包显式传入的无数据库 source-plan smoke 结果，展示 `plan / fetch / normalize` 连通性、失败和 degraded fallback，并按 source 输出 checked/failed/skipped、normalized/degraded、target kind 和 issue kind 分布矩阵。issue kind 当前包括 `missing_credentials`、`target_config_invalid`、`connector_unsupported`、`source_unreachable`、`source_response_error` 和 `adapter_error`。当 issue kind 是 `missing_credentials` 且 connector capability 提供了 credential contract 时，item 会携带结构化 `missing_credentials[]` env key，而不是只把 key 藏在错误字符串里。它不是事实覆盖，也不代表 target 已同步；如果同时传入 `investigation-backlog`，backlog 会把 failed/skipped/degraded preflight 作为同步前行动前置条件。
- `observation-coverage.json/md`：汇总本研究包中 typed observations 的 type、source adapter、scope、component、geography、metric、样本 id、series readiness 和缺失 methodology type。
- `official-disclosure-readiness.json/md`：汇总 Gate 1 相关的研究 target profile、逐节点覆盖矩阵、显式 target node 覆盖、逐 expected source 覆盖矩阵、profile expansion candidates、Level 4/5 fact edge 数、完整 traceability、严格 cross-source corroboration、strength/freshness 覆盖、explicit unknown，以及官方披露 source-plan target 的 sync / enable / due / degraded / observation 状态。

这些产物不对应事实表，不写 `edges`，也不改变 `risk_views / observations / unknown_items`。它们的作用是让人工或后续安全 agent 知道下一步该查什么、为什么查、关联哪些 source / unknown / component / edge，以及已经同步/运行/失败/退化在哪里。`investigation-backlog` 会消费 coverage 状态，把 action 从笼统的“去跑 source”细化为“先同步 target / 启用 target / 跑 due target / 等待 active job / 排查 failed/degraded job / review observation”；如果显式传入 source target preflight，backlog 会在同一 coverage 行展示 `preflight` 状态，并把 failed/skipped/degraded preflight 放在“同步/启用”之前处理。它也会消费 `observation-coverage`，把 sparse observation series 转成继续积累同序列窗口点或寻找 explicit baseline 的调查任务；还会消费 `official-disclosure-readiness`，把核心节点覆盖、Level 4/5 边覆盖、expected source 缺口、traceability、corroboration、profile expansion candidates 和 intelligence context gap 变成调查任务，并优先引用已有 runnable official disclosure targets。逐节点覆盖状态只用于计划：`covered_fact` 表示节点已有 Level 4/5 fact edge，`official_target_synced` / `official_target_runnable` 表示已有与该节点相关的可执行官方源路径，不能把同一个聚合 source-plan item 中其它节点的 target 借给当前节点；`official_source_planned` 表示还停在计划层，`missing` 表示当前 pack 没有官方披露覆盖入口。逐 expected source 覆盖状态更细：`connector_available` 表示后端已有该官方源 connector 但当前 profile 节点还没有具体 source-plan/target，`source_registered_unimplemented` 表示来源已在 registry 但还没有可运行 connector 或人工 review workflow，`missing_source_mapping` 表示 profile 期待的来源还没有映射到 source registry。research-pack 内置 `ai-compute-memory.v0` 目标 profile；当选中公司或组件落在该 profile 范围内时会自动使用它，无需用户手写清单，也可通过 CLI/host app 显式设为 `none`。profile 是验收锚点，不是全球供应链全集；其中 manufacturing-services 的 Apple Supplier List FY2022 target 是 review-only 官方名单入口，只把 PDF 行转成 review candidate、facility lead 和 OSH 交叉检查 target，人工确认前不能写事实边；silicon wafer / ABF substrate 的 EDINET target 是日本官方披露目录监控入口，只抓 daily filings metadata，不下载或解析正文；Foxconn / Quanta 的 TWSE MOPS target 是台湾官方披露电子文件目录监控入口，只抓目录 metadata，不下载 PDF 或写事实边。不在 profile 中但已被 fact edge、official source plan 或 runnable target 发现的节点会进入 `profile_expansion_candidates` 和 `profile_expansion` backlog，等待人工或后续安全 AI 审阅是否纳入 profile。调用方也可以向 `official-disclosure-readiness` 传入显式 target node set；传入后 Gate 1 的 core node 口径按这批目标节点的覆盖数衡量，未出现在当前 Workbench 里的核心节点也会以 `missing` 出现在矩阵中。未传 target node set 且未命中内置 profile 时，报告只能作为当前 pack 可见节点仪表盘，不能声明 25 个核心研究节点已经达标。`observation-coverage` 只能从结构化 DTO 汇总类型覆盖和 series readiness，不能靠 Markdown label 猜 observation type；`official-disclosure-readiness` 只能从 Workbench edge/evidence/intelligence/source-plan/source-target-coverage DTO 计算，不能把单源沉默自动解释成已审计 single-source。正式系统需要持久化时，应另建 agent/review 层契约，不能把 backlog item、preflight item 或 coverage item 当成事实证据。

`source-plan` 只有在调用方显式提供足够参数时才生成 runnable target：例如 `tradeObservationMonth` 生成 Census Trade target，`commodityObservationMonth` 生成 World Bank commodity target，target profile 中带 SEC CIK 的公司生成 `sec-edgar/sec-company-filings` target，`officialDisclosureYear` 生成 TSMC / Samsung / SK hynix / Micron / ASML 的 node-specific `official-html-disclosure` target；`company-ir` 还必须在 target profile/review 配置中带显式 HTTPS `url`。SEC CIK 这类显式 target config 不需要披露年份；官方 IR 这类按年度页面抓取的 source 必须有年份；`company-ir` 的长尾入口必须有 URL。缺少时间参数、CIK、URL、target config 或 connector 时保持 gap，不能猜默认 period，也不能把 registry 里登记过的来源伪装成可运行监控。`source-management` 会把 runnable suggestions 转换为 `source_check_targets`：`check_target_id` 由 namespace、source、target kind 和 target_config 稳定生成，默认 `enabled=false`。source-check connector capability 是 target 配置和 credential requirement 的统一契约；catalog、无数据库预览和无数据库 smoke 都读取同一份 `config_schema / credential_requirements`，不能在 CLI 或 research-pack 里维护另一套 env key 清单。无数据库预览会复用同一转换和 validation，输出 target id、去重统计、source / target kind / priority 汇总和 credentials warning，方便同步前审计。无数据库 smoke 会复用同一批 target config 解析和 adapter，执行 `plan / fetch / normalize` 并输出 source 连通性、degraded fallback 和 normalize 结果；需要凭据的 target 会在访问外部源前按统一 credential contract 归类缺口。它不写任何表，也不把成功抓取解释成事实覆盖。审计后可用同一 `source-plan.json + namespace` 受控启用已同步 target，并写入 target 级 cadence、jitter、retry 和 `next_check_at` 覆盖值；启用后才由 `sources due/run-due` 或 worker 执行。该转换、预览、smoke 和启用流程都不写事实边，只把研究计划接到统一监控配置层。

同一 package 也提供 `refreshObservationAnomalyViews()` 生成 observation-scoped baseline：

- 输入优先使用已有 `baseline_value`，且有 `change_percent` 或可由 `metric_value / baseline_value` 复算变化率的 observation。
- 没有显式 baseline 时，会查询同一 `observation_type / scope / geography / component / metric / unit` 的历史 observation，用 trailing median/MAD 生成 baseline、MAD 和 z-like score。
- `metric_kind='observation_anomaly'`，`subject_kind='observation'`，`subject_id=observation_id`。
- 显式 baseline 路径的 `value` 保存绝对变化百分比；历史窗口路径的 `value` 保存绝对 z-like score。`attrs.is_anomaly / severity / direction / baseline_method / threshold_percent / z_threshold / change_percent / z_like_score / baseline_observation_ids` 保存可解释上下文。
- 没有 baseline 且历史点不足时，不写 anomaly view；不能用空历史补造趋势。
- `is_anomaly=true` 时可写入 `change_records.change_type='OBSERVATION_ANOMALY'`，用于 timeline / alert rules；该事件以 `scope_kind='observation'` 引用原 observation，并在 `after.risk_view_id` 里指向派生视图。`after` 还应包含 `observation_scope_kind / observation_scope_id / metric_name / metric_value / metric_unit / baseline_method / baseline_value / change_percent / severity / direction`，让 changes timeline 能在 company/component scope 下展示可审计的指标拐点。
- 该 view 仍是派生层，不写 `edges`，不改变 observation 本身，也不能作为 fact edge 证据。

同一 package 也提供 `refreshFinancialMetricPeerComparisonViews()` 生成财务同行横向比较：

- 输入只读取 `observation_type='FINANCIAL_METRIC_OBSERVATION'` 且 `scope_kind='company'` 的 observation。
- peer group 的业务键优先使用 `metric_name / metric_unit / fiscal_year / fiscal_period`；缺 fiscal period 时使用 `metric_name / metric_unit / time_window_start / time_window_end`。不完全一致的期间或单位不能混合比较。
- 默认至少 3 家公司才写 risk view；样本不足保持普通 observation，不补造行业均值。
- `metric_kind='financial_metric_peer_zscore'`，`subject_kind='company'`，`subject_id=company entity id`。
- `value` 保存 signed z-score；`attrs.percentile / rank_descending / peer_count / mean / standard_deviation / peer_company_ids / metric_value` 保存同行位置上下文。
- CompanyCard DTO 的 `financial_peer_metrics` 是读取层字段，不是新表；research-pack 的 `company.json/company.md` 会自然带出这些同行位置指标。
- 该 view 只说明同期间 peer position，不是风险分，不写 `edges`，不推断供应商/客户关系。

## Alert Candidates

`alert_candidates` 是持续监控层的候选告警表。它不是事实层，也不是通知系统；它只把已有 source event、semantic change、risk metric 变成可去重、可审核、可展示的 alert candidate。

```text
alert_candidates
  alert_id
  alert_kind: observation_anomaly | source_failure | component_risk
  severity: low | medium | high | critical
  status: open | acknowledged | resolved | suppressed
  scope_kind / scope_id
  title / summary
  dedupe_key
  observation_id
  risk_view_id
  risk_metric_id
  change_id
  source_event_id
  source_adapter_id
  detected_at
  provenance
  attrs
```

第一版由 `refreshAlertCandidates()` 生成：

- `observation_anomaly` 来自 `change_records.change_type='OBSERVATION_ANOMALY'`，必须引用 observation 和 risk view。
- `source_failure` 来自 `source_change_events.event_type='SOURCE_FAILED'`，必须引用 source event 和 source adapter。
- `component_risk` 来自 `risk_metrics` 中的 `single_source_exposure`、高 HHI 或 node knockout baseline，必须引用 risk view / metric。
- `dedupe_key` 是业务幂等键；重复 refresh 只能更新同一 alert candidate，不能刷出重复告警。
- `status` 是 alert 自身的维护状态；`open / acknowledged / resolved / suppressed` 的变更必须通过 alert lifecycle repository 写入，并记录 `change_records.change_type='ALERT_STATUS_CHANGED'`。
- `ALERT_STATUS_CHANGED` 使用 `scope_kind='alert'` / `scope_id=alert_id`，用于 changes timeline 审计“谁在什么原因下处理了这个告警”。
- alert candidate 不写 `edges`，不改变 `evidence_level`，不自动 approve review，也不等同于正式通知。

## Workbench Attention Queue

`attention_queue` 是 `WorkbenchModel` / research-pack 的只读派生队列，不是新事实表。它把多个后端维护信号统一成一个研究员可消费入口：

- `claim_conflict`：来自 claim conflict adjudication / `conflict_review`，提醒先审阅支持证据、反证证据和 linked unknown。
- `claim_lifecycle`：来自 active claim 仍挂在 deprecated / historical edge 上的 lifecycle warning。
- `alert`：来自 `alert_candidates`，保留 alert 自身的 `open / acknowledged / resolved / suppressed` 状态。
- `source_degraded`：来自 source monitor health，提醒源退化会影响 freshness、缺失数据和研究结论。
- `change_requires_attention`：来自 changes timeline 中 `requires_attention=true` 的 semantic / source / risk change。

```text
attention_queue
  attention_id
  kind
  priority: P0 | P1 | P2 | P3
  status: open | acknowledged | resolved | suppressed
  title / summary / action
  scope_kind / scope_id
  refs[]
  detected_at
```

约束：

- `attention_queue` 只消费已有 claim、alert、source health 和 change records；它不写 `edges`，不修改 claim status，也不 resolve unknown。
- 这是即时处理队列；`investigation-backlog` 仍负责更长期的数据缺口、coverage gap 和 source-plan 下一步任务。
- research-pack 会输出 `attention-queue.json/md`，同时在 manifest 里统计 `attention_items`。

## Edge Calibration

`edge_calibration_labels` / `edge_calibration_runs` / `edge_calibration_run_items` 是事实边精度校准层。它们消费人工 review gold labels，评估 Level 4/5 fact edge 的预测 confidence 与实际正确率是否匹配；它们不写事实边，也不能自动修改 `evidence_level`。

```text
edge_calibration_labels
  label_id
  edge_id
  evidence_id
  label: correct | incorrect | uncertain
  error_category: extraction_error | entity_resolution_error | source_error | staleness_error | semantic_misread | other
  reviewer
  reviewed_at
  rationale
  attrs

edge_calibration_runs
  run_id
  generated_at
  model_version
  inputs_fingerprint
  min_evidence_level
  sample_size
  evaluated_count
  correct_count
  incorrect_count
  uncertain_count
  precision
  reliability_buckets
  error_summary
  attrs

edge_calibration_run_items
  run_id
  label_id
  edge_id
  evidence_id
  evidence_level
  predicted_confidence
  confidence_bucket
  label
  error_category
```

当前第一版由 `recordEdgeCalibrationLabel()` 和 `refreshEdgeCalibrationRun()` 提供：

- `incorrect` label 必须有 `error_category`；`correct / uncertain` 不能带错误类型，避免把不确定样本误当作负样本。
- `precision = correct / (correct + incorrect)`；`uncertain` 进入样本量和 bucket，但不进入 precision 分母。
- `reliability_buckets` 按 edge confidence 的 0.1 桶聚合，记录每桶样本数、经验正确率和平均 confidence。
- `error_summary` 只统计 incorrect 样本，用于区分抽取错误、实体消歧错误、来源错误、过期错误和语义误判。
- calibration run 有 `model_version` 和 `inputs_fingerprint`，同一 gold label 输入应得到稳定 `run_id`。
- 校准结果只能用于方法学评估、阈值调整和后续人工治理；不得自动 rewrite fact edge。

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
