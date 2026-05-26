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

## 数据准备与推理边界

后端完成标准衡量的是“数据和关系网是否足够可靠”，不是“系统是否已经能自动写出完整产业判断”。真正要服务的问题不是“有多少条边”，而是类似下面这种链式研究：

```text
AI demand -> GPU -> data center -> PCB / optical module / power / cooling
PCB -> copper clad laminate -> resin / electronic glass cloth / copper foil -> upstream materials
fab expansion -> cleanroom construction -> equipment delivery / installation / qualification
equipment ramp -> process materials -> photoresist / target / CMP / high-purity gas -> raw material constraints
```

后端必须准备好结构化输入，让未来前端研究员或安全 AI 能回答这类问题，而且要比“GPU 火了，所以 PCB、电子布、树脂、洁净室、设备、材料依次受益”这种口头推理更深：每一跳都要能说明已有证据、观测窗口、缺失证据、候选上游、可运行 source target 和不能自动断言的 unknown。但后端本身不应把开放式推理、投资叙事或时间滞后判断硬编码成事实。

因此后端完成前必须具备三类可消费数据：

- `relationship_network`：公司、设施、组件、材料、设备、工艺、地区之间的事实边、claim、unknown、source coverage 和 frontier path。
- `propagation_context`：需求、扩产、建设、设备进场、调试、材料消耗、价格/贸易/政策变化等 observation 与 time window。
- `reasoning_inputs`：question readiness matrix、frontier expansion plan、source target gaps、corroboration/disposition state、calibration/gold labels、risk/intelligence derived metrics。

边界如下：

| 后端应该做                                                                                 | 后端不应该做                                                |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| 把 `GPU -> HBM -> DRAM equipment/materials` 拆成可追踪 component/material frontier         | 直接断言“某材料明年必涨”                                    |
| 把 cleanroom、equipment install、process material 作为 facility/capex/process observations | 把工程进度 observation 自动写成供应商 fact edge             |
| 把铜、树脂、电子布、光刻胶、靶材、CMP、高纯气体等上游材料做成 taxonomy/source targets      | 没有证据时用行业常识补齐公司级买卖关系                      |
| 输出 `ready / partial / blocked` 的 question readiness、链路 coverage 和缺口               | 自动替用户完成最终综合判断并写入 truth store                |
| 为 AI/前端提供 schema 化、可审计、可引用的输入                                             | 让 LLM 直接写 fact edge、提高 evidence_level 或关闭 unknown |

一句话：**后端先把“事实、观测、缺口、候选路径、时间窗口、证据引用”准备到足够厚；最终综合推理由未来 AI 和前端研究流程读取这些结构化输入完成。**

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

### Gate 1 — AI Compute 研究链路覆盖

目标：事实图谱不只靠 NVIDIA 10-K，也不靠机械凑边数；它必须能围绕 AI compute / memory 研究问题，把官方事实、观测、unknown、source target 和下一层 frontier 组织成可递归展开的研究链路。

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
[ ] 当前 Gate 1 research target profile / research-pack 对 AI compute propagation question 输出 relationship / observation / unknown / source-target / frontier readiness matrix，覆盖 GPU、HBM、AI server、PCB、光模块、电源/冷却、晶圆/封装、洁净室、设备、工艺材料和上游原材料
[ ] Level 4/5 fact edge 数量只作为证据厚度健康指标；必须按每个 propagation layer 统计，不允许用全库总数、Apple 广度边或单一公司专题替代 NVIDIA / AI compute 主链深度
[ ] 每个核心 propagation layer 至少有一种明确状态：covered_fact、official_target_runnable、observation_ready、lead_only、unknown_open 或 blocked_source，并能解释为什么
[ ] 至少 30% fact edge 有第二来源 corroboration 或明确标为 single-source
[ ] 任一 fact edge 都能追到 evidence_id、doc_id、source_url、cite_text、offset/fingerprint
[ ] AI compute / memory profile 不只覆盖公司，还覆盖核心 component / material / equipment / process frontier，并为缺失上游材料节点生成 explicit backlog
[ ] 任意上市公司入口仍走通用 entity/source-plan/research loop，不新增 `<company>-suppliers` 这类公司专用 workflow
```

说明：早期可以继续保留 “100 条 profile-visible L4/L5 fact edge” 作为压力测试目标，但它不是后端完成的充分条件，也不是优先级排序器。更重要的是：围绕一个问题能否逐层说明“已有事实是什么、哪些只是观测或线索、缺哪些证据、下一步该查谁和哪个 source”。如果系统为了凑 L4/L5 数量转向无关公司或无关链路，即使超过 100 条也不能算 Gate 1 完成。

当前完成态：

- Gate 1 已有只读 readiness / backlog / run ledger / data-depth workbench 输出，能量化事实边覆盖、traceability、二源或 single-source disposition、expected source coverage、source target coverage、source blocker、gold label 批次、相邻官方事实池和下一层 frontier research。
- 官方源路径已覆盖 SEC、官方 IR、DART-KR、EDINET、TWSE MOPS、Apple Supplier List、GLEIF entity lookup 的基础接线；DART/EDINET/TWSE 当前定位为目录/target/readiness/monitor 骨架，不解析正文、不写事实边。
- `propagation-readiness.json/md` 已内置 `ai_compute_propagation.v0` matrix，把 demand、server、PCB/materials、fab capacity、cleanroom、equipment、process inputs、raw materials 逐层标成 `covered_fact / observation_ready / official_target_runnable / lead_only / unknown_open / blocked_source`，并列出 fact、observation、source target、source-plan、frontier、lead、unknown refs 和下一步动作。该 matrix 是 reasoning input，不写 fact edge、不提升 evidence level、不关闭 unknown。
- `ai-compute-memory.v0` 已从公司/一阶组件覆盖扩展到 AI server 与 PCB 上游 frontier：`COMP-SERVER -> GPU / HBM / manufacturing services / PCB / optical module / power / cooling`，以及 `PCB -> CCL -> copper foil / electronic glass cloth / laminate resin`、`wafer -> cleanroom`。这些都是 source-plan / observation / backlog 输入，不是事实边。
- `supply-chain-expansion-plan` 已区分 component dependency lead 的 source path authority：fact-capable official path、observation-only trade/commodity path、lead-only path 会分别统计和渲染；只有命中具体 dependency、target，或锚定到 target component 的 source-plan item 才能改变 lead 状态，parent component 的泛化 source-plan 不会被借给所有下游材料。
- 二源检查已形成标准 source-plan 子集和 action-specific 批次，支持 preview、无数据库 smoke、sync、enable、run-due，并能把 preflight / DB-backed failure kind 回流到 Gate 1 action queue。action batch 会携带已匹配到的 `check_target_ids`，因此 enable / run-due 会优先操作真实已同步 target；只有普通 source-plan 才按 namespace 重新生成 target id。
- `gate1-run-ledger` 已提供 frontend-ready `monitoring_config` 和 `review_workbench`：前者收口 cadence / jitter / retry / backoff / `next_check_at`，后者收口 source target、edge corroboration、official signal disposition、frontier company research 的 review-only 决策入口。
- edge corroboration queue 已有独立 review-only disposition 出口：`review edge-corroboration-disposition` 只写 `EDGE_CORROBORATION_DISPOSITION_RECORDED` change，不写 evidence / fact edge / source target；research-pack 会读回每条 edge 的最新 disposition，让前端/host app 能审查单源 L4/L5 边并记录 single-source unknown、继续找二源或创建 counterparty target，而不是让沉默缺口长期悬空。
- `gate1-data-depth-workbench` 已新增 `entity_context` workstream：当 visible chain 里的节点是业务单元/子实体且 source path 配在父级法人的时候，研究包会输出 review-only affiliation item，提示应审查父级、子级或两者的递归研究范围；如果父级法人已有 open company unknown，该 item 会把 unknown ref 带回当前报告，避免递归研究目标和未知边界分叉。它不自动合并实体、不把父级 evidence 复制到子级、不传播 fact edge。审查结论通过 `review entity-affiliation-disposition` 写入 `ENTITY_AFFILIATION_DISPOSITION_RECORDED` change，供前端/host app 复用；该 disposition 仍带 `automatic_fact_mutation_allowed=false`。research-pack 会读回每个 context 的最新 disposition：未记录时进入 `review_workbench(kind='entity_affiliation_disposition')`，已记录 parent/both scope 时才把 frontier research command 路由到父级法人，已记录 child/not relevant/keep unknown 时不会反复推荐父级 research。
- single-source disposition unknown 和 official signal disposition unknown 都有受控物化路径；它们只写 `unknown_items` 与审计 change，不写 evidence、fact edge 或 source target。
- root research coverage unknown 已进入 `--prepare-data` 显式写入路径：当 selected company / 父级法人研究入口没有任何 reviewed L4/L5 fact edge 且没有 open company unknown 时，系统会物化一个 company-scoped unknown，用来说明“这个研究范围已经打开，但官方关系证据仍缺失”。该路径只写 unknown 和 semantic change，不写 evidence、fact edge，也不把 observation/lead 升级为事实。
- `supply-chain-expansion-plan` 已能把 L4/L5 frontier 转成下一层通用 research plan；它是递归研究计划，不是事实写入流程。Gate 1 workbench 的 frontier 命令只选择 `expand_candidate` 的 company frontier，不把缺 component context 的 facility node 当作下一家公司研究入口；宽口径 fact-edge gap 会优先给 profile 级 research 命令，避免把大量组件塞进不可维护的输出目录。
- `gate1-data-depth-workbench` 已新增 `adjacent_official_facts` workstream：truth-store 模式会按当前 profile 组件读取“同组件、非当前可见链路”的 L4/L5 current fact edge，作为相邻官方事实池输出。它解释全库 L4/L5 增长为什么不等于 NVIDIA 可见链路增长，并把这些边转成下一轮 listed-company research 候选；命令提示会保留当前递归上下文里的 company、component、depth、target profile、official year、source target namespace 和输出目录，确保候选可以直接进入下一轮研究跑数。该路径只读，不把 Apple/其它官方名单边复制到 NVIDIA 链路，不写 fact edge，不关闭 unknown。
- adjacent official facts 的下一轮 company ranking 已收口为独立纯函数：组件/行业相关性和 likely upstream role 优先，edge frequency 只能作为弱 tie-breaker；当存在组件相关候选时，披露中心节点或品牌方不会因为出现次数多而排在前面。每个 ranking context 会输出稳定 context/candidate id、model version、assumptions 和 score breakdown，并已有 `ranking_calibration_labels` 持久化契约用于标注 `useful_target / wrong_direction / brand_center_bias / needs_more_context / not_relevant`；truth-store research-pack 会把已持久化 ranking label 回灌到 candidate 的 `review_status / latest_label / existing_labels`，并在 manifest 中统计 labeled/unlabeled 与 persisted label 分布。该 rank 仍只是 review-only research target 建议，不是概率结论；进入概率化候选评分前必须有足量 gold label、校准报告和 bias / reliability bucket 输出。
- 2026-05-26 最新本地跑数：全库 L4/L5 current fact edge refresh 扫到 238 条；NVIDIA research-pack 可见 L4/L5 fact edge 仍为 23 条，Gate 1 目标缺口 77 条，相邻官方事实池增至 21 条、14 个公司。Apple Supplier List 受限批处理继续用“官方名单行 + curated entity + 可复现 citation”的门槛推进事实边；实体解析新增受控法律后缀变体查询与 GLEIF reviewed alias 自动解析边界，本轮对 Skyworks、Parade、Power Integrations、Qorvo 等实体应用 4 个 GLEIF entity-source review，并受控应用 17 个 supplier-list review candidate。相关边已进入 `claim_build` / `intelligence_refresh`，但仍只作为相邻官方事实和递归研究入口，不计入 NVIDIA profile 可见 L4/L5 深度。缺失 strength 继续保持为 explicit unknown，避免把官方名单关系伪装成已知份额或依赖强度。Samsung Foundry / Samsung Memory 的父级法人研究范围已记录 review-only disposition；2 条 single-source proposed unknown 已物化为 edge-scoped unknown。source monitor 已跑完当前 due official targets；Micron IR corroboration target 真实抓取结果仍为 `source_unreachable` / timeout，因此报告将其保留为 retry/wait source blocker，而不是写入事实边。SK hynix IR 产生的 facility-edge correlation hints 已全部记录为 `needs_more_evidence` review-only disposition：它们保留为 AI memory/HBM 研究信号，但不计入二源 corroboration，也不写 fact edge。

仍未完成：

- 全库 L4/L5 current fact edge 已超过 100 条，说明 review / evidence / graph 写入闭环跑通；但 NVIDIA research-pack 可见 L4/L5 仍只有 23 条，且 AI compute propagation layer 仍缺足够的 observation/source target/frontier readiness，因此 Gate 1 主链深度尚未完成，不能用全库总数、Apple supplier 广度边或 Samsung 单点递归替代问题驱动验收。
- target profile 中仍只有 7 个 target nodes 有 fact edge；34 个 target nodes 中还有 3 个缺官方 coverage，source path progress 仍约 0.67。
- counterparty 官方披露还缺足够的人工/规则裁决样本；最新报告中 open official signal correlation hints 和 open official signal review candidates 都已降为 0，corroboration action queue 还剩 5 个 review-observation target 和 2 个 wait-for-job target，但这些 disposition / job states 只是 review-only 研究结论或监控状态，不能把它们当成 evidence 或二源 corroboration。
- EDINET / DART / TWSE 正文下载、正文解析和可审计 evidence 提取仍是后续阶段。

边界约束：

- readiness、backlog、source-plan、run ledger、smoke 成功都不能被解释为事实证据。
- observation、official signal、lead、unknown 都不能自动升级成 fact edge。
- profile 是 Gate 1 验收锚点，不是全球供应链全集；不在 profile 里的已发现节点应进入 expansion backlog。

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

`intelligence refresh` 是薄 CLI 入口，业务编排在 `@supplystrata/evidence-maintenance`。`research run` 默认只读打包，导出已有 Workbench / CompanyCard / ComponentCard / ChainView / question readiness / readiness/backlog context；只有显式传 `--prepare-data` 或单项刷新 flag 时，才会先刷新 claims、edge intelligence context，或筛出当前研究包里已有 Level 4/5 component fact edge 的 eligible 组件刷新 component risk baseline。

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

Gate 5 还承担“产业传导推理输入”的数据准备责任。后端不直接输出投资结论，但必须把需求传导、扩产周期和上游材料约束拆成可审计 observation / lead / unknown：

```text
demand_signal
capacity_expansion_signal
facility_construction_signal
equipment_installation_signal
process_material_consumption_signal
material_price_or_trade_signal
policy_or_export_control_signal
```

这些 signal 只能进入 observation / lead / risk / backlog 层。只有当公司级关系有官方证据、review/apply 和可追溯 cite 时，才能进入 fact edge。

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
CAPACITY_EXPANSION_OBSERVATION
FACILITY_CONSTRUCTION_OBSERVATION
EQUIPMENT_INSTALLATION_OBSERVATION
PROCESS_MATERIAL_OBSERVATION
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
[x] research-pack 能输出 propagation readiness，把需求、扩产、设施建设、设备安装、材料消耗、原材料/贸易/价格信号拆成 ready / partial / blocked
[ ] component-context / source-plan 能覆盖 AI compute 上游材料与设备 frontier，例如 PCB、光模块、电源/冷却、树脂、电子布、铜箔、高纯气体、光刻胶、靶材、CMP、洁净室、半导体设备
[ ] 上游材料和工程建设信号默认只生成 observation / lead / backlog，不自动生成公司 fact edge
```

当前状态：observation-store 已形成统一写入边界，`FINANCIAL_METRIC_OBSERVATION` 由 SEC companyfacts 结构化 JSON 写入，`TRADE_FLOW_OBSERVATION` 由 Census Trade target 写入，`COMMODITY_PRICE_OBSERVATION` 由 World Bank Pink Sheet target 写入，官方披露语义抽取器可生成 `INVENTORY_OBSERVATION` / `BACKLOG_OBSERVATION` / `CAPEX_OBSERVATION` / `CUSTOMER_CONCENTRATION_OBSERVATION` / `PROCUREMENT_OBSERVATION`，OSH 路径可生成 `FACILITY_PROFILE_OBSERVATION`。这些路径都必须保留 `source_item / doc / time_window / metric / scope / geography / component_id / provenance` 语义，不进入 graph-builder，不生成事实边。

`@supplystrata/research-pack` 已新增 `propagation-readiness.json/md`：它只读消费 observation coverage、source-plan、source target coverage、official disclosure readiness 和 supply-chain expansion plan，把 `demand_signal`、`capacity_expansion_signal`、`facility_construction_signal`、`equipment_installation_signal`、`process_material_consumption_signal`、`material_price_or_trade_signal`、`policy_or_export_control_signal` 统一标为 `ready / partial / blocked`。同时它输出 `ai_compute_propagation.v0` matrix，逐层说明 AI compute 传导链目前是 fact-covered、observation-ready、source-target-runnable、lead-only、unknown-open 还是 blocked-source。每个 item/layer 都带 `reasoning_input_only_no_fact_mutation` policy、ready signals/status reason、missing requirements 或 fact/observation/source/lead/frontier/unknown refs。`investigation-backlog` 会把 `partial/blocked` context 转成 `propagation_readiness` backlog item，并继承 source target coverage，让后续前端/host app 能排队补 observation 或 source target。research-pack 会从 `generatedAt` 派生默认 source-plan 窗口：官方披露和年度材料观测默认上一 UTC 年，贸易和商品价格观测默认上一 UTC 月；这些默认只让 target 可排队，调用方仍可显式覆盖窗口。policy / export-control context 可以消费官方披露 source-plan 路径作为待抽取政策观测的来源，但不能把披露沉默或 source-plan runnable 解释成风险结论。它不写 DB、不生成 fact edge、不关闭 unknown，也不输出最终产业结论。

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

当前状态：`source_check_jobs` 已提供 Postgres-backed durable job/outbox；`sources run-due` 会先 enqueue due target，再用 `FOR UPDATE SKIP LOCKED` claim job，失败写入 `failed` 并按 backoff 重试，超过 `max_attempts` 进入 `dead`。`in_progress` job 会写入 `lease_expires_at`，claim 阶段可回收超时 lease，避免 worker 崩溃后唯一 active job 永久堵住同一 target。`sources due/run-due` 支持按 `source-plan.json + namespace`、`check_target_id` 或 source adapter 过滤小批量目标；过滤只限制 enqueue/claim 范围，不改变 source policy 或 target config。`apps/worker` 已提供常驻 source-check worker loop，负责按固定 poll interval 复用同一条 `runDueSourceChecks()` 业务路径；CLI 不再是唯一执行入口。cadence、jitter、priority、初始 `next_check_at`、max attempts 和 backoff 已统一收口到外部 source policy config：source policy 提供默认值，target 可覆盖，enqueue 阶段不再接受调用方绕过配置传入 retry 参数；配置同步未提供 `next_check_at` 时不会覆盖运行态调度，显式 `null` 才清空。cached fallback 会记录 `SOURCE_DEGRADED`，不会被误记为成功；coverage 会把 latest event 为 `SOURCE_DEGRADED` 的 target 标成 `degraded`，即使 job 本身已完成，也不会被解释为完全成功。显式传入 research-pack 的 source target preflight 会被 `investigation-backlog` 消费：failed/skipped/degraded preflight 会先提示修凭据、target config、connector 注册或源连通性，再进入同步/启用/运行建议；preflight summary 也会按 source 输出 readiness matrix，列出 checked/failed/skipped、normalized/degraded、target kind 和 issue kind 分布，方便一次性审计多官方源覆盖健康度；缺凭据、target config 错误、connector 未注册、源不可达和源响应异常会有明确分类。preflight 本身仍不写库、不写 observation、不生成事实边。`OBSERVATION_ANOMALY` 已由 observation anomaly refresh 幂等写入 `change_records`，并被 changes timeline 标记为 requires attention。`RISK_METRIC_CHANGED` 已由 component risk refresh 在新版 risk view 与上一版指标存在实质变化时写入，changes timeline 会把它归为 risk family。事实边废弃已从 claim conflict 建议后移到独立 `graph deprecate-edge` / `deprecateEdge()` lifecycle：只能 soft-deprecate `validity='current'` 的 edge，必须带已存在的 `evidence / review / claim / unknown / semantic_change` source ref，并写 `EDGE_DEPRECATED` change record；它不会删除 evidence，也不会自动修改 claim status。`EVIDENCE_SUPERSEDED` 和官方披露 relation semantic diff 已进入 changes timeline：timeline 会带出 superseded evidence ids、replacement evidence、relation surfaces、relation type、component、fingerprint 和 previous/next document id，Markdown 也能给出可读摘要；这些仍是审计/监控上下文，不自动写事实边。`refreshAlertCandidates()` 已能从 observation anomaly、source failure 和 component risk metric 生成 `alert_candidates`，并通过 `dedupe_key` 去重；component risk alert 使用 `alert-rules.component-risk.threshold-policy.v1` 统一评估 single-source、HHI、node reach、weighted impact 和 weighted path centrality，并在 `attrs.alert_policy` 记录阈值、取值来源与 evaluated value。`evaluateComponentRiskAlertPolicy()` 和 `summarizeComponentRiskAlertPolicy()` 提供不写库的 policy calibration 入口，可在人工 gold set 落库前输出 trigger/skip/reason、expected match 和 by-metric 统计。alert 只引用 `observation / risk_view / risk_metric / change / source_event`，不写事实边。`updateAlertCandidateStatus()` 和 CLI `intelligence alert-status` 已支持状态维护，并用 `scope_kind='alert'` 写入 `ALERT_STATUS_CHANGED` semantic change。Workbench / research-pack 已新增统一 `attention_queue`，把 claim conflict、claim lifecycle warning、open alert candidates、degraded source health 和 requires-attention change 收口成即时处理队列；它只读派生上下文，不自动裁决冲突或修改事实层。通知通道和正式 host app/API 入口仍未完成。

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
- research-pack / Workbench DTO 必须能作为未来 AI 和前端研究员的推理输入：输出 relationship network、propagation context、source gaps、unknown、calibration 和 risk/intelligence metrics；但 API 不输出未经 schema 化的“最终判断”作为 truth-store 数据。
- source-plan 支持消费 target profile official source hints：带 SEC CIK 的公司可生成 `sec-edgar/sec-company-filings` runnable target，并同时生成 observation-only `sec-edgar/sec-company-facts` target，用于把结构化财报指标纳入 source-target coverage；显式 `officialDisclosureYear` 存在时，已注册官方 IR connector 可生成 node-specific `official-html-disclosure` target，`company-ir` 这类长尾入口必须额外带审计过的显式 HTTPS URL，DART / EDINET 这类监管目录 connector 可生成目录 monitor target；Apple Supplier List 这类 publisher-specific 官方名单只能作为 review-only 来源接入，不能成为每个研究对象一个 `<company>-suppliers` 文件的先例；无年份或缺 connector/config/URL 时保持 gap，避免猜默认披露期、猜 IR 页面或伪造可运行能力。
- 任意上市公司入口必须保持 `--company <query>` 语义：先解析实体，再由 registry/source-plan/source-target coverage 输出可执行目标和缺口。陌生公司没有足够 metadata 时应显式进入 entity/source discovery backlog，不能要求用户手写完整 profile，也不能用公司名硬编码新 workflow。
- source-management 提供 `source-plan.json` 到 `source_check_targets` 的稳定转换和无数据库预览；CLI 只做 `sources policy preview-plan-targets` / `sync-plan-targets` / `enable-plan-targets` 薄入口。预览只生成稳定 target id、去重统计、source / target kind / priority 汇总和 validation 结果，不写库、不抓源。预览、同步和启用都可按 source adapter 过滤，方便先接入 SEC / 官方 IR 这类当前可运行来源，再单独处理需要凭据或目录策略的 Census / DART / EDINET / TWSE 目标。同步默认 disabled，审计后可用同一 `source-plan.json + namespace` 受控启用已同步 target，并统一写入 target 级 cadence / jitter / retry / `next_check_at` 覆盖值。
- source-monitor 通过 `source_change_events.check_target_id` 保留 target 级事件链；research-pack 输出 `source-target-coverage.json/md`，把 runnable target 的 sync、enable、due、job、event、observation 状态回流到研究包，并让 `investigation-backlog` 的 action 随 coverage 状态变化。显式传入 `source-target-preflight.json` 时，backlog 还会把预检 failed/skipped/degraded 放进同一任务的 action 和 coverage 行，作为同步前排错入口。preflight 可展示 normalized document 的只读 observation draft / semantic section 计数，用来衡量数据是否进入可抽取层；这些计数不是已落库 observation，也不是事实边证据。

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
[x] research-pack 能输出 source target coverage，展示 runnable target 是否已同步、启用、due、运行、失败或产出 observation，并汇总 observation 总量、已观测主体数、按 source / target kind / metric 的观测量
[x] source target coverage 能把 metric 覆盖转成只读 observation review seeds 和 calibration candidates，按 P0/P1/P2 区分供应链信号、财务背景和 metric mapping gap，并显式声明 review-only/no fact mutation policy；每个 candidate 会带可追溯 sample observation refs、推荐 label、已持久化 label 状态和下一批 priority/metric 分层 labeling plan，供前端审查和 calibration/gold label 抽样
[x] investigation-backlog 能消费 source target coverage，把下一步 action 从通用 source check 提示细化为同步、启用、运行、等待、排错或 review observation
[x] investigation-backlog 能消费 source target preflight，把无数据库预检失败转成同步前排错动作
[x] source target preflight 能输出按 source 聚合的 checked / failed / skipped / normalized / degraded / issue kind 矩阵
[x] source-check connector capability 统一声明 target 级 credential requirements，并被 catalog / preview / smoke 复用
[x] official-disclosure readiness 能输出 Gate 1 scorecard，区分 data progress 与 source path progress
[x] official-disclosure readiness 能输出 edge-level corroboration queue，逐条标出 single-source edge 的二源检查路径或 explicit disposition 缺口
[x] official-disclosure readiness 能区分已记录 single-source disposition unknown 与缺失 disposition 的边，并为缺失项生成确定性 proposed unknown payload
[x] evidence-maintenance 能把 readiness 的 proposed single-source disposition unknown 受控落库到 `unknown_items`，并记录 unknown semantic change；缺失或已失效 edge 默认跳过
[x] evidence-maintenance 能把 official signal disposition 中的 `record_single_source_unknown` 审计结论受控落库到 edge-scoped `unknown_items`，并保持 review-store / workbench-export / fact edge 写入边界清晰
[x] CLI 暴露 `review signal-disposition` 和 `intelligence official-signal-unknowns` 薄入口，让 official signal 审阅结论和后续 unknown materialization 可由 host app 复用，且仍不授权事实层自动变更
[x] Workbench unknown DTO 导出 `scope_kind / scope_id`，official-disclosure readiness 优先用结构化 edge scope 识别已记录 disposition unknown
[x] investigation-backlog 能消费 corroboration queue，生成逐 edge `corroboration_review` 任务并继承 source target coverage / preflight 状态
[x] investigation-backlog / research-pack manifest 能汇总 corroboration review 的 runnable / sync / enable / due / preflight / credential / disposition-only 状态
[x] research-pack 能输出 `corroboration-source-plan.json/md`，把 edge-level corroboration runnable target 过滤成可直接交给 source-management 的标准 source-plan 子集
[x] `corroboration-source-plan` 能为每个 filtered target 输出确定性 `next_action`，把 preflight/coverage 状态收口成配置凭据、修配置、smoke、sync、enable、run due、等待、排错或 review observation
[x] `corroboration-source-plan` 的 next-action 状态机优先尊重已同步 source target 的真实运行态；`succeeded` target 直接进入 review observation，不因缺少 preflight 快照而重复提示 smoke
[x] research-pack manifest / README 汇总 `corroboration-source-plan` 的 next-action 分布，让 Gate 1 卡点不用打开明细 JSON 也能看到
[x] research-pack 能输出 `gate1-run-ledger.json/md`，把 Gate 1 data progress、source path progress、corroboration 批次和 supply-chain frontier company switching 合成一个只读执行账本
[x] research-pack 能输出 `gate1-data-depth-workbench.json/md`，把 Gate 1 数据深度缺口收敛成 review-only 优先级清单，覆盖 L4/L5 增长、adjacent official facts、entity affiliation context、二源 corroboration、source blocker、strength 缺失、gold label 批次和 propagation context
[x] research-pack 能把 Gate 1 data-depth workbench 拆成 action batch JSON，至少覆盖 P0、source blockers、labeling、corroboration、entity context、adjacent official facts 和 intelligence context，供前端/host app 做受控审查或配置动作
[x] Gate 1 data-depth action item 能输出推荐决策、允许决策、写入影响、frontend action kind 和命令提示；这些字段只授权配置/审查/标注/递归研究动作，不授权自动写 fact edge 或关闭 unknown
[x] Gate 1 entity affiliation context 能通过 review-store / CLI 记录审阅结论，明确下一轮应研究父级法人、子实体、双范围或保持 unknown；research-pack 会读回最新 disposition，并把未裁决 context 放入 frontend-ready review workbench，已裁决 context 不再重复催审；该路径只写 semantic change，不合并实体、不继承 evidence、不传播 fact edge
[x] research-pack 能输出 `propagation-readiness.json/md` 或等价 DTO，作为 AI/前端分析产业传导链路的结构化输入，不直接生成结论或事实边
[x] `gate1-run-ledger` 能输出 frontend-ready `monitoring_config`，把 source policy / source target 的 cadence、jitter、retry、backoff、初始 `next_check_at` 和 source-plan 批次建议统一暴露给后续前端配置
[x] `gate1-run-ledger.monitoring_config.batches[]` 能输出 state counts、attention hint 和 recommended operational action，区分 sync、enable、run due、wait、investigate failure、review observation
[x] `gate1-run-ledger.action_queue` 能消费 `corroboration-source-plan.summary.by_next_action`，在 smoke 回灌后输出 review observations / configure credentials / retry preflight / sync / enable / run due 等精确动作，避免重复提示 smoke
[x] `gate1-run-ledger.action_queue` 的 review observations / fact edge growth / source failure 动作能输出可执行 command hint：observation review 只进入 calibration label，corroboration observation review 只记录 edge disposition，fact-edge growth 先跑 Gate 1 supplier-list dry-run；这些命令不授权自动写 fact edge
[x] `gate1-run-ledger.action_queue` 能把 open official disclosure signal correlation hints 输出为 `record_official_signal_dispositions` 动作，给后续前端/host app 一个统一 review-only 审批入口
[x] `gate1-run-ledger.review_workbench` 的 official signal disposition item 能输出可执行 `review signal-disposition` 命令提示；规则可以预填推荐 decision，人只确认 reason / evidence / unknown / target 绑定，且该命令仍只写 review semantic change
[x] DB-backed source target coverage 能输出 source-check failure kind，并把缺凭据、限流、源不可达、源响应错误、adapter 错误和未知失败带入 manifest / README / Gate 1 monitoring batch
[x] `gate1-run-ledger` 能输出 frontend-ready `review_workbench`，为 source target 批次、edge corroboration、official signal disposition 和 frontier company research 给出推荐决策、允许决策、命令提示、写入影响与 `review_only_no_fact_mutation` policy，让规则自动排优先级、人工只确认受控动作
[x] research-pack 能按 audited next-action 输出非空的 action-specific corroboration source-plan 批次，避免把仍需 smoke / 修凭据 / 修配置的 target 直接混入 sync / enable / run-due 执行
[x] research-pack manifest / README 汇总 source target preflight issue kind 分布，让 Gate 1 smoke 卡点能直接显示为缺凭据、配置错误、connector 未实现、源不可达或 adapter 异常
[x] supply-chain expansion plan 能把 L4/L5 fact frontier、component taxonomy lead、source path、unknown 和 stop condition 接进 research-pack / backlog，形成下一层递归研究计划且不写事实边
[x] research-pack 显式开启后刷新 eligible component risk baseline，并在 manifest 记录 considered / eligible / refreshed / metrics_written
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
- Env / logger 不在深层 feature 隐式读取；app/CLI/worker/use-case 边界负责注入，配置和凭据判断统一走 `@supplystrata/config`。
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
[x] observation calibration candidates 能进入持久化 label 样本池，且不会自动写 fact edge 或修改 observation
[x] research-pack / manifest 能把已持久化 observation calibration label 回灌到 source-target coverage，区分 recommended label、persisted label、labeled/unlabeled 候选数，避免把未审查候选误读成 gold label
[x] research-pack 能生成 deterministic next labeling batch，按 priority/metric 分层抽取未标注 observation calibration candidates，帮助扩大 gold set 时保持覆盖面
[x] adjacent official facts 的 research-target ranking 能输出稳定 context/candidate id 和 feature breakdown，并有独立 ranking calibration label 表记录 useful target、方向错误、品牌/披露中心偏差、需要更多上下文或不相关；这些 label 不写 fact edge，也不把 rank 解释成概率
[ ] ranking calibration run 能在样本量足够后输出 precision / recall / bias summary / reliability bucket，并把未校准 rank 继续标为 candidate-generation only
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
用 unknown map 说明盲区，把上游材料/设备/设施/工艺 frontier 和时间窗口准备成结构化 reasoning inputs，
并通过 API / Workbench 给下游前端研究员和安全 AI 可靠消费。
```

现在还不能这么说。当前更准确的状态是：

```text
事实图谱与研究工作台骨架成立；
后端正在从 evidence graph 迈向 intelligence network；
风险监控层尚未完成。
```
