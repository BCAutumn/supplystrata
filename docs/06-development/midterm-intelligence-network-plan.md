# Midterm Intelligence Network Plan — 公开供应链情报网中期骨架

> 本文记录中期骨架，很多条目已经落地。它不再代表“后端完成”。后端完成门槛已收敛到 [backend-completion-criteria.md](./backend-completion-criteria.md)：必须补齐官方披露覆盖、claim 多源融合、观测信号、API、质量/性能和安全 agent gate。若本文与后端完成标准冲突，以后者为准。

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
- Component-HS-Material taxonomy 第一版：`component-context` 已能输出 HS 代理码、material exposure 和 material observation target；`source-plan` 可据此生成 Census Trade runnable target、World Bank Pink Sheet runnable target、官方 IR runnable target，以及 USGS planned target；`source-management` 可把 research-pack 的 runnable `source-plan.json` suggestions 无数据库预览为稳定 target id / 去重统计 / validation 结果，也可同步成 `source_check_targets`，默认 disabled，审计后可用同一 plan + namespace 受控启用并写入 target 级调度参数；`source-target-coverage` 会把 target 的 sync/enable/due/job/event/degraded/observation 状态和 job failure kind 回流到 research-pack，并让 investigation backlog / Gate 1 ledger action 随状态细化；ComponentCard 会展示贸易代理码、材料暴露和已落库观测。
- Edge intelligence refresh 第一版：`@supplystrata/evidence-maintenance` 会刷新 Level 4/5 事实边的新鲜度，从明确 primary evidence 文本写入关系强度，并为缺少 strength 的事实边生成 edge-scoped explicit unknown；`research-pack` 默认只读输出已有 intelligence context，只有显式 `--prepare-data` 或 `--refresh-intelligence` 才会在导出前刷新并写库。
- Component risk baseline 第一版：`refreshComponentRiskView()` 会从已有 component fact edge、edge strength 和 freshness 生成 `risk_views / risk_metrics`，覆盖 freshness-adjusted HHI、single-source exposure、terminal consumer path redundancy / alternate upstream paths、weighted alternate-path context、directed node knockout reachability、strength/freshness weighted node knockout impact、directed betweenness centrality、weighted path centrality context 和 freshness-adjusted exposure；research-pack 默认只读输出已有 risk view，只有显式 `--prepare-data` 或 `--refresh-component-risk` 才会对当前包里已有 Level 4/5 component fact edge 的 eligible 组件批量刷新 risk baseline，不给只有 taxonomy/source-plan 的组件写空风险结论。ComponentCard / research-pack 会展示 JSON/Markdown 派生风险上下文，CompanyCard 会展示 company-scoped observations，并把相关 component risk metrics 聚合成 top exposure nodes。
- Risk metric semantic change 第一版：component risk refresh 会把新版 risk view 与上一版同 scope 派生指标做稳定 key 对比，超过阈值时写入 `RISK_METRIC_CHANGED`；changes timeline 已能把 raw source change、semantic change 和 risk change 分开展示。
- Timeline enrichment 第一版：`EVIDENCE_SUPERSEDED` 和官方披露 relation semantic diff 已能在 changes timeline 中显示结构化字段和 Markdown 摘要。relation diff 仍然是披露变化提醒，不是自动 fact edge mutation。
- Edge calibration baseline 第一版：`edge_calibration_labels` 保存人工 gold label，`refreshEdgeCalibrationRun()` 输出 Level 4/5 fact edge precision、confidence reliability buckets 和错误分类汇总；校准结果只用于方法学治理，不自动修改事实边。
- Observation anomaly baseline 第一版：`refreshObservationAnomalyViews()` 会从已有 observation 的显式 baseline/change 字段或可比较历史窗口生成 observation-scoped `risk_views / risk_metrics`，metric kind 为 `observation_anomaly`；CompanyCard / ComponentCard / research-pack 在已有 anomaly view 时展示 anomaly summary。`refreshFinancialMetricPeerComparisonViews()` 会把同 metric / unit / fiscal period 的公司财务 observation 生成 `financial_metric_peer_zscore`，CompanyCard / research-pack 会展示 financial peer position。它们不从稀疏历史猜 baseline，不写 fact edge。
- Alert candidate baseline 第一版：`refreshAlertCandidates()` 会从 observation anomaly、source failure 和 component risk metric 生成去重的 `alert_candidates`。alert 只引用 observation / risk_view / risk_metric / change / source event，不写 fact edge，不等同于正式通知。`updateAlertCandidateStatus()` 会把 acknowledged / resolved / suppressed 等维护动作写成 `ALERT_STATUS_CHANGED` semantic change，保证人工处理路径可审计。
- Attention queue baseline 第一版：Workbench / research-pack 会把 claim conflict、claim lifecycle warning、open alert candidates、degraded source health 和 `requires_attention=true` 的 change 统一导出为 `attention_queue`，并生成 `attention-queue.json/md`。它只是即时处理入口，不自动裁决冲突、不改事实边、不关闭 unknown。
- Official disclosure readiness 第一版：research-pack 会输出 Gate 1 账本，统计 Level 4/5 fact edge、traceability、cross-source corroboration、single-source disposition/unknown、strength/freshness gap、source target coverage、内置研究 target profile、显式 target node 覆盖、逐 expected source 覆盖和 profile expansion candidates。`ai-compute-memory.v0` 会在选中公司/组件命中 AI compute/memory 范围时自动启用；profile 是验收锚点，不是全球供应链全集。内置 profile 已能把 SEC CIK / 官方 IR / company-ir 显式 URL / DART / EDINET / TWSE hints 下沉给 source-plan，生成可同步的 node-specific official source target suggestions；缺显式 URL、公司级代码、connector 或 config 的来源仍保留为显式缺口。没有二源路径且没有已记录 disposition unknown 的 single-source edge 会得到确定性 proposed unknown payload；`evidence-maintenance` 已能把它受控落库为 edge-scoped unknown，并默认确认目标 edge 仍为 current。官方披露 signal 的人工 disposition 也走同一个高内聚边界：review-store 只记录 `OFFICIAL_DISCLOSURE_SIGNAL_DISPOSITION_RECORDED`，`evidence-maintenance` 只在 decision 为 `record_single_source_unknown` 时物化 unknown，不碰 fact edge / evidence。未出现在当前 Workbench 的核心节点会显示为 `missing`，profile 期待但未接通的官方源会显示为 `connector_available`、`source_registered_unimplemented` 或 `missing_source_mapping` 等缺口，不在 profile 中但已被发现的节点会进入 expansion backlog 等待审阅。
- Supply chain expansion plan 第一版：research-pack 会把当前 L4/L5 fact frontier、chain depth、component-context upstream taxonomy、source-plan、official readiness 和 unknown map 汇总成 `supply-chain-expansion-plan.json/md`。它不是“自动找最大供应商并写边”，而是把下一层研究拆成 `expand_candidate / needs_component_context / stop_depth_limit` frontier、component dependency lead、source path 和 stop condition；logistics/route 只留在 observation layer，catalog boundary 会显式停止。investigation-backlog 会消费该 plan，生成 `supply_chain_expansion` 任务，让递归扩张进入同一个审计 backlog。
- Gate 1 run ledger 第一版：research-pack 会额外输出 `gate1-run-ledger.json/md`，把 readiness scorecard、data progress、source path progress、corroboration action batches 和 frontier company switching 合成一个主线执行账本。它给出下一步应该 smoke/sync/run 哪类 source target、何时记录 single-source unknown、何时从 L4/L5 frontier 切换到 counterparty 的通用 `research run --company ... --component ...`，但不执行任何抓取或写库。
- Gate 1 data-depth workbench 第一版：research-pack 会额外输出 `gate1-data-depth-workbench.json/md`，把事实边增长、二源 corroboration、source blocker、strength 缺口、observation calibration labeling batch 和 propagation context 缺口合成 review-only 优先级清单，作为继续跑数据和校准算法的主工作面；它不写事实层。
- Source-check worker 第一版：`apps/worker` 提供常驻 worker loop，复用 `source-workflows.runDueSourceChecks()` 消费 `source_check_jobs`，CLI 不再是唯一运行入口。

仍缺：

- weighted centrality / weighted path redundancy 的真实样本校准和阈值治理。
- 足量人工 edge gold set、跨源 observation calibration 与季节性基线。
- 通知通道。
- USGS / IEA 等原材料源 adapter，把 planned material target 进一步变成 runnable connector，并落成 mineral / critical-minerals observations。
- DART-KR / EDINET / TWSE 等官方披露源，把二级/三级事实边继续做厚。当前 DART 已先接到 disclosure list monitor / source-check / readiness；EDINET 已先接到 `documents.json` daily-filings monitor / source-check / readiness，并在 profile 中覆盖 silicon wafer / ABF substrate 的日本官方目录监控；TWSE MOPS 已接到 `electronic-documents` 目录 monitor / source-check / readiness，先覆盖 Foxconn / Quanta 这类台湾 AI server ODM 节点的官方披露入口。正文下载、XBRL ZIP / PDF 和韩文/HWP 解析继续后排。
- Propagation readiness 第一版已落地：research-pack 会把需求信号、扩产信号、设施建设、设备安装、工艺材料消耗、原材料价格/贸易/政策信号汇总成 `ready / partial / blocked` 推理输入，并带 `reasoning_input_only_no_fact_mutation` policy。它只服务前端/AI 研究，不直接生成事实边或自然语言结论；后续仍需把更多真实 typed observations 和 source target coverage 接入这些 context。
- 需要 key 的公开源必须走统一 source credential 配置：key 定义集中在 `@supplystrata/config`，本地真实值集中到 git 忽略的 `config/source-credentials.local.json`，`.env` / 环境变量只作为覆盖入口。未配置 key 时，source-plan smoke / backlog 标记 `missing_credentials`，research-pack 仍能输出当前可审计数据和缺口。

## 2. 目标形态

SupplyStrata 中期要回答的是：

```text
谁供应谁？
谁依赖谁？
需求端有没有变化？
生产端有没有变化？
组件、材料、能源、物流、港口有没有变化？
这些变化沿着组件、设备、材料、设施和地区怎么传导？
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

后端中期还必须把产业链递归展开所需的节点准备好：

```text
company / facility / component / material / equipment / process / geography
```

例如 AI compute 不能只停在 `NVIDIA -> TSMC / SK Hynix`。它还要能把 `GPU / HBM / server / PCB / optical module / cleanroom / semiconductor equipment / photoresist / target / CMP / copper foil / resin / electronic glass cloth / high-purity gas` 这类 component、material、equipment 和 process frontier 放进 taxonomy、source-plan、unknown 和 investigation backlog。后端负责把这些节点、来源、证据和缺口准备好；最终“这条传导链意味着什么”的开放式综合分析，留给未来前端研究流程和安全 AI 消费结构化 DTO 完成。

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
  具体免费/公开源的 use-case 编排层：SEC EDGAR、Apple Supplier List、官方 IR、OpenDART disclosure list、EDINET daily filings、Census Trade、Open Supply Hub、GLEIF / OpenCorporates / Companies House 都在这里接入。
  `runDueSourceChecks()` 已从直接扫 due target 推进为 `source_check_jobs` durable job/outbox：先 enqueue 到期目标，再 claim job，失败进入 backoff retry，超过 `max_attempts` 进入 dead。持续监控参数统一由 source policy config 配置，source 级默认值可被 target 级覆盖；后续常驻 worker 复用同一 use-case，不需要把调度逻辑写进 CLI。
  `sources due/run-due` 已支持按 `source-plan.json + namespace`、`check_target_id` 或 source adapter 过滤小批量目标，适合先跑某个研究包的官方目标，不会顺手消费全局 due 队列。
  Comtrade、RMI 等免费源继续通过新增 workflow/connector 接入，不再改 pipeline 内核或 CLI 调度分支；DART / EDINET 也沿用了同一条 source-check 骨架，没有给 CLI/worker 加特判。
  Apple Supplier List workflow 会把官方供应商设施行同时写入 review candidates 和 OSH cross-check leads，并把 lead 物化成 OSH facility-search source check target；前者经人工审核后才生成 fact edge，后者触发 Open Supply Hub 设施候选检索，并落入 `osh_facility_candidate` review candidate。

packages/pipeline
  只做 normalized document engine；已拆成 run / document-observations / official-disclosure-signal-candidates / citation-location / review-apply。
  不直接 import `sources/*`，新增免费源不能再塞回 pipeline。
  官方披露信号只能从已保存的 normalized document 进入 `official_disclosure_signal` review candidate，不能在 pipeline 里直接抽 fact edge。

packages/chain-view
  把 edges、claims、observations、leads、unknowns 组装成 ChainViewModel。
  第一版已落地 company chain：输出 edge/claim/observation/lead/unknown 分层 segment。

packages/render
  只负责把 CompanyCard / ComponentCard / ChainViewModel 渲染成 CLI JSON/Markdown。
  已拆成 company / component / chain / evidence / changes / pending / unknown 等小模块；index 只做稳定 re-export，避免渲染层重新变成总控文件。

packages/research-pack
  把已有 truth-store 数据打包成可复现研究输出：workbench JSON、CompanyCard、ChainView、ComponentCard、source plan、data-quality report 和 manifest。
  它不抓新源、不写事实边，只消费现有 DB、确定性 claim builder 和 edge intelligence refresh；后续宿主 app 可以直接复用这个包，而不是调用 CLI。

packages/evidence-maintenance
  truth-store 维护型 use-case：证据 trace backfill、edge intelligence refresh 等可重复后端任务。
  它可以写 evidence 派生字段、intelligence context 和 unknown map，但不能写 fact edge、不能改 evidence_level、不能把 observation / lead 升级成关系。

apps/research-preview
  只消费 JSON；不直连 Postgres / Neo4j。

apps/worker
  常驻后台进程入口；当前只运行 source-check worker loop。
  它只负责循环、信号退出和运行参数解析，不重新实现 source policy、job claim、connector 分发、retry/backoff 或 alert 规则。
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
FINANCIAL_METRIC_OBSERVATION
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
- `FINANCIAL_METRIC_OBSERVATION` 第一版来自 SEC companyfacts JSON；它只记录结构化财报指标时序，同一 metric/unit 可用上一期形成显式 baseline/change，不解析 PDF，也不自动推断供应关系。

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

状态：已落地第一版并补齐第一轮 claim fusion / conflict unknown。`packages/claim-builder` 只从 current、非 inferred、Level >= 4 且有 primary evidence 的事实边生成 claim；使用确定性 `CLM-EDGE-*` id 幂等 upsert，不抓源、不写图、不提高证据等级。同一 fact edge 下未 supersede、非 inferred 的 evidence 会按 `primary` / `supporting` 关联到 claim，claim confidence 用确定性 Noisy-OR 和 source-independence weight 融合。官方披露 relation `*_REMOVED` 语义变化会生成 `UNK-CONFLICT-*` unknown，并挂到 draft claim 与匹配到的 active claim；它只暴露冲突边界，不自动 deprecate fact edge。`linkContradictingEvidenceToClaim()` 支持把现有 evidence 标为 `contradicting` 并生成 blocking unknown；`resolveClaimConflictUnknown()` 通过 unknown resolve 收口。Workbench / research-pack 已输出 claim 的 `evidence_refs`、`unknown_refs` 和 `conflict_state`。active claim 如果仍挂在 deprecated/historical edge 上，Workbench / research-pack 会输出 lifecycle warning。`adjudicateClaimConflict()` 已给出 severity / recommended_action / edge_review_required / allowed_edge_mutation 的第一版确定性裁决；`buildClaimConflictReviewPacket()` 已把裁决收口成 safe-write 审阅包，明确入队类型、阻塞状态、审阅步骤和事实写入策略。`enqueueClaimConflictReviewCandidates()` 会把 unresolved conflict 幂等写入 `review_candidates(kind='claim_conflict_review')`。`review apply` 对 approved claim conflict review 只 acknowledge 并记录 claim-scoped change，不自动改事实层。人工 resolution action 已收口到 `claim-builder`：确认 claim 有效会关闭 linked unknown，建议 deprecate edge 或请求更多证据只记录审计上下文，不自动改 facts。claim lifecycle action 已支持 `supersede_claim`、`reject_claim`、`keep_with_context`，并要求 source refs，不修改事实边。

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
- [x] claim 可列出 primary / supporting evidence。
- [x] claim evidence level 不超过 edge/evidence。
- [x] claim confidence 融合有 deterministic regression fixture。
- [x] relation removal semantic change 会生成 conflict unknown 并关联 claim。
- [x] contradicting evidence role 和 conflict unknown resolve workflow。
- [x] Workbench / research-pack 可导出 claim conflict_state。
- [x] conflict adjudication policy 第一版。
- [x] conflict adjudication 可生成 safe-write review packet 并进入 Workbench / research-pack 输出。
- [x] conflict review packet 接入持久化 review queue。
- [x] claim conflict review 决策接入可审计 safe-write apply path，且不改 facts。
- [x] claim conflict review 支持更细的人工 resolution action。
- [x] active claim 挂在 deprecated/historical edge 上时导出 lifecycle warning。
- [x] claim lifecycle 支持 supersede / reject / keep-with-context 人工动作，且要求 source refs、不改 facts。
- [x] `supplystrata claims build --min-level 4` 可幂等运行。
- `renderCompany` 可以选择基于 claim 输出事实句。

### PR D：observation-store + seed fixtures

状态：已落地第一版。`packages/observation-store` 提供 observation / lead 的幂等写入边界；第一版支持 fixture、SEC companyfacts、Census Trade、World Bank Pink Sheet、官方披露语义抽取和 OSH facility profile 等上层模块传入的已标准化观测，不写 graph。

新增 `packages/observation-store`。它只负责幂等写入和变更记录，不负责抓取源、不做关系推断、不把 observation / lead 升级成 fact edge。

验收：

- [x] 能写入 `INVENTORY_OBSERVATION` / `TRADE_FLOW_OBSERVATION` 等观测输入。
- [x] SEC companyfacts JSON 能写入 company-scoped `FINANCIAL_METRIC_OBSERVATION`。
- [x] Census Trade target 能写入 component/country scoped `TRADE_FLOW_OBSERVATION`。
- [x] World Bank Pink Sheet target 能写入 component/material scoped `COMMODITY_PRICE_OBSERVATION`。
- [x] 官方披露语义抽取能生成 inventory / backlog / capex / customer concentration / procurement observations。
- [x] 示例 source policy 已配置 NVIDIA / AMD / Micron / Intel / Microsoft 五家公司 companyfacts target。
- [x] 同 metric / unit / fiscal period 的财务 observation 能生成 deterministic `financial_metric_peer_zscore`，并带 percentile / rank / peer_count 上下文。
- [x] CompanyCard / research-pack 能带出 company financial peer position。
- [x] observation / lead 写入路径不会触碰 `edges`。
- [x] ComponentCard JSON 能带 `related_observations`。
- [x] research-pack 能输出 `observation-coverage.json/md`，展示本研究包 typed signal 覆盖、series readiness 与 methodology gaps。
- [x] investigation-backlog 能把 sparse observation series 转成继续积累同序列窗口点或寻找 explicit baseline 的调查任务。
- [x] observation / lead 可被 `@supplystrata/chain-view` 作为 context segment 消费。
- [ ] energy / policy / port / route / critical-mineral observations 仍需后续 connector 或 review-safe source workflow。

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
OBSERVATION_REASSERTED
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

已接入 review queue 和 draft claim：relation-level semantic diff 会生成 `semantic_change` 候选。研究员可以 approve / reject；`review apply` 对这类候选只做 acknowledge，并生成 `CLM-REVIEW-*` draft claim，不生成事实边。这条边界很重要：relation semantic diff 是“披露变化提醒”，不是已审计事实边。changes timeline 会把 relation surfaces、relation type、component、fingerprint、previous/next doc id 带出，避免工作台或 CLI 只能展示原始 JSON payload。

官方披露信号也已接入 review queue：TSMC / Samsung / SK hynix / Micron / ASML 这类官方 IR 文档在 DB-backed source-check 保存后，会由确定性 signal extractor 生成 `official_disclosure_signal` 候选，保留原文 cite、locator、evidence level hint 和 `automatic_fact_mutation_allowed=false`。它用于提示研究员检查供应链、产能、需求或技术路线线索；`review apply` 只 acknowledge，不生成 draft claim 或 fact edge。

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
- [x] evidence supersession 和 relation semantic diff 在 timeline / Markdown 中有结构化展示。
- [x] relation semantic diff 自动入 `review_candidates(kind='semantic_change')`，且确认后只 acknowledge，不绕过 fact edge 写入规则。
- [x] 官方披露信号自动入 `review_candidates(kind='official_disclosure_signal')`，且确认后只 acknowledge，不绕过 fact edge 写入规则。
- [x] 已确认的 `semantic_change` 生成 `status='draft'` 的 claim 草稿；active fact claim 查询不会混入这些草稿。

### PR G：research-preview 数据接口

状态：已落地第一版。`@supplystrata/workbench-export` 负责从 DB 组装工作台 JSON，`apps/cli workbench export` 负责导出文件，`apps/research-preview` 只读 JSON 并用 TypeScript + Canvas 渲染链路。

先不做漂亮前端，先做 JSON 产物：

```text
pnpm cli workbench export --company nvidia --out reports/nvidia-workbench.json
```

验收：

- [x] JSON 含 `companies / chain_segments / claims / draft_claims / evidences / unknown_items / sources / changes / intelligence`。
- [x] `unknown_items` DTO 带出 `scope_kind / scope_id`，让 readiness 和后续 agent 按结构化归属识别 edge/claim/company unknown。
- [x] `apps/research-preview` 只读这个 JSON。
- [x] Canvas 第一版能显示 fact edge、observation、lead、unknown boundary。
- [x] research-preview 侧栏能展示 `draft_claims`，不把草稿画进 fact edge lane。
- [x] WorkbenchModel 带出 `edge_strengths / edge_freshness`，先作为 intelligence context 供后续工作台和 risk view 消费。

### PR H：research-pack 研究包

状态：已落地第一版。`@supplystrata/research-pack` 负责把现有 DB 数据打包成目录，`apps/cli research run` 负责调用并写入本地文件。无数据库路径也已落地：`apps/cli research from-workbench` 可以只消费既有 `WorkbenchModel` JSON，输出静态 research snapshot；它不要求 Docker、Postgres 或 Neo4j，适合后续嵌入其它 TS app 或把研究结果发给轻量工作台。

验收：

- [x] 输出 `manifest.json / workbench.json / company.md / chain.md / source-plan.json / quality.json / question-readiness.json`。
- [x] 支持显式加入组件，并为组件输出 `components/*.md` 与 `components/*.json`。
- [x] 默认只读打包；active claims 刷新必须显式开启，不抓新源、不写事实边。
- [x] ComponentCard / research-pack 能在已有 risk view 时带出 component risk baseline。
- [x] research-pack 显式开启后刷新 eligible component risk baseline，并在 manifest 记录 considered / eligible / refreshed / metrics_written。
- [x] Host app 可以直接调用 package API，不需要 shell 到 CLI。
- [x] `research from-workbench` 支持无数据库静态打包。
- [x] `WorkbenchModel` 运行时校验上移到 `@supplystrata/workbench-export/schema`，前端和静态 research snapshot 共用同一契约。
- [x] Evidence Inspector 从只看 primary evidence 扩到多 evidence / supersession chain。
- [x] Question readiness matrix 能标出核心问题的 ready / partial / blocked、缺口和 unknown ids。
- [x] Investigation backlog 能把 readiness gap、explicit unknown、组件覆盖缺口和 source-plan item 汇总成可审计下一步任务。
- [x] source-plan 能消费 target profile official source hints：带 CIK 的 SEC 公司生成 runnable filing targets；显式官方披露年份存在时，为 TSMC / Samsung / SK hynix / Micron / ASML 生成 runnable official IR targets，为带审计 HTTPS URL 的 `company-ir` 目标生成受控长尾 IR target，为 Samsung / SK Hynix 生成 DART 目录 target，为 silicon wafer / ABF substrate 生成 EDINET daily-filings 目录 target，为 Foxconn / Quanta 生成 TWSE MOPS electronic-documents 目录 target。
- [x] source-management / CLI 能把 research-pack source-plan 的 runnable target suggestions 同步到 source_check_targets，并复用统一监控频率、jitter 和重试配置。
- [x] source-management / CLI 能在同步前无数据库预览 runnable target suggestions，输出 target id、去重统计、credentials warning 和 validation 结果。
- [x] source-workflows / CLI 能在同步前无数据库执行 runnable target 的 plan/fetch/normalize smoke，提前发现外部源、凭据或 target config 问题，但不写 monitor event、observation 或 fact edge。
- [x] research-pack 能把 edge-level corroboration source plan 按 audited next-action 拆成非空 smoke / sync / enable / run-due 批次，让 Gate 1 二源检查可以小步执行，而不是把所有 runnable target 一次性同步或启用。
- [x] Gate 1 run ledger 能读取回灌后的 `corroboration-source-plan.summary.by_next_action`，把 action queue 从 smoke 细化成 review observations、补凭据、重试 preflight、sync、enable 或 run due。
- [x] source-monitor / CLI 能在审计后受控启用已同步 source-plan targets，不把 cadence / jitter / retry / next_check_at 散落成调度期临时参数。
- [x] source-monitor / research-pack 能输出 source target coverage，把 runnable target 的调度与结果状态回流到研究包。
- [x] coverage 能区分 succeeded 与 degraded，源退化会进入 backlog 排查动作，不会被误读成可用证据。
- [x] coverage 能把 DB-backed source-check failure 归类成 missing credentials、target config、source unreachable/response、rate limit、adapter error 或 unknown failure，供 Gate 1 排障和后续前端动作分流。
- [x] investigation backlog 能根据 source target coverage 给出同步、启用、运行、等待、排错或 review observation 的具体 action。
- [x] research-pack 能输出 `attention-queue.json/md`，统一即时 review / alert / source degraded / change attention 入口。
- [ ] 公司切换仍需等多公司 export/fixture 完善后补；目标形态是输入上市公司名或 ticker 后走实体解析、官方源发现、source-plan 和 coverage/backlog，不为每个研究对象新增公司专属 supplier workflow。

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
[x] research-pack 能把 observation coverage 作为只读研究产物输出
[x] Workbench / research-pack 能把即时维护信号输出为 attention queue
[x] observations/leads 不会进入 Neo4j fact edge
[x] claim / observation / lead 写入路径产生语义级 changes
[x] review / unknown 写入路径产生语义级 changes
[x] LLM 仍然不能直接写 edge/claim
```
