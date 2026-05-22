# Backend Completion Criteria — 后端完成门槛

本文是 SupplyStrata 后端是否“完成”的权威判断标准。旧的 `v0.2-alpha-plan.md`、`release-criteria.md`、`midterm-intelligence-network-plan.md` 仍然有效，但它们只代表阶段性里程碑，不再代表后端完成。

如果其它路线图、Phase 文档或模块文档与本文冲突，以本文为准。`roadmap.md` 是历史阶段记录；本文的十个 gate 才是“能否称为全球供应链监控后端完成”的判断标准。

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

## 产品成熟度边界

当前对外最稳妥的表述是：

```text
一个证据优先、公开数据驱动、面向关键技术产业链研究的供应链情报图谱 alpha。
```

不要把当前状态包装成：

- 全球供应链监控系统。
- 实时或准实时货物流追踪平台。
- 自动供应链发现系统。
- 成熟风险评分 / 风险提示产品。
- 投资推断或投资建议系统。

本文的十个 gate 完成前，项目只能称为 evidence-backed supply-chain intelligence workbench / alpha。尤其要区分四类成熟度：

| 维度     | 当前判断                                                    | 后端完成前必须补齐                                                   |
| -------- | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| 全球监控 | 官方披露与 source monitor baseline 已有                     | 多市场官方披露覆盖、足量 Level 4/5 边、API/worker 产品化闭环         |
| 风险提示 | deterministic risk baseline 已有                            | 校准样本、可解释风险模型、alert 消费路径和误报治理                   |
| 动态追踪 | document/source/risk change + attention queue baseline 已有 | relation diff、evidence supersession timeline、正式消费 API/产品入口 |
| 货物流向 | trade/material/source-plan observation 起步                 | trade/port/route observations、review 后 inferred edge、弱信号隔离   |

这个边界不是自我否定，而是保护项目最核心的价值：可信度优先。覆盖规模、风险算法和货物流推断都必须在证据、观测、线索、未知的分层上增长，不能用“看起来完整”的图来替代可审计数据。

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
- DART-KR 接入，用于 Samsung / SK Hynix 等韩国公司监管披露。当前至少要先做到 official source monitor / target / readiness 覆盖；正文下载、韩文/HWP 解析可留后续阶段。
- EDINET 接入，用于日本半导体、材料、设备公司披露。当前至少要先做到 `documents.json` daily-filings 目录监控、target 和 readiness 覆盖；XBRL ZIP / PDF 正文下载解析可留后续阶段。
- 至少一个非美国/非日韩市场披露源进入 source registry 和 connector 计划，例如 HKEX、SGX、TWSE、上交所/深交所公告中的一个。当前已接入 `twse-mops/electronic-documents` 目录 monitor，作为 Hon Hai / Quanta 等台湾 AI server ODM 节点的官方披露覆盖入口；PDF 正文下载、解析和关系抽取仍待后续。
- GLEIF LEI 作为跨市场实体标识锚点进入 entity lookup / review 候选流，服务 SEC、DART、EDINET、TWSE/HKEX 等后续官方源的实体对齐；它只生成实体候选，不写事实边。
- 每个 adapter 有 contract test：`plan -> fetch -> normalize -> source monitor event`。

完成标准：

```text
[ ] 至少 25 个核心研究节点有官方披露 source coverage
[ ] 至少 100 条 Level 4/5 fact edge
[ ] 至少 30% fact edge 有第二来源 corroboration 或明确标为 single-source
[ ] 任一 fact edge 都能追到 evidence_id、doc_id、source_url、cite_text、offset/fingerprint
```

当前可观测能力：`research-pack` 已输出 `official-disclosure-readiness.json/md`，把当前研究包可见的逐节点覆盖状态、内置研究 target profile、显式 target node 覆盖、profile expansion candidates、Level 4/5 fact edge 数、完整 traceability、严格 cross-source corroboration、strength/freshness 覆盖、explicit unknown 和官方披露 source target 状态量化，并把未达标项转成 `investigation-backlog` 的 `official_disclosure_coverage` / `profile_expansion` 任务。该报告还内置 Gate 1 scorecard，把 core node coverage、Level 4/5 fact edge coverage、cross-source corroboration、fact edge traceability 和 expected source path coverage 拆成可重复计算的进度项；其中 data progress 只看事实/证据硬指标，source path progress 只看预期官方源是否已经接到 source-plan/target/observation 路径，不能把 connector 存在误读成事实覆盖。针对 data progress 中最弱的 corroboration，报告会输出 edge-level corroboration queue：每条 single-source / missing-evidence L4/L5 edge 都会带出现有来源、候选 counterparty/profile source、可运行 target、linked unknown、proposed single-source disposition unknown 和处置动作；没有二源路径且没有已记录 disposition unknown 时，会生成确定性 proposed unknown payload。`@supplystrata/evidence-maintenance` 已提供受控落库用例，可把这些 payload 写成 edge-scoped `unknown_items`，并默认跳过不存在或已失效的 edge；这仍然不能把单源沉默自动解释成 corroboration，也不能写 fact edge。`investigation-backlog` 会把这些 queue item 转成逐 edge `corroboration_review`，`corroboration-source-plan.json/md` 则把 review 里的 runnable target 去重成标准 source-plan 子集，可直接交给 source-management 的 preview / smoke / sync / enable 命令；该文件只进入监控配置链路，不抓取、不写 observation、不生成事实边。`ai-compute-memory.v0` 是内置确定性验收锚点，会在选中公司或组件命中 AI compute/memory 范围时自动启用；它不是全球供应链全集。不在 profile 中但已被事实边或官方 source-plan 发现的节点会作为 expansion candidate 输出，等待人工或后续安全 AI 审阅。

Gate 1 现在还会输出 `expected_source_coverage`：把每个 target node 的 `expected_source_ids` 拆成独立覆盖项，并标记为 `covered_fact`、`official_target_with_observation`、`official_target_synced`、`official_target_runnable`、`official_source_planned`、`connector_available`、`source_registered_unimplemented` 或 `missing_source_mapping`。这一步很关键：profile 写了某个官方源并不代表覆盖完成。`connector_available` 只说明后端已有该源的 source-check connector，但当前节点还没有被 source-plan/target 具体接上；`source_registered_unimplemented` 只说明来源在 registry 中，仍需要 connector 或人工 review workflow。`expected_official_source_coverage` gap 会优先提示这些缺口，防止把“期望来源清单”误读成“已监控数据源”。

`source-plan` 已能消费 target profile 的官方源 hints：对内置 profile 中带 SEC CIK 的美国上市公司，会生成 `sec-edgar/sec-company-filings` runnable target suggestion，且不要求传入披露年份；对 TSMC / Samsung / SK hynix / Micron / ASML 这类已有官方 IR connector 的来源，会在显式 `officialDisclosureYear` 存在时生成 node-specific `official-html-disclosure` runnable target suggestion；对长尾公司，`company-ir/official-html-disclosure` 只在 profile、review 或 host app 已提供审计过的 HTTPS `url + entity_id + year` 时生成 runnable target，不做自动发现、不猜 IR 页面；Samsung / SK Hynix 的内置 profile 还会在给定 `officialDisclosureYear` 时生成 `dart-kr/company-filings` runnable target suggestion，使用项目内维护的 OpenDART corp code 模板并在 source-plan 阶段覆盖年份；AI compute/memory profile 里的 silicon wafer / ABF substrate 目标会在给定 `officialDisclosureYear` 时生成 `edinet/daily-filings` runnable target suggestion，先监控日本 EDINET 年报季目录元数据；Foxconn / Quanta 目标会在给定 `officialDisclosureYear` 时生成 `twse-mops/electronic-documents` runnable target suggestion，先监控台湾 MOPS 电子文件目录元数据；manufacturing-services 目标会生成 Apple Supplier List FY2022 的 `apple-suppliers/supplier-list-review` runnable target suggestion。Apple 这条路径只把官方供应商名单接入 review candidate、facility lead 和后续 OSH 交叉检查，不自动写 `edges`；DART / EDINET / TWSE 当前只落官方披露目录元数据和 source monitor event，不自动下载/解析正文、不写事实边。readiness 会按节点过滤 source targets，不能把聚合 source-plan item 中其它节点的 target 算作当前节点 coverage。缺少显式 URL 的 `company-ir` 目标、缺少公司级 EDINET code 的更细目标，仍保留为 `connector_available` 或相关配置缺口，不会被 source-plan 伪装成已接通监控。

Gate 1 的 core node 指标按目标节点中已有 fact/source-plan/target/observation 覆盖的数量衡量，未出现在当前 Workbench 里的目标节点也会显式显示为 `missing`。该报告只是 Gate 1 的仪表盘，不会把 single-source silence 自动解释为已审计 single-source，也不会写事实边；真实覆盖数量仍需继续补足。

无数据库连通性 smoke 已补上：`sources policy smoke-plan-targets` 会从同一个 `source-plan.json + namespace` 生成 runnable target，复用 source-check 的 target config 解析和 adapter，执行 `plan / fetch / normalize`，但不连接 Postgres、不写 `source_check_targets`、不写 source monitor event、不写 observation / fact edge。source-check connector capability 现在统一声明 target 级 `credential_requirements`，source-management catalog / preview 和 smoke 都读取同一份凭据契约；缺失凭据会在访问外部源前归类为 `missing_credentials`，并在 preflight item / investigation backlog coverage 中结构化输出缺失 env key，不会散落成各命令自己的字符串判断。它用于同步和启用前发现外部源不可达、凭据缺失或 target config 失效；smoke 成功不等于进入持续监控闭环，正式调度仍以 `sync-plan-targets / enable-plan-targets / due / run-due / worker` 为准。

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
[x] 过期/未复核边在 risk view 中自动降权
[x] CompanyCard / ComponentCard / ChainView / research-pack 能显示 strength、freshness 和 strength unknown context
[x] `official-disclosure-readiness` 的 single-source disposition `proposed_unknown` 可通过 evidence-maintenance 受控落库为 edge-scoped explicit unknown，默认只处理仍为 current 的 fact edge，且不写事实边
```

当前新增：component risk baseline 的 `supplier_concentration_hhi` 已从纯 share HHI 改为 freshness-adjusted baseline：只有在 share 和 freshness 都可追溯时才计算，计算时每条供应商 share 会先乘对应 `edge_freshness.freshness_score`，同时在 attrs 中保留 `raw_hhi`、`supplier_share_inputs`、`missing_share_edge_ids` 和 `missing_freshness_edge_ids`。这不会改变 fact edge 或 evidence_level；它只让陈旧/未复核关系在派生 risk view 中降权。

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

当前状态：

`packages/claim-builder` 已接入第一版 deterministic Noisy-OR 融合：同一 current fact edge 下未 supersede、非 inferred 的 evidence 会按 `primary` / `supporting` 写入 `claim_evidence`，claim confidence 由 primary confidence 加 source-independence weight 后的 supporting evidence 融合得到。source independence 目前按 same doc / same source adapter / different source adapter 分层，并在 claim semantic change payload 中记录可审计贡献。官方披露 relation `*_REMOVED` 语义变化会生成确定性 `UNK-CONFLICT-*` unknown，并通过 `claim_unknowns` 挂到 draft claim 与匹配到的 active claim；它不会自动 deprecate fact edge。`linkContradictingEvidenceToClaim()` 可以把现有 evidence 以 `claim_evidence.role='contradicting'` 挂到 claim，并生成 blocking conflict unknown；`resolveClaimConflictUnknown()` 通过 unknown resolve 收口并记录 claim-scoped semantic change。Workbench / research-pack 已导出 `evidence_refs`、`unknown_refs` 和派生 `conflict_state`，AI 前置数据可以直接消费 claim 的支持源、反证源和冲突未知。Workbench / research-pack 还会导出 active claim 的 edge lifecycle context；active claim 如果仍挂在 deprecated/historical edge 上，会显示 `active_claim_on_inactive_edge` warning，而不会被默默当成当前事实。claim lifecycle 维护已下沉到 `claim-builder`：`supersede_claim` / `reject_claim` 只更新 claim status，`keep_with_context` 只写上下文，三者都要求可验证 source ref 并写 `CLAIM_LIFECYCLE_ACTION_RECORDED`，不会修改 fact edge。`adjudicateClaimConflict()` 已给出确定性裁决策略：输出 severity、recommended_action、edge_review_required 和 `allowed_edge_mutation='none'`，只建议 review/deprecation，不自动改事实层。`buildClaimConflictReviewPacket()` 已把该裁决包装成 safe-write 审阅包，明确 `review_queue_kind`、`safe_write_status`、`required_review_steps` 和 `automatic_fact_mutation_allowed=false`；Workbench claim DTO 已输出 `conflict_review`，让后续 worker/AI 读取同一结构化安全边界。`enqueueClaimConflictReviewCandidates()` 已能把 unresolved conflict 幂等写入 `review_candidates(kind='claim_conflict_review')`，CLI 只提供 `claims enqueue-conflicts` 薄入口。`review apply` 对 approved claim conflict review 只写 `CLAIM_CONFLICT_REVIEW_APPLIED` 和 `REVIEW_APPLIED` 审计事件，不修改 `edges`、claim status 或 unknown status；rejected / blocked 继续由 review-store 写审计事件。更细的人工 resolution action 已下沉到 `claim-builder`：`confirm_claim_valid` 必须带 resolution evidence 并关闭 linked unknown，`recommend_edge_deprecation` 只记录人工建议，`request_more_evidence` 只记录继续调查需求；三者都写 `CLAIM_CONFLICT_RESOLUTION_ACTION_RECORDED`，并保持 `automatic_fact_mutation_allowed=false`。

禁止：

- 多条弱新闻把事实边升到 Level 4/5。
- LLM summary 参与证据融合。
- 在 evidence scorer 单条打分阶段偷偷 promotion。

完成标准：

```text
[x] 同一 relation claim 可列出 primary / supporting evidence
[x] 同一 relation claim 可列出 conflict unknown
[x] 同一 relation claim 可列出 contradicting evidence source
[x] claim confidence 有 regression fixtures
[x] 官方披露 relation removal 会生成 `CONFLICTING_EVIDENCE` 类 unknown
[x] contradicting evidence 会写入 `claim_evidence.role='contradicting'`
[x] Workbench / research-pack 可导出 claim conflict_state
[x] conflict adjudication policy 完成第一版，且不允许自动改 facts
[x] conflict adjudication 可生成 safe-write review packet，且 Workbench / research-pack 可导出
[x] conflict review packet 可幂等进入持久化 review queue
[x] claim conflict review 的 approved / rejected / blocked 决策接入可审计 safe-write apply path，且不改 facts
[x] claim conflict review 支持更细的人工 resolution action
[x] active claim 挂在 deprecated/historical edge 上时，Workbench / research-pack 输出 lifecycle warning
[x] claim lifecycle 支持 supersede / reject / keep-with-context 人工动作，且要求 source refs、不改 facts
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
PORT_ACTIVITY_OBSERVATION
PROCUREMENT_OBSERVATION
INVENTORY_OBSERVATION
BACKLOG_OBSERVATION
CAPEX_OBSERVATION
CUSTOMER_CONCENTRATION_OBSERVATION
FACILITY_PROFILE_OBSERVATION
```

说明：新闻类公开信号当前应优先进入 `lead_observations`，不能写成不存在的 `NEWS_EVENT_OBSERVATION` 类型，也不能直接升级为事实边。

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
[x] observations 有统一 source_item / time_window / metric / geography / component_id contract
[x] observations 不会被 graph-builder 当成 fact edge
[x] 至少 3 类 observation 能在 ComponentCard / research-pack 中显示
[x] 至少 1 类 observation 有变化检测
[x] research-pack 能输出 observation coverage，列出 present types 与 methodology gaps
[x] research-pack 能输出 observation series readiness，区分 sparse / explicit-baseline ready / time-series ready
[x] investigation-backlog 能把 sparse observation series 转成可执行的数据积累任务
```

当前状态：observation-store 已形成统一写入边界，`FINANCIAL_METRIC_OBSERVATION` 由 SEC companyfacts 结构化 JSON 写入，`TRADE_FLOW_OBSERVATION` 由 Census Trade target 写入，`COMMODITY_PRICE_OBSERVATION` 由 World Bank Pink Sheet target 写入，官方披露语义抽取器可生成 `INVENTORY_OBSERVATION` / `BACKLOG_OBSERVATION` / `CAPEX_OBSERVATION` / `CUSTOMER_CONCENTRATION_OBSERVATION` / `PROCUREMENT_OBSERVATION`，OSH 路径可生成 `FACILITY_PROFILE_OBSERVATION`。这些路径都必须保留 `source_item / doc / time_window / metric / scope / geography / component_id / provenance` 语义，不进入 graph-builder，不生成事实边。

`@supplystrata/research-pack` 已新增 `observation-coverage.json/md`：它从 CompanyCard / ComponentCard / linked company observations 和 ChainView observation segments 汇总本研究包内可见的 typed observation、source adapter、scope、component、geography、metric、样本 id 和缺失 methodology type。它还会按 `observation_type / scope / geography / component_id / metric / unit` 生成 series readiness：有 `baseline_value + change_percent` 的序列标为 `explicit_baseline_ready`；至少 6 个同序列数值窗口点的序列标为 `time_series_ready`；其余保持 `sparse`。ChainView 仍只负责分层 context lane；正式类型覆盖以 observation DTO / card / coverage JSON 为准，避免靠 label 猜类型。

`investigation-backlog` 会消费 observation coverage，把 `sparse` series 转成 `observation_series` backlog item。该 item 只提示继续积累同一序列的 numeric/windowed observations，或寻找带 explicit baseline/change 的官方披露；它不会自动运行 source，不会写 observation，也不会把 signal 升级成 fact edge。

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
- path redundancy / alternate supplier count：已实现 terminal consumer simple-path baseline；会区分“直接 supplier 数”与“真实上游替代路径数”，单链不会被误判为替代路径；attrs 已输出 weighted alternate-path context，缺权重时不补值。
- freshness-adjusted exposure：已实现 experimental baseline，消费 edge strength + freshness，不污染事实层。
- node knockout reachability：已实现 directed component fact-edge reachability baseline。
- node knockout weighted impact：已实现 strength/freshness max-product propagation baseline；缺权重边显式暴露，不补值。
- betweenness centrality：已实现 directed component fact-edge graph baseline；attrs 已输出 weighted path centrality context，用 strength/freshness path product 标出高权重路径瓶颈。
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
[x] 多跳 path redundancy / alternate supplier aggregation 有 regression fixtures
[x] weighted centrality / impact 指标有 deterministic regression fixtures
[ ] weighted centrality / impact 指标完成真实样本校准和阈值治理，不只停留在 baseline
```

### Gate 7 — 持续监控与告警

目标：从“一次性研究工具”升级为“持续运行系统”。

必须完成：

- job queue。可以是 `pg-boss` 或等价 Postgres-backed queue。
- source_check_targets 支持 per target cadence、jitter、priority、failure policy。
- semantic change events：`EDGE_ADDED`、`EDGE_UPDATED`、`EDGE_DEPRECATED`、`CLAIM_CHANGED`、`OBSERVATION_ANOMALY`、`SOURCE_FAILED`。
- alert rules：基于 observation、risk metric、source failure、new official filing。
- alert lifecycle：`open / acknowledged / resolved / suppressed` 的状态变更必须可审计。
- component risk alert threshold policy 必须集中定义，alert payload 必须记录 evaluated value、threshold 和 value source。
- component risk alert policy 必须有不写库的校准入口，用于人工 gold set 落库前固定 trigger/skip/reason。
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
[x] source target preflight 结果能回流 investigation backlog，避免 source 预检失败时继续误导用户同步或启用 target
[x] source target preflight summary 能按 source 输出 readiness matrix 和 issue kind 分类，方便 Gate 1 多官方源体检
[x] alerts 只引用 risk_view / observation，不直接改变事实层
[x] alert 状态维护会记录 `ALERT_STATUS_CHANGED` semantic change
[x] component risk alert threshold policy 有 deterministic regression fixture，覆盖 weighted centrality trigger 与低于阈值 skip
[x] component risk alert policy summary 能输出 trigger/skip、expected match 和 by-metric 统计
[x] `EDGE_DEPRECATED` 有受控 fact edge lifecycle workflow，必须带可验证 source ref，且只 soft-deprecate current edge
[x] Workbench / research-pack 有统一 attention queue，能消费 claim conflict、claim lifecycle、alert、source degraded 和 requires-attention change
[x] evidence supersession 与 relation diff 能进入 changes timeline，并带结构化 evidence / relation / document 字段
[ ] attention queue 仍缺正式消费 API / host app 入口；当前只有 Workbench JSON 与 research-pack JSON/Markdown
```

当前状态：`source_check_jobs` 已提供 Postgres-backed durable job/outbox；`sources run-due` 会先 enqueue due target，再用 `FOR UPDATE SKIP LOCKED` claim job，失败写入 `failed` 并按 backoff 重试，超过 `max_attempts` 进入 `dead`。`sources due/run-due` 支持按 `source-plan.json + namespace`、`check_target_id` 或 source adapter 过滤小批量目标；过滤只限制 enqueue/claim 范围，不改变 source policy 或 target config。`apps/worker` 已提供常驻 source-check worker loop，负责按固定 poll interval 复用同一条 `runDueSourceChecks()` 业务路径；CLI 不再是唯一执行入口。cadence、jitter、priority、初始 `next_check_at`、max attempts 和 backoff 已统一收口到外部 source policy config：source policy 提供默认值，target 可覆盖，enqueue 阶段不再接受调用方绕过配置传入 retry 参数。cached fallback 会记录 `SOURCE_DEGRADED`，不会被误记为成功；coverage 会把 latest event 为 `SOURCE_DEGRADED` 的 target 标成 `degraded`，即使 job 本身已完成，也不会被解释为完全成功。显式传入 research-pack 的 source target preflight 会被 `investigation-backlog` 消费：failed/skipped/degraded preflight 会先提示修凭据、target config、connector 注册或源连通性，再进入同步/启用/运行建议；preflight summary 也会按 source 输出 readiness matrix，列出 checked/failed/skipped、normalized/degraded、target kind 和 issue kind 分布，方便一次性审计多官方源覆盖健康度；缺凭据、target config 错误、connector 未注册、源不可达和源响应异常会有明确分类。preflight 本身仍不写库、不写 observation、不生成事实边。`OBSERVATION_ANOMALY` 已由 observation anomaly refresh 幂等写入 `change_records`，并被 changes timeline 标记为 requires attention。`RISK_METRIC_CHANGED` 已由 component risk refresh 在新版 risk view 与上一版指标存在实质变化时写入，changes timeline 会把它归为 risk family。事实边废弃已从 claim conflict 建议后移到独立 `graph deprecate-edge` / `deprecateEdge()` lifecycle：只能 soft-deprecate `validity='current'` 的 edge，必须带已存在的 `evidence / review / claim / unknown / semantic_change` source ref，并写 `EDGE_DEPRECATED` change record；它不会删除 evidence，也不会自动修改 claim status。`EVIDENCE_SUPERSEDED` 和官方披露 relation semantic diff 已进入 changes timeline：timeline 会带出 superseded evidence ids、replacement evidence、relation surfaces、relation type、component、fingerprint 和 previous/next document id，Markdown 也能给出可读摘要；这些仍是审计/监控上下文，不自动写事实边。`refreshAlertCandidates()` 已能从 observation anomaly、source failure 和 component risk metric 生成 `alert_candidates`，并通过 `dedupe_key` 去重；component risk alert 使用 `alert-rules.component-risk.threshold-policy.v1` 统一评估 single-source、HHI、node reach、weighted impact 和 weighted path centrality，并在 `attrs.alert_policy` 记录阈值、取值来源与 evaluated value。`evaluateComponentRiskAlertPolicy()` 和 `summarizeComponentRiskAlertPolicy()` 提供不写库的 policy calibration 入口，可在人工 gold set 落库前输出 trigger/skip/reason、expected match 和 by-metric 统计。alert 只引用 `observation / risk_view / risk_metric / change / source_event`，不写事实边。`updateAlertCandidateStatus()` 和 CLI `intelligence alert-status` 已支持状态维护，并用 `scope_kind='alert'` 写入 `ALERT_STATUS_CHANGED` semantic change。Workbench / research-pack 已新增统一 `attention_queue`，把 claim conflict、claim lifecycle warning、open alert candidates、degraded source health 和 requires-attention change 收口成即时处理队列；它只读派生上下文，不自动裁决冲突或修改事实层。通知通道和正式 host app/API 入口仍未完成。

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
- source-plan 支持消费 target profile official source hints：带 SEC CIK 的公司可生成 `sec-edgar/sec-company-filings` runnable target；显式 `officialDisclosureYear` 存在时，已注册官方 IR connector 可生成 node-specific `official-html-disclosure` target，`company-ir` 这类长尾入口必须额外带审计过的显式 HTTPS URL，DART / EDINET 这类监管目录 connector 可生成目录 monitor target；Apple Supplier List 这类 publisher-specific 官方名单只能作为 review-only 来源接入，不能成为每个研究对象一个 `<company>-suppliers` 文件的先例；无年份或缺 connector/config/URL 时保持 gap，避免猜默认披露期、猜 IR 页面或伪造可运行能力。
- 任意上市公司入口必须保持 `--company <query>` 语义：先解析实体，再由 registry/source-plan/source-target coverage 输出可执行目标和缺口。陌生公司没有足够 metadata 时应显式进入 entity/source discovery backlog，不能要求用户手写完整 profile，也不能用公司名硬编码新 workflow。
- source-management 提供 `source-plan.json` 到 `source_check_targets` 的稳定转换和无数据库预览；CLI 只做 `sources policy preview-plan-targets` / `sync-plan-targets` / `enable-plan-targets` 薄入口。预览只生成稳定 target id、去重统计、source / target kind / priority 汇总和 validation 结果，不写库、不抓源。同步默认 disabled，审计后可用同一 `source-plan.json + namespace` 受控启用已同步 target，并统一写入 target 级 cadence / jitter / retry / `next_check_at` 覆盖值。
- source-monitor 通过 `source_change_events.check_target_id` 保留 target 级事件链；research-pack 输出 `source-target-coverage.json/md`，把 runnable target 的 sync、enable、due、job、event、observation 状态回流到研究包，并让 `investigation-backlog` 的 action 随 coverage 状态变化。显式传入 `source-target-preflight.json` 时，backlog 还会把预检 failed/skipped/degraded 放进同一任务的 action 和 coverage 行，作为同步前排错入口。

完成标准：

```text
[ ] apps/api 有 contract tests
[ ] research-preview 或未来正式前端只消费 API/Workbench DTO
[ ] 无 Docker snapshot path 与 DB-backed path 都保留
[x] research-pack 能输出 question readiness matrix
[x] research-pack 能输出 investigation backlog，供人工或后续安全 agent 消费
[x] research-pack/source-plan 能把 target profile 的 SEC CIK 和官方 IR 年份配置转成 runnable target suggestions
[x] runnable source-plan target suggestions 能同步到 source_check_targets，并复用统一监控频率/重试配置入口
[x] runnable source-plan target suggestions 能在无数据库场景下预览，将 target id、去重、credentials warning 和 validation 暴露给宿主 App / CLI 审计
[x] runnable source-plan target suggestions 能在无数据库场景下执行 plan/fetch/normalize smoke，提前暴露外部源连通性、凭据和 target config 问题
[x] 已同步 source-plan target 能在审计后受控启用，并把调度参数继续收口到 source policy/target config
[x] research-pack 能输出 source target coverage，展示 runnable target 是否已同步、启用、due、运行、失败或产出 observation
[x] investigation-backlog 能消费 source target coverage，把下一步 action 从通用 source check 提示细化为同步、启用、运行、等待、排错或 review observation
[x] investigation-backlog 能消费 source target preflight，把无数据库预检失败转成同步前排错动作
[x] source target preflight 能输出按 source 聚合的 checked / failed / skipped / normalized / degraded / issue kind 矩阵
[x] source-check connector capability 统一声明 target 级 credential requirements，并被 catalog / preview / smoke 复用
[x] official-disclosure readiness 能输出 Gate 1 scorecard，区分 data progress 与 source path progress
[x] official-disclosure readiness 能输出 edge-level corroboration queue，逐条标出 single-source edge 的二源检查路径或 explicit disposition 缺口
[x] official-disclosure readiness 能区分已记录 single-source disposition unknown 与缺失 disposition 的边，并为缺失项生成确定性 proposed unknown payload
[x] evidence-maintenance 能把 readiness 的 proposed single-source disposition unknown 受控落库到 `unknown_items`，并记录 unknown semantic change；缺失或已失效 edge 默认跳过
[x] Workbench unknown DTO 导出 `scope_kind / scope_id`，official-disclosure readiness 优先用结构化 edge scope 识别已记录 disposition unknown
[x] investigation-backlog 能消费 corroboration queue，生成逐 edge `corroboration_review` 任务并继承 source target coverage / preflight 状态
[x] investigation-backlog / research-pack manifest 能汇总 corroboration review 的 runnable / sync / enable / due / preflight / credential / disposition-only 状态
[x] research-pack 能输出 `corroboration-source-plan.json/md`，把 edge-level corroboration runnable target 过滤成可直接交给 source-management 的标准 source-plan 子集
[x] `corroboration-source-plan` 能为每个 filtered target 输出确定性 `next_action`，把 preflight/coverage 状态收口成配置凭据、修配置、smoke、sync、enable、run due、等待、排错或 review observation
[x] research-pack manifest / README 汇总 `corroboration-source-plan` 的 next-action 分布，让 Gate 1 卡点不用打开明细 JSON 也能看到
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

不要用单个百分比替代 gate 判断。当前最准确的描述是：

```text
中期 intelligence network 骨架基本成立；
财报指标、关系强度/新鲜度、风险 baseline、source worker/alert baseline 已落地；
claim fusion baseline、observation coverage、source target coverage、official disclosure target-node/profile readiness、profile expansion backlog 和 attention queue 已可在 research-pack 里复现；
但官方披露事实覆盖规模、真实样本校准、API、安全 agent 和质量/性能 gate 仍未完成。
作为早期供应链情报底座可以展示；
作为全球级综合监控、风险提示、动态追踪和货物流向系统仍明显不足。
```

| 能力                        | 当前状态                                                                                                            | 判断                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| SEC / 10-K 事实边           | 已可用                                                                                                              | 事实底座成立                                                          |
| 10-Q / 8-K plan/fetch       | 已接入                                                                                                              | 尚需深度语义变化                                                      |
| Apple Supplier review/apply | 纵向链路已通                                                                                                        | 设施边需要继续做厚                                                    |
| IR 年报页面                 | TSMC/Samsung/SK hynix/ASML preview                                                                                  | 官方上下文可用，事实边偏薄                                            |
| Claim / Observation / Lead  | 已建骨架                                                                                                            | 需要时序、融合、风险派生                                              |
| ChainView / Workbench       | 已可视化第一版                                                                                                      | 不是正式前端，不是完整分析系统                                        |
| Research Pack readiness     | question / observation / official disclosure readiness 已输出                                                       | 只能说明当前 pack 是否够用，不能替代真实覆盖扩容                      |
| Census / WorldBank          | 第一版 observation target                                                                                           | 需要变化检测与 ComponentCard 深接                                     |
| DART / EDINET / TWSE        | DART 已接 metadata monitor；EDINET 已接 daily-filings metadata monitor；TWSE 已接 electronic-documents 目录 monitor | 韩日台监管披露已能进入 target/readiness；正文解析和公司级筛选仍是短板 |
| 新闻 / 政策 / 制裁          | registry/计划层                                                                                                     | 信号层短板                                                            |
| 图算法 / 风险视图           | deterministic baseline 已实现                                                                                       | 真实样本校准、阈值治理和加权路径冗余治理仍是核心缺口                  |
| API / 告警 / worker         | 告警/worker baseline 已实现                                                                                         | API 与通知通道仍是产品化后端缺口                                      |
| 货物流向                    | source-plan / observation 起步                                                                                      | AIS/BOL/港口/HS flow 只能先做 observation/lead                        |

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
1. Census / USITC trade flow 深接 ComponentCard / ChainView
2. EIA / FRED / WorldBank commodity/energy
3. route / port / HS flow observation，不直接生成公司货物流事实边
4. GDELT news lead
5. BIS / OFAC / EU sanctions policy observation
6. observation anomaly detection
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
