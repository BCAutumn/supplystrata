# Midterm Intelligence Network Plan — 公开供应链情报网中期骨架

本文把 SupplyStrata 从“证据图谱 alpha”升级到“公开供应链情报网”的中期目标拆成可执行工程路线。

核心判断：

```text
下一阶段的重点不是更多 adapter，也不是 LLM 自动化。
下一阶段要先建立事实边、claim、observation、lead、unknown、change、ChainView 之间的稳定契约。
```

## 1. 当前代码基线

已经落地：

- `edges` / `evidence` / `documents` / `document_chunks`：事实边与证据链。
- `unknown_items`：未知地图。
- `source_health` / `source_policies` / `source_items` / `document_versions` / `source_change_events` / `fetch_runs`：source monitor 第一层。
- `change_records`：图谱写入变化日志。
- `renderCompany` / `renderComponent` / `renderChain`：当前 CLI 卡片输出。
- `research-workbench-spec.md`：TypeScript + Canvas 工作台规格。
- `multi-tier-chain-logistics-plan.md`：`edge / observation / lead / unknown` 四层模型。

仍缺：

- `packages/observation-store`：统一写入 observations / leads。
- 语义级 change event：`EDGE_DEPRECATED`、`UNKNOWN_RESOLVED`、`SUPPLIER_RELATION_ADDED` 等。
- `apps/research-preview`：真正的本地研究工作台。

## 2. 目标形态

SupplyStrata 中期要回答的是：

```text
谁供应谁？
谁依赖谁？
需求端有没有变化？
生产端有没有变化？
组件、材料、能源、物流、港口有没有变化？
哪些是事实？
哪些是推断？
哪些只是线索？
哪些公开数据根本看不到？
```

因此数据层必须分成五类对象：

| 层级        | 含义                         | 默认是否画成事实边 | 典型来源                       |
| ----------- | ---------------------------- | ------------------ | ------------------------------ |
| Fact Edge   | 已证实公司/设施/组件关系     | 是                 | SEC、年报、官方供应商名单      |
| Claim       | 可读结论，必须指向证据和边   | 不单独画边         | graph-builder / claim-builder  |
| Observation | 可复现观测，不能单独证明关系 | 否                 | Comtrade、EIA、NOAA AIS、USGS  |
| Lead        | 值得研究的线索               | 否                 | 新闻、招聘、政府采购、单条 BOL |
| Unknown     | 公开数据无法确认或暂未确认项 | 画成边界           | 研究流程、规则、人工 review    |

一句话：**图不是事实，证据才是事实；观测不是关系，线索不是证据。**

## 3. 模块边界

中期新增模块要保持高内聚低耦合，避免把所有逻辑塞回 `pipeline` 或 `render`。

```text
packages/core
  只放共享领域类型：ClaimType、ObservationType、SemanticLayer、ChainSegment 等。

packages/db
  只放 migration、仓储函数和只读查询；不判断业务语义。

packages/claim-builder
  从 edge/evidence/unknown 生成可审计 claim；不抓源，不写 graph。
  第一版已落地为 edge/evidence builder：只消费 current、非 inferred、Level >= 4 且有 primary evidence 的事实边。

packages/observation-store
  统一写入 trade/energy/commodity/port/procurement/lead observations。

packages/chain-view
  把 edges、claims、observations、leads、unknowns 组装成 ChainViewModel。
  第一版已落地 company chain：输出 edge/claim 分层 segment；observation/lead/unknown segment 随后接入。

packages/render
  只负责把 CompanyCard / ComponentCard / ChainViewModel 渲染成 CLI JSON/Markdown。

apps/research-preview
  只消费 JSON；不直连 Postgres / Neo4j。
```

不允许：

- source adapter 直接写 `edges`。
- observation adapter 直接写 `edges`。
- LLM 直接写 `edges` 或提高 `evidence_level`。
- 前端把 `semantic_layer=observation` 画成事实边。

## 4. 数据模型骨架

### 4.1 Claim Layer

`claim` 是报告和工作台里的可读结论。它防止自然语言输出越过证据边界。

已由 `packages/db/src/migration-sql/0006_claims_observations_chain_views.ts` 建表：

```sql
CREATE TABLE claims (
  claim_id TEXT PRIMARY KEY,
  claim_type TEXT NOT NULL,
  claim_text TEXT NOT NULL,
  subject_id TEXT REFERENCES entity_master(entity_id),
  object_id TEXT REFERENCES entity_master(entity_id),
  component_id TEXT REFERENCES components(component_id),
  edge_id TEXT REFERENCES edges(edge_id),
  status TEXT NOT NULL,
  evidence_level SMALLINT NOT NULL CHECK (evidence_level BETWEEN 1 AND 5),
  confidence REAL NOT NULL,
  is_inferred BOOLEAN NOT NULL,
  generated_by TEXT NOT NULL,
  last_verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE claim_evidence (
  claim_id TEXT NOT NULL REFERENCES claims(claim_id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES evidence(evidence_id),
  role TEXT NOT NULL,
  PRIMARY KEY (claim_id, evidence_id)
);

CREATE TABLE claim_unknowns (
  claim_id TEXT NOT NULL REFERENCES claims(claim_id) ON DELETE CASCADE,
  unknown_id TEXT NOT NULL REFERENCES unknown_items(unknown_id),
  role TEXT NOT NULL,
  PRIMARY KEY (claim_id, unknown_id)
);
```

规则：

- 报告里的事实性句子必须来自 `claims`。
- `claims.evidence_level` 不能高于关联 evidence 的最高可用等级。
- claim 不允许自己“发明”事实；它只能聚合 edge/evidence/unknown。
- `claims build` 使用确定性 `CLM-EDGE-*` id，重复运行只更新同一条 claim，不产生重复结论。
- unsupported claim rate 必须等于 0。

### 4.2 Observation Layer

Observation 是“公开数据里可复现的信号”，但不是供应链事实边。

先做统一表，不一开始拆成七张表。原因很简单：中期目标是先稳定契约，后面数据量大了再按 category 拆分。

```sql
CREATE TABLE observations (
  observation_id TEXT PRIMARY KEY,
  observation_type TEXT NOT NULL,
  source_adapter_id TEXT NOT NULL,
  source_item_id TEXT REFERENCES source_items(source_item_id),
  doc_id TEXT REFERENCES documents(doc_id),
  scope_kind TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  geography_kind TEXT,
  geography_id TEXT,
  component_id TEXT REFERENCES components(component_id),
  metric_name TEXT NOT NULL,
  metric_value NUMERIC,
  metric_unit TEXT,
  time_window_start DATE,
  time_window_end DATE,
  baseline_value NUMERIC,
  change_value NUMERIC,
  change_percent REAL,
  confidence REAL NOT NULL,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

第一批 `observation_type`：

```text
TRADE_FLOW_OBSERVATION
PORT_ACTIVITY_OBSERVATION
ROUTE_OBSERVATION
ENERGY_PRICE_OBSERVATION
COMMODITY_PRICE_OBSERVATION
MINERAL_SUPPLY_OBSERVATION
CAPEX_OBSERVATION
INVENTORY_OBSERVATION
BACKLOG_OBSERVATION
CUSTOMER_CONCENTRATION_OBSERVATION
POLICY_OBSERVATION
PROCUREMENT_OBSERVATION
```

硬规则：

- observation 默认不能进入 Neo4j edge。
- observation 可以挂到 ChainView，也可以被 claim 引用为上下文，但不能单独证明 `Company A -> Company B`。
- 如果 observation 后续要升级为 inferred edge，必须走 review queue，并保留原 observation id。

### 4.3 Lead Layer

Lead 是“值得追”的线索，不是证据。

```sql
CREATE TABLE lead_observations (
  lead_id TEXT PRIMARY KEY,
  lead_type TEXT NOT NULL,
  source_adapter_id TEXT NOT NULL,
  doc_id TEXT REFERENCES documents(doc_id),
  scope_kind TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  cite_text TEXT,
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  review_id TEXT REFERENCES review_candidates(review_id),
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

第一批 `lead_type`：

```text
HIRING_SIGNAL
NEWS_SIGNAL
PROCUREMENT_SIGNAL
BOL_SINGLE_RECORD
FORUM_OR_BLOG_SIGNAL
UNVERIFIED_FACILITY_SIGNAL
```

### 4.4 ChainView Contract

`chain_segments` 是中期最关键的前后端契约。它让同一条链可以同时包含事实边、观测、线索和未知边界。

运行时模型第一版由 `@supplystrata/chain-view` 生成：它不直接写库，先把 current、非 inferred、Level >= 4 的 upstream fact edges 组装成 `ChainViewModel`，并把同一条边上的 active claim 作为独立 `semantic_layer=claim` segment 暴露给前端。这样 Canvas 工作台可以同时画事实边和可读结论，但不会把 claim 当成新的事实来源。

```sql
CREATE TABLE chain_views (
  chain_id TEXT PRIMARY KEY,
  root_kind TEXT NOT NULL,
  root_id TEXT NOT NULL,
  view_type TEXT NOT NULL,
  title TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE chain_segments (
  segment_id TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL REFERENCES chain_views(chain_id) ON DELETE CASCADE,
  sequence_index INT NOT NULL,
  from_kind TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_kind TEXT NOT NULL,
  to_id TEXT NOT NULL,
  semantic_layer TEXT NOT NULL,
  relation TEXT,
  component_id TEXT REFERENCES components(component_id),
  edge_id TEXT REFERENCES edges(edge_id),
  claim_id TEXT REFERENCES claims(claim_id),
  observation_id TEXT REFERENCES observations(observation_id),
  lead_id TEXT REFERENCES lead_observations(lead_id),
  unknown_id TEXT REFERENCES unknown_items(unknown_id),
  evidence_ids TEXT[] NOT NULL DEFAULT '{}',
  confidence REAL,
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb
);
```

`semantic_layer` 只允许：

```text
edge
claim
observation
lead
unknown
```

前端视觉规则：

- `edge`：Level 4/5 实线。
- `claim`：显示为可读说明或边标签，不单独伪装成新边。
- `observation`：细灰线或 lane。
- `lead`：虚线候选，默认折叠。
- `unknown`：橙色边界。

## 5. 实施顺序

### PR A：中期 schema migration

新增 migration：

```text
0006_claims_observations_chain_views
```

状态：已落地。只建表、索引和核心 CHECK 约束，不接外部 adapter。

验收：

- [x] `claims` / `claim_evidence` / `claim_unknowns` 建表。
- [x] `observations` / `lead_observations` 建表。
- [x] `chain_views` / `chain_segments` 建表。
- [x] `packages/core` 增加 Claim / Observation / Lead / SemanticLayer / ChainView 类型常量。
- [ ] `pnpm db:migrate` 在有 Postgres 的环境可创建新表。
- [ ] `pnpm type-check` / `pnpm test:unit` / `pnpm lint` / `pnpm dep-check` 通过。
- [x] docs/03-data-model/schema.md 同步。

### PR B：Core 类型与 DB 仓储

状态：已落地。`packages/db` 新增 `claims.ts`、`observations.ts`、`chain-views.ts`，只提供 insert/list/get/link 等仓储函数，不做业务推断。

新增类型：

```text
ClaimType
ObservationType
LeadType
SemanticLayer
ChainSegment
ChainViewModel
```

新增 db 文件：

```text
packages/db/src/claims.ts
packages/db/src/observations.ts
packages/db/src/chain-views.ts
```

验收：

- [x] 仓储函数只做数据写入和读取，不做业务推断。
- [x] 单元测试覆盖 insert/list/get 的关键路径。
- [x] 不引入 `any` 或 `unknown as T`。
- [x] `chain_segments` 写入时只保留当前 `semantic_layer` 对应引用，防止 observation/lead 被误当事实边。

### PR C：claim-builder

新增 `packages/claim-builder`。

输入：

- `edges`
- `evidence`
- `unknown_items`

输出：

- `claims`
- `claim_evidence`
- `claim_unknowns`
- `change_records`

第一版只支持事实边 claim：

```text
NVIDIA publicly discloses that it buys memory from SK Hynix.
```

验收：

- 每个 claim 至少有 1 条 evidence。
- claim evidence level 不超过 edge/evidence。
- `renderCompany` 可以选择基于 claim 输出事实句。

### PR D：observation-store + seed fixtures

新增 `packages/observation-store` 或先放入 `packages/db/src/observations.ts`。第一版只用 fixture，不接 Comtrade/EIA/NOAA。

验收：

- 能写入 `CAPEX_OBSERVATION`、`INVENTORY_OBSERVATION`、`TRADE_FLOW_OBSERVATION` fixture。
- observation 不会被 graph-builder 物化成 Neo4j edge。
- ComponentCard JSON 能带 `related_observations`。

### PR E：chain-view package

新增 `packages/chain-view`。

职责：

- 从 `edges` 生成事实 `edge` segments。
- 从 `claims` 生成可读 claim labels。
- 从 `observations` 生成 observation lane。
- 从 `lead_observations` 生成折叠线索。
- 从 `unknown_items` 生成 unknown boundary。

验收：

- `supplystrata chain <company> --format json` 输出 `chain_segments`。
- 每段都有 `semantic_layer`。
- 默认只展示 Level 4/5 fact edges，observations/leads 不污染事实边。

### PR F：语义级 changes

在 `graph-builder`、`claim-builder`、`observation-store` 中写更明确的 change type：

```text
EDGE_ADDED
EDGE_UPDATED
EVIDENCE_ADDED
CLAIM_ADDED
CLAIM_UPDATED
OBSERVATION_ADDED
LEAD_ADDED
UNKNOWN_ADDED
UNKNOWN_RESOLVED
```

验收：

- `cli changes` 能区分 graph/source/claim/observation/lead/unknown。
- Workbench timeline 不需要猜 event 类型。

### PR G：research-preview 数据接口

先不做漂亮前端，先做 JSON 产物：

```text
pnpm cli workbench export --company nvidia --out reports/nvidia-workbench.json
```

验收：

- JSON 含 `companies / chain_segments / claims / evidences / unknown_items / sources / changes`。
- `apps/research-preview` 只读这个 JSON。

### PR H：LLM Candidate Assistant

等 A-G 稳定后再做。LLM 第一版只生成候选：

- candidate relation。
- candidate unknown。
- evidence summary。
- source plan。

禁止：

- 直接写 edge。
- 直接写 claim。
- 直接升级 evidence level。
- 直接 merge entity。

## 6. 与 v0.2 的关系

v0.2 仍然优先完成：

- Apple Supplier List reviewed facility edges。
- NVIDIA 研究路径可复现。
- ComponentCard。
- changes / source health。
- 本地研究工作台 preview。

中期目标从 v0.2 之后接力，不应该反过来阻塞 v0.2。唯一例外是 `chain_segments` 和 `observations` 的 schema/contract 可以提前落地，因为它们是工作台的骨架。

## 7. 暂不做

- 不接大规模 Comtrade/EIA/NOAA adapter。
- 不做投资建议。
- 不做多租户。
- 不做在线 SaaS。
- 不做 BOL 自动抓取。
- 不让 LLM 自动入图。
- 不为了演示效果手工制造二级/三级无证据边。

## 8. 风险

| 风险                              | 影响                     | 处理方式                                       |
| --------------------------------- | ------------------------ | ---------------------------------------------- |
| Claim 变成“又一套事实库”          | edge/evidence/claim 分叉 | claim 只能引用 edge/evidence/unknown           |
| Observation 被误画成事实边        | 图谱可信度下降           | `semantic_layer` 强制保留，前端按层渲染        |
| ChainView 太早耦合 NVIDIA / Apple | 后续公司扩展困难         | root_kind/root_id + 通用 segment，不写公司特例 |
| Lead 太多淹没研究员               | 工作台噪音过大           | 默认折叠，只在 review 或搜索场景展示           |
| LLM 过早进入事实链                | 幻觉污染图谱             | LLM 只进 review candidates                     |
| schema 一次性过大                 | 迁移风险升高             | PR A 只建表；后续再接 writer/renderer          |

## 9. Definition of Done

中期骨架完成的标准：

```text
[ ] claims / claim_evidence / claim_unknowns 落库
[ ] observations / lead_observations 落库
[ ] chain_views / chain_segments 落库
[ ] packages/claim-builder 可以生成无 unsupported claim 的第一版 claims
[ ] packages/chain-view 可以输出分层 ChainViewModel
[ ] CLI JSON 输出包含 semantic_layer
[ ] research-preview 能消费 ChainViewModel
[ ] observations/leads 不会进入 Neo4j fact edge
[ ] LLM 仍然不能直接写 edge/claim
```
