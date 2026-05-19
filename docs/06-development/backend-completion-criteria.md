# Backend Completion Criteria — 后端完成门槛

本文是 SupplyStrata 后端是否“完成”的权威判断标准。旧的 `v0.2-alpha-plan.md`、`release-criteria.md`、`midterm-intelligence-network-plan.md` 仍然有效，但它们只代表阶段性里程碑，不再代表后端完成。

## 核心判断

SupplyStrata 当前已经有一套可审计的事实图谱底座：

```text
公开源 -> 标准化文档 -> 关系候选 -> 实体解析 -> 证据评分 -> review/apply -> fact edge / claim / observation / lead / unknown
```

但“全球供应链监控系统”的后端还差一层派生能力：

```text
Fact Layer
  事实边、证据、claim、unknown

Observation Layer
  财报指标、贸易流、能源/商品、政策、新闻、物流、设施观测

Risk / Intelligence Layer
  关系强度、集中度、瓶颈、暴露、变化信号、风险传播、告警
```

**结论：后端完成不能只看事实边能不能跑通。只有事实层、观测层、风险派生层都稳定，才能说后端完成。**

方法学细节见 [intelligence-methodology.md](../03-data-model/intelligence-methodology.md)。本文的 gate 只列验收门槛；具体算法边界、输入输出和禁止事项以方法学文档为准。

## 不可违反的边界

### 1. `evidence_level` 不是 `risk_score`

`evidence_level` 只回答一个问题：

```text
这条事实有没有可靠证据？
```

它不回答：

```text
这条关系有多重要？
这个节点出事影响多大？
供应链是否脆弱？
```

因此禁止：

- 把 `evidence_level` 当风险分数。
- 因为风险看起来高，就提升事实边等级。
- 在 `edges` 上直接写没有来源的 `risk_score`。

风险只能是派生视图，必须能追溯到事实边、观测和计算方法。

### 2. 事实层必须保持纯净

事实层只能保存可追溯事实：

- `edges`
- `evidence`
- `claims`
- `unknown_items`
- source provenance

以下内容不能写成事实边：

- 宏观贸易趋势。
- 新闻热度。
- 港口拥堵。
- 商品价格变化。
- 单条 BOL 或灰色来源线索。
- LLM 判断。
- 风险模型输出。

这些只能进入 `observations`、`lead_observations`、`risk_views` 或 review queue。

### 3. Risk / Intelligence Layer 必须独立

可以在本仓库实现，也可以后续拆成 `apps/risk-engine`，但它必须通过稳定契约消费事实层，不允许反向污染事实层。

推荐边界：

```text
packages/risk-view
  输入：edges / claims / observations / leads / unknowns
  输出：risk view DTO、graph metrics、alerts
  禁止：写 edges、提升 evidence_level、自动 approve review candidate
```

## 后端完成的十个 gate

任何一个 gate 未完成，都不能说 SupplyStrata 后端完成。

### Gate 1 — 官方披露事实边覆盖

目标：事实图谱不只靠 NVIDIA 10-K。

必须完成：

- SEC EDGAR 覆盖 `10-K / 10-Q / 20-F / 8-K` 的持久化监控链路。
- DART-KR 接入，用于 Samsung / SK Hynix 等韩国公司监管披露。
- EDINET 接入，用于日本半导体、材料、设备公司披露。
- 至少一个非美国/非日韩市场披露源进入 source registry 和 connector 计划，例如 HKEX、SGX、TWSE、上交所/深交所公告中的一个。
- 每个 adapter 有 contract test：`plan -> fetch -> normalize -> source monitor event`。

完成标准：

```text
[ ] 至少 25 个核心研究节点有官方披露 source coverage
[ ] 至少 100 条 Level 4/5 fact edge
[ ] 至少 30% fact edge 有第二来源 corroboration 或明确标为 single-source
[ ] 任一 fact edge 都能追到 evidence_id、doc_id、source_url、cite_text、offset/fingerprint
```

参考官方源：

- SEC EDGAR 官方检索与 API 入口：<https://www.sec.gov/search-filings>
- OPENDART Open API：<https://engopendart.fss.or.kr/intro/main.do>
- EDINET API v2 由日本 FSA 提供，项目应使用官方 API 规格和 `api.edinet-fsa.go.jp`，不依赖非官方镜像作为事实来源：<https://disclosure2.edinet-fsa.go.jp/week0020.aspx>

### Gate 2 — 财报/年报结构化指标

目标：年报财报不只是抽几句供应商文本，而是变成可比较的供应链前导指标。

当前状态：SEC companyfacts JSON 第一版已落地为 `sec-edgar/sec-company-facts` source-check target。它读取官方 `https://data.sec.gov/api/xbrl/companyfacts/CIK<10-digit>.json`，按指标 catalog 解析 inventory、cost of revenue、capex、purchase obligations、accounts payable 和 revenue，并写入 company-scoped `FINANCIAL_METRIC_OBSERVATION`。同一 metric/unit 会保留上一期 observation 作为 `baseline_value` 并计算 `change_value / change_percent`，供 observation anomaly 和研究输出复用。`config/source-policies.example.json` 已配置 NVIDIA / AMD / Micron / Intel / Microsoft 五家公司 companyfacts target，并由 source-management 单测校验 target 可运行。`segment_revenue` 和 customer concentration 不用总收入 tag 伪造，后续需要维度/文本证据增强。该路径只消费结构化 JSON，不解析 PDF，不写 fact edge；每个 observation provenance 记录 accession、form、filed、taxonomy tag 和 source URL。`@supplystrata/evidence-maintenance` 已提供 `refreshFinancialMetricPeerComparisonViews()`：它只比较同 metric、unit 和 fiscal period 的公司级观测；缺 fiscal period 的旧观测才退回到精确 time window 对齐。样本数达到阈值后写入 `financial_metric_peer_zscore` risk metric，并在 attrs 中保存 percentile、rank、peer_count、mean/stddev 和 peer ids。CompanyCard / research-pack 会把这些指标作为 financial peer position 带进 JSON/Markdown。该结果是同行位置上下文，不是事实边、不是风险分，也不推断供应关系。

必须完成：

- SEC companyfacts / XBRL company facts 结构化读取。
- 指标 catalog：inventory、cost of revenue、capex、purchase obligations、accounts payable、customer concentration、segment revenue。
- 公司内跨期序列：至少 12 个季度或 5 个年度。
- 同行横向比较：同一指标在同行之间做 z-score 或 percentile。
- 指标 provenance：每个数值能追溯到 accession、period、taxonomy tag 和 source URL。

完成标准：

```text
[x] NVIDIA / AMD / Micron / Intel / Microsoft 至少 5 家公司有财报指标时序
[x] ComponentCard 能展示相关财报指标变化，而不是只展示文本边
[x] changes timeline 能展示指标拐点或显著变化
[x] 同一指标同一期间能生成 deterministic peer z-score / percentile
[x] CompanyCard / research-pack 能展示 company financial peer position
```

### Gate 3 — 关系强度与时间衰减

目标：事实边从“有/无”升级到“有多重要、多久没验证”。

当前状态：第一版 schema 和导出契约已经落地。`edge_strength_estimates` 用显式业务身份键做幂等 upsert，`edge_freshness` 保存确定性的 `methodology.v1` 新鲜度结果；`@supplystrata/workbench-export` 会把两者作为 `intelligence.edge_strengths / intelligence.edge_freshness` 导出。它们仍然是 intelligence context，不改变 `edges.evidence_level`。

新增后端可运行路径：

```bash
pnpm cli intelligence refresh --min-evidence-level 4 --limit 1000
pnpm cli research run --company nvidia --depth 3 --out reports/nvidia-research-pack
```

`intelligence refresh` 是薄 CLI 入口，业务编排在 `@supplystrata/evidence-maintenance`。`research run` 默认会先刷新 edge intelligence context，再筛出当前研究包里已有 Level 4/5 component fact edge 的 eligible 组件刷新 component risk baseline，最后导出 Workbench / CompanyCard / ComponentCard / ChainView / question readiness；需要完全只读打包时同时使用 `--skip-intelligence-refresh --skip-component-risk-refresh`。

必须新增或等价实现：

```text
edge_strength_estimates
  edge_id
  strength_kind: share | spend_band | dependency | capacity | qualitative
  value
  lower_bound
  upper_bound
  unit
  evidence_id
  method
  valid_from
  valid_to

edge_freshness
  edge_id
  last_verified_at
  decay_model
  freshness_score
```

规则：

- `share_estimate` 可以为空。未知就明确 unknown，不许伪造。
- 匿名客户集中度只能生成 observation 或 unknown 约束，不能自动命名客户。
- 旧证据不删除，但风险派生层必须知道它是否过期。

完成标准：

```text
[x] edge_strength_estimates / edge_freshness schema 已落库
[x] WorkbenchModel 可导出 strength / freshness context
[x] Level 4/5 fact edge 可通过 refresh 获得 strength 或 edge-scoped explicit unknown
[ ] 过期/未复核边在 risk view 中自动降权
[x] CompanyCard / ComponentCard / ChainView / research-pack 能显示 strength、freshness 和 strength unknown context
```

### Gate 4 — Claim 层多源融合

目标：解决单条 evidence min-cap 的天花板问题。

必须完成：

- claim 支持多 evidence 聚合。
- claim 记录 source independence：自披露、对手方披露、供应商披露、政府/监管、第三方观测。
- claim confidence 由多源融合计算，而不是只取单条边最高证据。
- 融合算法必须确定性、可解释、可测试。

推荐第一版：

```text
Noisy-OR 或 Dempster-Shafer 的简化确定性版本。
```

禁止：

- 多条弱新闻把事实边升到 Level 4/5。
- LLM summary 参与证据融合。
- 在 evidence scorer 单条打分阶段偷偷 promotion。

完成标准：

```text
[ ] 同一 relation claim 可列出支持源、反证源和 unknown
[ ] claim confidence 有 regression fixtures
[ ] conflicting evidence 会生成 CONFLICTING_EVIDENCE unknown 或 conflict state
```

### Gate 5 — Observation / Signal 层

目标：建立真正的供应链信号，而不是把 signal 当正则背景句。

必须完成至少五类 observation：

```text
FINANCIAL_METRIC_OBSERVATION
TRADE_FLOW_OBSERVATION
COMMODITY_PRICE_OBSERVATION
ENERGY_PRICE_OBSERVATION
POLICY_OBSERVATION
NEWS_EVENT_OBSERVATION
PORT_ACTIVITY_OBSERVATION
PROCUREMENT_OBSERVATION
```

第一批免费源优先级：

- U.S. Census International Trade API：官方月度贸易数据，适合 HS / country / district 观测。
- USITC DataWeb API：美国进出口与关税数据，适合补充 Census trade view。
- EIA API：能源价格与电力/燃料数据。
- FRED API：宏观时间序列。
- GDELT 2.0：新闻/事件线索，只进 observation / lead。
- BIS Entity List、OFAC sanctions、EU sanctions：政策与管制 observation。

参考官方源：

- Census International Trade API：<https://www.census.gov/data/developers/data-sets/international-trade.html>
- USITC DataWeb API：<https://www.usitc.gov/applications/dataweb/api/dataweb_query_api.html>
- EIA API：<https://www.eia.gov/opendata/documentation.php>
- FRED API：<https://fred.stlouisfed.org/docs/api/fred/overview.html>
- GDELT 2.0：<https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/>
- BIS Entity List：<https://www.bis.gov/entity-list>
- OFAC Sanctions List Service：<https://ofac.treasury.gov/sanctions-list-service>

完成标准：

```text
[ ] observations 有统一 source_item / time_window / metric / geography / component_id
[ ] observations 不会被 graph-builder 当成 fact edge
[ ] 至少 3 类 observation 能在 ComponentCard / ChainView 中显示
[x] 至少 1 类 observation 有变化检测
```

当前新增：`FINANCIAL_METRIC_OBSERVATION` 已由 SEC companyfacts 结构化 JSON 写入，source item / doc / time window / metric / company scope / provenance 均走 observation-store，不进入 graph-builder。

当前状态：`@supplystrata/evidence-maintenance` 提供 `refreshObservationAnomalyViews()`，薄 CLI 入口如下：

```bash
pnpm cli intelligence observation-anomalies --limit 1000 --threshold-percent 25 --z-threshold 3.5
```

该能力优先读取已有 `baseline_value / change_percent` 或可由 `metric_value / baseline_value` 复算的 observation；没有显式 baseline 时，会批量查找同一 observation type、scope、geography、component、metric 和 unit 的可比较历史点，用 trailing median/MAD 计算 z-like anomaly。输出写入 observation-scoped `risk_views / risk_metrics`，metric kind 为 `observation_anomaly`。真实异常会幂等写入 `OBSERVATION_ANOMALY` semantic change，供 changes timeline / alert rules 消费；timeline 会展示 metric、observation scope、baseline、change percent、severity 和 source/doc 上下文。它不写 `edges`，不把 observation 升级成事实关系。CompanyCard / ComponentCard / research-pack 在已有 anomaly view 时展示 anomaly summary；ComponentCard 还会把当前组件 Level 4/5 fact edges 上的 supplier/consumer 公司财务 observations 作为 linked company financial signals 带入组件上下文。历史不足或不可比较的 observation 继续保持普通 observation，而不是伪造异常。

### Gate 6 — 图算法与风险派生视图

目标：从“能画链路”升级为“能识别瓶颈、集中度、单点失效和传播影响”。

必须完成：

```text
risk_views
  risk_view_id
  scope_kind
  scope_id
  generated_at
  model_version
  inputs_fingerprint
  summary

risk_metrics
  risk_view_id
  metric_kind:
    supplier_concentration_hhi
    single_source_exposure
    path_redundancy
    freshness_adjusted_exposure
    betweenness_centrality
    node_knockout_reach
    node_knockout_weighted_impact
  subject_kind
  subject_id
  component_id
  value
  confidence
  provenance
```

第一版算法：

- HHI by component：已实现 deterministic baseline；只有完整 share 输入时写数值，缺 share 时写 explicit unknown context。
- single-source exposure：已实现 component baseline，来自单一供应商 topology 或明确 `dependency=single_source`。
- path redundancy / alternate supplier count：已实现 direct component supplier baseline；多跳 chain graph redundancy 仍待补。
- freshness-adjusted exposure：已实现 experimental baseline，消费 edge strength + freshness，不污染事实层。
- node knockout reachability：已实现 directed component fact-edge reachability baseline。
- node knockout weighted impact：已实现 strength/freshness max-product propagation baseline；缺权重边显式暴露，不补值。
- betweenness centrality：已实现 directed component fact-edge graph baseline；加权多跳传播仍待补。
- risk metric semantic change：已实现 component risk view 对上一版指标的稳定 key 对比；超过每类指标绝对阈值或 25% 相对阈值时，写入 `RISK_METRIC_CHANGED`，供 timeline / alert rules 后续消费。

规则：

- 风险指标是派生结果，不写回 fact edge。
- 每个指标必须记录输入数据版本和模型版本。
- 没有 relation strength 时，指标必须显示不确定性，不能假装精确。

完成标准：

```text
[x] ComponentCard 能显示集中度和单点失效候选
[x] CompanyCard 能显示 top exposure nodes
[x] risk metrics 可重算且结果 determinism test 通过
```

### Gate 7 — 持续监控与告警

目标：从“一次性研究工具”升级为“持续运行系统”。

必须完成：

- job queue。可以是 `pg-boss` 或等价 Postgres-backed queue。
- source_check_targets 支持 per target cadence、jitter、priority、failure policy。
- semantic change events：`EDGE_ADDED`、`EDGE_UPDATED`、`EDGE_DEPRECATED`、`CLAIM_CHANGED`、`OBSERVATION_ANOMALY`、`SOURCE_FAILED`。
- alert rules：基于 observation、risk metric、source failure、new official filing。
- alert lifecycle：`open / acknowledged / resolved / suppressed` 的状态变更必须可审计。
- dead-letter / retry / backoff。

完成标准：

```text
[x] sources run-due 不再是人工 CLI 主路径，而有常驻 worker loop
[x] 任一 source failure 不会被 cached fallback 误记为成功
[x] changes timeline 能区分 raw document change、semantic change、risk change
[x] source check 有 durable job/outbox、claim、retry/backoff 和 dead 状态
[x] 持续监控 cadence、jitter、priority、初始检查时间和 retry/backoff 统一由外部 source policy config 配置
[x] due/run-due 支持按 source-plan namespace、check_target_id 或 source adapter 小批量过滤，避免一次运行全局 due 队列
[x] source target coverage 能区分 succeeded 与 degraded，避免 cached fallback / 源退化被误读成完全成功
[x] alerts 只引用 risk_view / observation，不直接改变事实层
[x] alert 状态维护会记录 `ALERT_STATUS_CHANGED` semantic change
```

当前状态：`source_check_jobs` 已提供 Postgres-backed durable job/outbox；`sources run-due` 会先 enqueue due target，再用 `FOR UPDATE SKIP LOCKED` claim job，失败写入 `failed` 并按 backoff 重试，超过 `max_attempts` 进入 `dead`。`sources due/run-due` 支持按 `source-plan.json + namespace`、`check_target_id` 或 source adapter 过滤小批量目标；过滤只限制 enqueue/claim 范围，不改变 source policy 或 target config。`apps/worker` 已提供常驻 source-check worker loop，负责按固定 poll interval 复用同一条 `runDueSourceChecks()` 业务路径；CLI 不再是唯一执行入口。cadence、jitter、priority、初始 `next_check_at`、max attempts 和 backoff 已统一收口到外部 source policy config：source policy 提供默认值，target 可覆盖，enqueue 阶段不再接受调用方绕过配置传入 retry 参数。cached fallback 会记录 `SOURCE_DEGRADED`，不会被误记为成功；coverage 会把 latest event 为 `SOURCE_DEGRADED` 的 target 标成 `degraded`，即使 job 本身已完成，也不会被解释为完全成功。`OBSERVATION_ANOMALY` 已由 observation anomaly refresh 幂等写入 `change_records`，并被 changes timeline 标记为 requires attention。`RISK_METRIC_CHANGED` 已由 component risk refresh 在新版 risk view 与上一版指标存在实质变化时写入，changes timeline 会把它归为 risk family。`refreshAlertCandidates()` 已能从 observation anomaly、source failure 和 component risk metric 生成 `alert_candidates`，并通过 `dedupe_key` 去重；alert 只引用 `observation / risk_view / risk_metric / change / source_event`，不写事实边。`updateAlertCandidateStatus()` 和 CLI `intelligence alert-status` 已支持状态维护，并用 `scope_kind='alert'` 写入 `ALERT_STATUS_CHANGED` semantic change。通知通道仍未完成。

### Gate 8 — API 与嵌入契约

目标：后端能被正式前端和外部 agent/app 消费。

必须完成：

```text
GET /companies/:id/card
GET /components/:id/card
GET /chains/:scope
GET /claims/:id
GET /evidence/:id
GET /observations
GET /risk-views/:scope
GET /changes
GET /sources/health
POST /review/:id/approve
POST /review/:id/reject
```

要求：

- API DTO 不泄漏 DB row。
- JSON schema / OpenAPI 版本化。
- WorkbenchModel 继续保留离线导出能力。
- GraphStore / DatabaseStore 可由宿主 app 注入。
- research-pack 输出 `question-readiness.json/md`，把核心问题标为 ready / partial / blocked，并列出 supporting refs、missing requirements 和 unknown ids；它只评估可答性，不生成自然语言结论。
- research-pack 输出 `investigation-backlog.json/md`，把 readiness gap、explicit unknown、组件覆盖缺口和 source-plan item 汇总为可审计调查任务；它只规划，不抓取、不落库、不写事实边。
- source-plan 支持在显式 `officialDisclosureYear` 存在时，把已注册官方 IR connector 生成 runnable `official-html-disclosure` target；无年份时保持 planned，避免猜默认披露期。
- source-management 提供 `source-plan.json` 到 `source_check_targets` 的稳定转换；CLI 只做 `sources policy sync-plan-targets` / `enable-plan-targets` 薄入口，默认 disabled，审计后可用同一 `source-plan.json + namespace` 受控启用已同步 target，并统一写入 target 级 cadence / jitter / retry / `next_check_at` 覆盖值。
- source-monitor 通过 `source_change_events.check_target_id` 保留 target 级事件链；research-pack 输出 `source-target-coverage.json/md`，把 runnable target 的 sync、enable、due、job、event、observation 状态回流到研究包，并让 `investigation-backlog` 的 action 随 coverage 状态变化。

完成标准：

```text
[ ] apps/api 有 contract tests
[ ] research-preview 或未来正式前端只消费 API/Workbench DTO
[ ] 无 Docker snapshot path 与 DB-backed path 都保留
[x] research-pack 能输出 question readiness matrix
[x] research-pack 能输出 investigation backlog，供人工或后续安全 agent 消费
[x] research-pack/source-plan 能把官方 IR 年份配置转成 runnable target suggestions
[x] runnable source-plan target suggestions 能同步到 source_check_targets，并复用统一监控频率/重试配置入口
[x] 已同步 source-plan target 能在审计后受控启用，并把调度参数继续收口到 source policy/target config
[x] research-pack 能输出 source target coverage，展示 runnable target 是否已同步、启用、due、运行、失败或产出 observation
[x] investigation-backlog 能消费 source target coverage，把下一步 action 从通用 source check 提示细化为同步、启用、运行、等待、排错或 review observation
[x] research-pack 默认刷新 eligible component risk baseline，并在 manifest 记录 considered / eligible / refreshed / metrics_written
```

### Gate 9 — Agent / LLM 安全接入

目标：让 LLM 做复杂判断和调查规划，但不污染事实层。

允许的 agent：

- Unknown-driven investigation agent：从 unknown 出发生成 source plan、运行 adapter、产出 lead/review candidate。
- Report/explanation agent：基于 claims / evidence / observations / risk_view 写人类可读报告。
- Query assistant：把自然语言问题翻译成只读查询。

禁止：

- LLM 直接写 `edges`。
- LLM 自动 approve review candidate。
- LLM 提升 `evidence_level`。
- LLM 把 observation 解释成 fact edge。

完成标准：

```text
[ ] LLM 输出都有 schema validation
[ ] cite_text 必须是原文子串或引用已有 evidence_id
[ ] 所有 agent write path 都进入 review queue
[ ] audit log 能复现 agent 输入、输出、模型、prompt version
```

### Gate 10 — 质量、性能、可维护性

目标：系统能长期扩展，不靠补丁。

必须完成：

- 每个 source adapter 都有 contract test。
- 每个 extractor rule pack 有 positive / negative fixtures。
- EntityResolver golden set 持续扩充，关键实体 false merge 零容忍。
- 50 万 entity/edge 规模下的 chain/risk query benchmark。
- 所有跨表写入有事务边界。
- DTO / DB row / domain type 不混用。
- 文档与代码差异有检查或明确维护流程。

完成标准：

```text
[ ] pnpm type-check / lint / dep-check / unit / contract / integration / perf baseline 全绿
[ ] 每个新增 domain/feature 遵守 definitions / functions / orchestration 分层
[ ] docs/06-development/code-quality-hardening.md 无 P0/P1 open item
```

## 远期方法学：概率与贝叶斯层

贝叶斯更新、概率图模型、因果图和供应链冲击概率传播是远期方向，不计入当前后端完成门槛。

启动条件：

```text
[ ] 事实层 Level 4/5 precision 已校准
[ ] observation time series 足够长
[ ] relation strength / freshness 已稳定
[x] risk_view 已有确定性 baseline
[x] 有人工 review gold label/run 契约可用于 calibration
[ ] 人工 gold set 样本量足够并完成季度 precision 校准
```

边界：

- 概率模型只能生成 `risk_view`、`alert_priority` 或 `investigation_priority`。
- 不允许用概率模型提升 `evidence_level`。
- 不允许用概率模型自动写入 fact edge。
- 没有校准样本的概率输出必须标 `experimental`。

详见 [intelligence-methodology.md](../03-data-model/intelligence-methodology.md) 的 `Probabilistic Intelligence Layer`。

## 当前状态盘点

| 能力                        | 当前状态                           | 判断                                                 |
| --------------------------- | ---------------------------------- | ---------------------------------------------------- |
| SEC / 10-K 事实边           | 已可用                             | 事实底座成立                                         |
| 10-Q / 8-K plan/fetch       | 已接入                             | 尚需深度语义变化                                     |
| Apple Supplier review/apply | 纵向链路已通                       | 设施边需要继续做厚                                   |
| IR 年报页面                 | TSMC/Samsung/SK hynix/ASML preview | 官方上下文可用，事实边偏薄                           |
| Claim / Observation / Lead  | 已建骨架                           | 需要时序、融合、风险派生                             |
| ChainView / Workbench       | 已可视化第一版                     | 不是正式前端，不是完整分析系统                       |
| Census / WorldBank          | 第一版 observation target          | 需要变化检测与 ComponentCard 深接                    |
| DART / EDINET               | 未实现                             | 官方披露覆盖短板                                     |
| 新闻 / 政策 / 制裁          | registry/计划层                    | 信号层短板                                           |
| 图算法 / 风险视图           | deterministic baseline 已实现      | 多跳冗余、weighted centrality 和样本校准仍是核心缺口 |
| API / 告警 / worker         | 告警/worker baseline 已实现        | API 与通知通道仍是产品化后端缺口                     |

## 后续执行顺序

### Phase A — 先把现有数据跑深

不急着继续堆新源，先把已有官方披露和财报变成指标与强度。

```text
1. SEC companyfacts / XBRL 指标读取
2. 财报指标时序与同行横向
3. relation strength / freshness schema
4. claim 多源融合 ADR + 第一版实现
```

### Phase B — 官方披露扩源

```text
1. DART-KR
2. EDINET
3. 一个非美日韩市场披露源
4. adapter contract tests
```

### Phase C — Observation / Signal 层

```text
1. Census / USITC trade flow
2. EIA / FRED / WorldBank commodity/energy
3. GDELT news lead
4. BIS / OFAC / EU sanctions policy observation
5. observation anomaly detection
```

### Phase D — Risk View

```text
1. HHI / concentration
2. path redundancy
3. centrality / bottleneck
4. exposure model
5. risk_view API / workbench display
```

### Phase E — 持续监控产品化

```text
1. worker queue
2. alert rules
3. read API
4. official frontend / host app integration
5. safe agent layer
```

## 后端完成判定

只有下面这句话成立时，才可以说后端基本完成：

```text
给定一个公司、组件或外部事件，系统能用公开源自动维护事实图谱，
用结构化观测解释变化，用风险派生视图计算暴露和瓶颈，
用 unknown map 说明盲区，并通过 API / Workbench 给下游可靠消费。
```

现在还不能这么说。当前更准确的状态是：

```text
事实图谱与研究工作台骨架成立；
后端正在从 evidence graph 迈向 intelligence network；
风险监控层尚未完成。
```
