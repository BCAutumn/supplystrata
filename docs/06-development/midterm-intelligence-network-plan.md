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
- `packages/observation-store`：统一写入 observations / leads。
- `packages/chain-view`：运行时输出 edge / claim / observation / lead / unknown 分层 ChainViewModel。
- 语义级 changes 第一版：claim / observation / lead 写入路径会产生确定性的 `change_records`；官方披露文档变化会产生固定 section fingerprint diff；官方披露关系候选会产生 relation fingerprint diff，并进入 review queue。

仍缺：

- 语义变化确认后自动生成 claim 草稿的工作流。
- 更深层二级/三级免费源 adapter，把 relation/observation/lead 填到 ChainView。

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

packages/source-connectors
  统一注册 source check target runner；只做 target 分发和配置校验，不抓源、不写库。
  已把 source check connector 契约收口；具体 connector 实现在 source-workflows，不再落入 pipeline。

packages/source-workflows
  具体免费/公开源的 use-case 编排层：SEC EDGAR、Apple Supplier List、官方 IR、Census Trade、Open Supply Hub、OpenCorporates / Companies House 都在这里接入。
  后续 DART、EDINET、Comtrade、RMI 等免费源通过新增 workflow/connector 接入，不再改 pipeline 内核或 CLI 调度分支。
  Apple Supplier List workflow 会把官方供应商设施行同时写入 review candidates 和 OSH cross-check leads，并把 lead 物化成 OSH facility-search source check target；前者经人工审核后才生成 fact edge，后者触发 Open Supply Hub 设施候选检索，并落入 `osh_facility_candidate` review candidate。

packages/pipeline
  只做 normalized document engine；已拆成 run / document-observations / citation-location / review-apply。
  不直接 import `sources/*`，新增免费源不能再塞回 pipeline。

packages/chain-view
  把 edges、claims、observations、leads、unknowns 组装成 ChainViewModel。
  第一版已落地 company chain：输出 edge/claim/observation/lead/unknown 分层 segment。

packages/render
  只负责把 CompanyCard / ComponentCard / ChainViewModel 渲染成 CLI JSON/Markdown。
  已拆成 company / component / chain / evidence / changes / pending / unknown 等小模块；index 只做稳定 re-export，避免渲染层重新变成总控文件。

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
  review_id TEXT REFERENCES review_candidates(review_id),
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
- `semantic_change` review apply 只能生成 `status='draft'` 的 claim；draft claim 是研究草稿，不进入 active fact claim 查询，也不写 graph edge。
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

运行时模型第一版由 `@supplystrata/chain-view` 生成：它不直接写库，先把 current、非 inferred、Level >= 4 的 upstream fact edges 组装成 `ChainViewModel`，并把同一条边上的 active claim 作为独立 `semantic_layer=claim` segment 暴露给前端。同时，company scope observation、链路涉及的 component observation、open lead 和 unknown item 会作为 `observation` / `lead` / `unknown` context segment 输出。这样 Canvas 工作台可以同时画事实边、可读结论、观测、线索和未知边界，但不会把 observation 或 lead 当成事实来源。`status='draft'` 的 claim 不进入 ChainView；它由 `workbench-export` 按当前研究公司 scope 过滤后作为 `draft_claims` 独立字段输出，供侧栏展示研究草稿。

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
- [x] `pnpm type-check` / `pnpm test:unit` / `pnpm lint` / `pnpm dep-check` 通过。
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

状态：已落地第一版。`packages/claim-builder` 只从 current、非 inferred、Level >= 4 且有 primary evidence 的事实边生成 claim；使用确定性 `CLM-EDGE-*` id 幂等 upsert，不抓源、不写图、不提高证据等级。

新增 `packages/claim-builder`。

输入：

- `edges`
- `evidence`
- `unknown_items`

输出：

- `claims`
- `claim_evidence`

第一版只支持事实边 claim：

```text
NVIDIA publicly discloses that it buys memory from SK Hynix.
```

验收：

- [x] 每个 claim 至少有 1 条 evidence。
- [x] claim evidence level 不超过 edge/evidence。
- [x] `supplystrata claims build --min-level 4` 可幂等运行。
- `renderCompany` 可以选择基于 claim 输出事实句。

### PR D：observation-store + seed fixtures

状态：已落地第一版。`packages/observation-store` 提供 observation / lead 的幂等写入边界；第一版只支持 fixture 或上层模块传入的已标准化观测，不接 Comtrade/EIA/NOAA，不写 graph。

新增 `packages/observation-store`。第一版只用 fixture 或内部调用，不接外部宏观源。

验收：

- [x] 能写入 `INVENTORY_OBSERVATION` / `TRADE_FLOW_OBSERVATION` 等观测输入。
- [x] observation / lead 写入路径不会触碰 `edges`。
- [x] ComponentCard JSON 能带 `related_observations`。
- [x] observation / lead 可被 `@supplystrata/chain-view` 作为 context segment 消费。
- [ ] 后续 fixture 扩展到 `CAPEX_OBSERVATION`。

### PR E：chain-view package

状态：已落地第一版。`packages/chain-view` 输出 `CompanyChainViewModel`，`packages/render` 已改为消费该模型；当前支持 `edge` / `claim` / `observation` / `lead` / `unknown` 五类 segment。observation、lead、unknown 是上下文段，不带 `evidence_level`，也不会进入 Neo4j fact edge。

新增 `packages/chain-view`。

职责：

- 从 `edges` 生成事实 `edge` segments。
- 从 `claims` 生成可读 claim labels。
- 从 `observations` 生成 observation lane。
- 从 `lead_observations` 生成折叠线索。
- 从 `unknown_items` 生成 unknown boundary。
- 从组件二/三级上游 lead 生成 `source_hints`，把“下一步查哪些免费源”挂在具体链路段上，而不是只在页面底部给全局 source plan。

验收：

- [x] `supplystrata chain <company> --format json` 输出分层 `segments`。
- [x] 每段都有 `semantic_layer`。
- [x] 默认只展示 Level 4/5 fact edges，observations/leads 不污染事实边。
- [x] observation / lead / unknown segments 接入。
- [x] 二/三级 lead segment 包含 source hints，标明候选源输出层级和 relation policy。

### PR F：语义级 changes

状态：已落地第一版。先不用 LLM，也不做自由文本报告 diff；只在结构化写入路径、固定官方披露 section fingerprint、官方披露 relation fingerprint 中记录确定性事件。`recordSemanticChange()` 统一写 `change_records`，`claim-builder` 负责 claim 事件，`observation-store` 负责 observation / lead 事件，`review-store` 负责 review 决策事件，unknown 仓储负责 unknown add/resolve 事件，timeline 通过 `event_family=semantic` 暴露给 CLI 和工作台。

已支持：

```text
CLAIM_ADDED
CLAIM_UPDATED
OBSERVATION_ADDED
OBSERVATION_UPDATED
LEAD_ADDED
LEAD_UPDATED
REVIEW_APPROVED
REVIEW_REJECTED
REVIEW_APPLIED
REVIEW_BLOCKED
UNKNOWN_ADDED
UNKNOWN_UPDATED
UNKNOWN_RESOLVED
```

已落地第一版：

```text
SUPPLIER_RELATION_ADDED
SUPPLIER_RELATION_REMOVED
CUSTOMER_RELATION_ADDED
CUSTOMER_RELATION_REMOVED
FOUNDRY_RELATION_ADDED
FOUNDRY_RELATION_REMOVED
PURCHASE_OBLIGATION_ADDED
PURCHASE_OBLIGATION_CHANGED
PURCHASE_OBLIGATION_REMOVED
CAPACITY_RESERVATION_ADDED
CAPACITY_RESERVATION_CHANGED
CAPACITY_RESERVATION_REMOVED
SINGLE_SOURCE_RISK_ADDED
SINGLE_SOURCE_RISK_CHANGED
SINGLE_SOURCE_RISK_REMOVED
CUSTOMER_CONCENTRATION_CHANGED
INVENTORY_CHANGED
BACKLOG_CHANGED
CAPEX_CHANGED
PROCUREMENT_CHANGED
*_SECTION_ADDED
*_SECTION_REMOVED
```

已接入 review queue 和 draft claim：relation-level semantic diff 会生成 `semantic_change` 候选。研究员可以 approve / reject；`review apply` 对这类候选只做 acknowledge，并生成 `CLM-REVIEW-*` draft claim，不生成事实边。这条边界很重要：relation semantic diff 是“披露变化提醒”，不是已审计事实边。

仍待补齐：让工作台单独展示 draft claim，并提供“升级为事实边候选”的显式入口；如果要升级为 edge/evidence，仍必须走实体解析、scoring 和 GraphBuilder 的严格路径。

验收：

- [x] `cli changes` 能区分 graph/source/semantic。
- [x] claim / observation / lead 能按 scope 查询 timeline。
- [x] review approve / reject / apply / block 写入 semantic changes。
- [x] unknown add / update / resolve 写入 semantic changes。
- [x] evidence superseded 写入 graph changes。
- [x] edge deprecated 写入 graph changes，并从 GraphStore 当前态投影删除。
- [x] Workbench timeline 不需要靠字符串猜 claim/observation/lead 事件类型。
- [x] 官方披露 section fingerprint diff 补齐明确事件；当前只覆盖客户集中、库存、backlog、capex、采购义务，避免用 AI 报告段落做不可复现 diff。
- [x] 官方披露 relation fingerprint diff 补齐供应商、客户、foundry 新增/移除事件；当前仍保持 observation/semantic 层，不自动写 fact edge。
- [x] 采购义务、产能预留、单一供应商风险从普通 supplier relation diff 中分离为专门语义事件。
- [x] relation semantic diff 自动入 `review_candidates(kind='semantic_change')`，且确认后只 acknowledge，不绕过 fact edge 写入规则。
- [x] 已确认的 `semantic_change` 生成 `status='draft'` 的 claim 草稿；active fact claim 查询不会混入这些草稿。

### PR G：research-preview 数据接口

状态：已落地第一版。`@supplystrata/workbench-export` 负责从 DB 组装工作台 JSON，`apps/cli workbench export` 负责导出文件，`apps/research-preview` 只读 JSON 并用 TypeScript + Canvas 渲染链路。

先不做漂亮前端，先做 JSON 产物：

```text
pnpm cli workbench export --company nvidia --out reports/nvidia-workbench.json
```

验收：

- [x] JSON 含 `companies / chain_segments / claims / draft_claims / evidences / unknown_items / sources / changes`。
- [x] `apps/research-preview` 只读这个 JSON。
- [x] Canvas 第一版能显示 fact edge、observation、lead、unknown boundary。
- [x] research-preview 侧栏能展示 `draft_claims`，不把草稿画进 fact edge lane。
- [x] Evidence Inspector 从只看 primary evidence 扩到多 evidence / supersession chain。
- [ ] 公司切换仍需等多公司 export/fixture 完善后补。

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
- Apple Supplier List -> OSH cross-check leads -> source check targets -> OSH facility review candidates，作为设施候选和地点校验入口，不自动生成供应链事实边。
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
[x] claims / claim_evidence / claim_unknowns 落库
[x] observations / lead_observations 落库
[x] chain_views / chain_segments 落库
[x] packages/claim-builder 可以生成无 unsupported claim 的第一版 claims
[x] packages/chain-view 可以输出分层 ChainViewModel
[x] CLI JSON 输出包含 semantic_layer
[x] ChainViewModel 包含 observation / lead / unknown context segments
[x] 二/三级 lead segment 带 source hints，能说明下一步应查哪些免费/公开源
[x] research-preview 能消费 ChainViewModel
[x] observations/leads 不会进入 Neo4j fact edge
[x] claim / observation / lead 写入路径产生语义级 changes
[x] review / unknown 写入路径产生语义级 changes
[x] LLM 仍然不能直接写 edge/claim
```
