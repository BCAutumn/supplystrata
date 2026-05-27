# Backend Completion Criteria — 后端完成门槛

本文是判断 SupplyStrata 后端是否完成的权威标准。它不记录每次迭代的实现流水账；具体方法学见 [intelligence-methodology.md](../03-data-model/intelligence-methodology.md)，模块边界见 [module-design.md](../02-architecture/module-design.md)。

## 完成定义

后端完成不是“能生成一份报告”，也不是“有足够多的边”。只有下面这句话成立，才可以称为后端基本完成：

```text
给定一个公司、组件或外部事件，系统能用公开源自动维护可审计事实图谱；
用 observation 解释变化；
用 risk/intelligence view 计算暴露、瓶颈和新鲜度；
用 unknown map 说明盲区；
把上游材料、设备、设施、工艺 frontier 和时间窗口准备成结构化 reasoning inputs；
并通过 API / Workbench 给前端研究员和内部只读 AI 可靠消费。
```

当前更准确的状态是：

```text
证据优先、公开数据驱动、面向关键技术产业链研究的供应链情报图谱 alpha。
```

不要包装成：

- 全球供应链监控系统。
- 实时货物流追踪平台。
- 成熟风险评分 / 风险提示产品。
- 投资推断或投资建议系统。
- 自动供应链发现系统。

## 不可违反的边界

- `evidence_level` 不是 `risk_score`。
- fact edge 只能来自可追溯 evidence 和受控 review/apply。
- observation、lead、official signal、source health、risk metric、AI 输出都不能直接写 fact edge。
- strength / freshness / risk / alert 都属于派生层。
- unknown 是一等公民，不能用猜测或 fallback 填掉。
- 内部 AI 只读分析，不做 agent；外部 AI 只读消费，不提供提交内容接口。

## 当前阶段目标

当前阶段围绕通用 listed-company research loop 推进：

```text
给定任意上市公司，系统用统一 entity resolver、source-plan、source-target、
research-pack、review/disposition、unknown、calibration loop 组织研究。
```

NVIDIA / AI compute 是 Gate 1 gold path，不是产品边界。它用来压测系统能否沿 GPU、HBM、AI server、PCB、光模块、电源/冷却、晶圆/封装、洁净室、设备、工艺材料和上游原材料逐层跑深。

每层都必须说明：

- 已有哪几条 L4/L5 fact edge，证据在哪里。
- 哪些只是 observation、lead 或 source-plan。
- 哪些 strength、份额、产能、时间窗口或二源 corroboration 仍未知。
- 下一步应运行哪个 source target、修哪个 source target、审哪个 context、保留哪个 unknown。
- 是否足够进入前端/内部 AI 综合分析；如果不够，缺的是事实、观测、实体、来源、校准样本还是人工 disposition。

成功标准是“层内可解释、可执行、可复现”，不是“全库边数漂亮”。

## Gate 总览

| Gate | 名称                    | 当前判断                                                  |
| ---- | ----------------------- | --------------------------------------------------------- |
| 1    | AI compute 研究链路覆盖 | 进行中                                                    |
| 2    | 财报/年报结构化指标     | baseline 完成，仍需扩样                                   |
| 3    | 关系强度与时间衰减      | baseline 完成，仍需更多真实 evidence                      |
| 4    | Claim 多源融合          | baseline 完成                                             |
| 5    | Observation / signal 层 | baseline 完成，覆盖仍浅                                   |
| 6    | 图算法与风险派生视图    | deterministic baseline 完成，统计输出契约和校准仍需加强   |
| 7    | 持续监控与告警          | worker / source monitor baseline 完成，正式通知入口未完成 |
| 8    | API 与嵌入契约          | contract-only v0 完成，HTTP adapter 未完成                |
| 9    | 内部 AI 分析层安全接入  | 未开始                                                    |
| 10   | 质量、性能、可维护性    | 持续推进                                                  |

## Gate 1 — AI Compute 研究链路覆盖

目标：围绕 AI compute / memory 问题，把官方事实、观测、unknown、source target 和下一层 frontier 组织成可递归展开的研究链路。

必须具备：

- SEC、DART-KR、EDINET、TWSE/HKEX 等多市场官方披露 source coverage。
- GLEIF / registry / entity metadata 支撑跨市场实体对齐。
- AI compute profile 覆盖公司、组件、材料、设备、工艺 frontier。
- 每个 propagation layer 输出 fact、observation、lead、unknown、source target、official evidence gap。
- source targets 按 `official_evidence / observation_proxy / entity_or_facility_context / lead_or_manual_review` 分组。
- `next_research_targets` 和 `execution_queue` 能告诉前端/host app 下一步该跑、修、审还是保留 unknown。
- 任意上市公司入口仍走通用 research loop，不新增公司专用 workflow。

完成标准：

```text
[ ] 至少 25 个核心研究节点有官方披露 source coverage
[ ] 每个核心 propagation layer 有明确状态和解释
[ ] 至少 30% fact edge 有第二来源 corroboration 或明确 single-source disposition
[ ] 任一 fact edge 都能追到 evidence_id、doc_id、source_url、cite_text、offset/fingerprint
[x] AI compute / memory profile 覆盖核心 component / material / equipment / process frontier
[x] propagation readiness 输出 evidence_layer_summary / source_target_groups / official_evidence_gaps / readiness_answers / execution_queue
[x] source target 状态能回流到 Gate 1 workbench 和 run ledger
[x] 递归 frontier research 带 lineage，不自动继承父包事实
```

当前状态：Gate 1 的 readiness、backlog、run ledger、data-depth workbench、propagation matrix、corroboration source plan 已经能输出。SEC、官方 IR、DART-KR、EDINET、TWSE MOPS、Apple Supplier List、GLEIF 的基础路径已接入；DART/EDINET/TWSE 当前仍主要是目录/target/readiness/monitor 骨架，正文解析与可审计 evidence 提取仍待后续。

主要缺口：

- NVIDIA / AI compute 可见 L4/L5 深度仍不足，不能用全库边数或 Apple 广度边替代。
- Counterparty 官方二源 corroboration 和 disposition 样本仍不足。
- DART / EDINET / TWSE 正文下载、解析、关系抽取仍未完成。
- 真实 gold label / calibration 样本仍少。

## Gate 2 — 财报/年报结构化指标

目标：财报不只是供应商文本来源，也要变成可比较的供应链前导指标。

必须具备：

- SEC companyfacts / XBRL company facts 读取。
- 指标 catalog：inventory、cost of revenue、capex、purchase obligations、accounts payable、customer concentration、segment revenue。
- 公司内跨期序列。
- 同行横向比较。
- 每个数值可追溯到 accession、period、taxonomy tag、source URL。

完成标准：

```text
[x] 至少 5 家核心公司有财报指标时序
[x] ComponentCard / CompanyCard / research-pack 能展示相关指标变化
[x] 同一指标同一期间能生成 deterministic peer z-score / percentile
[ ] customer concentration / segment revenue 仍需更强维度解析或文本证据
```

## Gate 3 — 关系强度与时间衰减

目标：事实边从“有/无”升级到“有多重要、多久没验证”。

必须具备：

- `edge_strength_estimates`
- `edge_freshness`
- edge-scoped strength unknown。
- freshness-adjusted risk context。

完成标准：

```text
[x] strength / freshness schema 已落库
[x] Workbench / research-pack / cards 可导出 intelligence context
[x] L4/L5 fact edge 可通过 refresh 获得 strength 或 explicit unknown
[x] 过期/未复核边在 risk view 中降权
[ ] 更多真实关系仍缺 share / capacity / dependency evidence
```

## Gate 4 — Claim 多源融合

目标：解决单条 evidence min-cap 的天花板问题。

必须具备：

- claim 支持 primary / supporting / contradicting evidence。
- source independence weight。
- deterministic confidence fusion。
- conflict unknown 和 lifecycle warning。
- review-safe conflict handling。

完成标准：

```text
[x] claim fusion 有 deterministic regression fixtures
[x] contradicting evidence 与 conflict unknown 可导出
[x] conflict adjudication 不允许自动改 facts
[x] conflict review 可进入 review queue 并走 safe-write apply path
[x] active claim 挂在 deprecated/historical edge 上时有 lifecycle warning
```

## Gate 5 — Observation / Signal 层

目标：建立真正的供应链信号，而不是把 signal 当背景句或事实边。

必须具备：

- `FINANCIAL_METRIC_OBSERVATION`
- `TRADE_FLOW_OBSERVATION`
- `COMMODITY_PRICE_OBSERVATION`
- `ENERGY_PRICE_OBSERVATION`
- `POLICY_OBSERVATION`
- facility / capacity / construction / equipment / process material observations
- observation coverage 与 series readiness。
- propagation readiness。

完成标准：

```text
[x] observations 有统一 source_item / time_window / metric / geography / component_id contract
[x] observations 不会被 graph-builder 当成 fact edge
[x] 至少 3 类 observation 能在 cards / research-pack 中显示
[x] 至少 1 类 observation 有变化检测
[x] observation coverage 能区分 sparse / explicit-baseline ready / time-series ready
[x] propagation readiness 能把需求、扩产、设施、设备、材料、政策信号拆成 ready / partial / blocked
[x] explicit baseline / trailing median-MAD 变化检测有 deterministic fixtures
[ ] trade / policy / facility / process-material 覆盖仍需扩深
```

## Gate 6 — 图算法与风险派生视图

目标：识别集中度、单点失效、替代路径、瓶颈和传播影响。

必须具备：

- HHI / concentration。
- single-source exposure。
- path redundancy。
- node knockout reach / weighted impact。
- betweenness / weighted path centrality。
- freshness-adjusted exposure。
- policy exposure。
- risk metric semantic change。

完成标准：

```text
[x] ComponentCard 能显示集中度和单点失效候选
[x] CompanyCard 能显示 top exposure nodes
[x] risk metrics 可重算且 determinism test 通过
[x] path redundancy / weighted impact / weighted centrality 有 regression fixtures
[x] 同期 peer z-score / percentile 有 deterministic fixtures
[x] calibration labels 能输出 precision / reliability bucket / error summary
[ ] 统计输出需要统一暴露 sample size、window、method、model version、calibration status
[ ] weighted metrics 真实样本校准和阈值治理未完成
[ ] 默认报告不能出现未经契约化的 p-value、显著性、贝叶斯、因果或预测结论
```

## Gate 7 — 持续监控与告警

目标：从一次性研究工具升级为持续运行系统。

必须具备：

- durable source check jobs。
- per-target cadence / jitter / priority / retry / backoff。
- source health / degraded / failure semantics。
- semantic change events。
- alert candidate lifecycle。
- worker loop。
- attention queue。

完成标准：

```text
[x] source check 有 durable job/outbox、lease、retry/backoff、dead 状态
[x] worker loop 复用 runDueSourceChecks
[x] cached fallback 不会被误记为成功
[x] changes timeline 区分 source / graph / semantic / risk change
[x] alerts 只引用 risk_view / observation / source event，不改事实层
[x] attention queue 汇总 claim conflict、claim lifecycle、alert、source degraded、requires-attention change
[ ] attention queue 缺正式消费 API / host app 入口
[ ] 通知通道未完成
```

## Gate 8 — API 与嵌入契约

目标：后端能被正式前端、内部只读 AI 分析层和外部只读 app/AI 消费。

当前 v0 contract surface：

```text
GET /companies/:id/card
GET /components/:id/card
GET /chains/:scope
GET /claims/:id
GET /evidence/:id
GET /observations/:scope
GET /risk-views/:scope
GET /changes
GET /sources/health
GET /unknowns/:scope
GET /companies/:id/consumer-read-model
GET /companies/:id/reasoning-walkthrough
POST /review/:id/approve
POST /review/:id/reject
```

要求：

- API DTO 不泄漏 DB row。
- JSON schema / OpenAPI 版本化。
- WorkbenchModel 继续保留离线导出能力。
- GraphStore / DatabaseStore 可由宿主 app 注入。
- 外部 AI / 外部 agent 只读消费，不提供外部 AI 提交候选、证据、source target 或爬虫结果的写接口。

完成标准：

```text
[x] apps/api 有 contract tests
[x] OpenAPI 3.1 contract 可生成
[x] contract audit 能检查 DTO 不来自 DB Row
[x] consumer-read-model / reasoning-walkthrough 已纳入 API contract
[ ] HTTP adapter 未完成
[ ] research-preview 或未来正式前端尚未只消费 API/Workbench DTO
[ ] 无 Docker snapshot path 与 DB-backed path 仍需同时保留并验证
```

## Gate 9 — 内部 AI 分析层安全接入

目标：让内部 AI 基于可信结构化上下文做解释、摘要、判断草稿和下一步研究建议，但不污染事实层，也不演变成自动行动 agent。

允许：

- Read-only analyst。
- Report / explanation renderer。
- Query assistant，把自然语言问题转为只读查询或只读 API 调用计划。

禁止：

- LLM 写 `edges`。
- LLM approve review。
- LLM 提升 `evidence_level`。
- LLM 运行 source connector、联网爬虫或抓外部网页。
- LLM 创建、关闭或 resolve unknown。
- 外部 AI 提交 evidence/review/source/crawl/correction 内容。

完成标准：

```text
[ ] 内部 AI 输出有 schema validation
[ ] 内部 AI 输出引用已有 evidence_id / claim_id / observation_id / unknown_id / source target ref
[ ] 内部 AI 输出明确区分 fact / observation / lead / unknown / risk metric / policy constraint
[ ] 内部 AI 输出包含 cannot_conclude / assumptions / next_actions
[ ] next_actions 不授权自动写 truth store
[ ] audit log 能复现内部 AI 输入、输出、模型、prompt version
[ ] 外部 AI 只有只读 API 消费路径
```

## Gate 10 — 质量、性能、可维护性

目标：系统能长期扩展，不靠补丁。

必须具备：

- 文件不过度膨胀，核心代码文件超过 700 行必须评估拆分。
- 业务规则在 domain / feature 内聚，CLI / apps 保持薄入口。
- Row / DTO / Domain Contract 边界清晰。
- upsert / terminal state / job lease / review decision 有并发保护。
- package 数量受控；合并必须基于职责和依赖审计，不机械搬文件。
- 每个核心输出有 regression fixture 或 contract test。

完成标准：

```text
[x] type-check / lint / unit / dep-check / format-check / build 可通过
[x] source job lease、policy sync、research-pack 写库边界等高风险问题已处理
[x] module-design 已更新当前模块边界
[ ] Entity / DTO / DB Row 边界仍需继续全项目治理
[ ] env / logger 隐式全局依赖仍需继续治理
[ ] 大文件和历史胶水仍需持续拆分
```

## 当前优先级

接下来不应继续无穷打磨底座，也不应马上做自动 AI agent。建议顺序：

1. 补 Gate 8 HTTP adapter 的最小只读实现，围绕现有 contract，不另造 DTO。
2. 建内部 AI analysis contract，只读消费 `consumer-read-model` 和 `reasoning-walkthrough`。
3. 继续 Gate 1 数据深度：更多二源 corroboration、single-source disposition、official evidence gap、gold label。
4. 推进真实样本 calibration 和 risk threshold 治理。
5. 继续质量治理：大文件拆分、DTO/Row 边界、source domain 内聚。

## 最终判定

当前可以说：

```text
SupplyStrata 已经是证据优先的供应链情报后端 alpha，
具备事实、观测、unknown、risk baseline、source monitor、research-pack 和 API contract。
```

当前还不能说：

```text
SupplyStrata 已经是全球供应链监控、风险提示、动态追踪、货物流向综合情报系统。
```

缺口主要在：

- 官方事实覆盖规模。
- 真实样本校准。
- 正式 HTTP/API 消费路径。
- 内部 AI 只读分析层。
- 通知/告警消费入口。
- 货物流向与上游材料 observation 深度。
