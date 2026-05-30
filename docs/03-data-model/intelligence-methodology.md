# Intelligence Methodology — 供应链情报方法学

本文定义 SupplyStrata 的情报方法学边界。它不是实现日志，也不记录每个功能的落地细节；具体 schema 见 [schema.md](./schema.md)，证据规则见 [evidence-model.md](./evidence-model.md)，完成门槛见 [backend-completion-criteria.md](../06-development/backend-completion-criteria.md)。

## 核心原则

SupplyStrata 的核心价值不是“把图画满”，而是让每个结论都能被追溯、反驳和重建。

必须始终分清六类概念：

| 概念                 | 回答的问题                             | 事实层 | 可用于风险 |
| -------------------- | -------------------------------------- | ------ | ---------- |
| `evidence_level`     | 证据来源有多强？                       | 是     | 否         |
| `confidence`         | 当前抽取/解析对这条证据有多确信？      | 是     | 否         |
| `relation_strength`  | 这条关系有多重要？                     | 否     | 是         |
| `freshness`          | 这条关系多久没有被重新验证？           | 否     | 是         |
| `observation_signal` | 外部观测是否发生异常或趋势变化？       | 否     | 是         |
| `risk_metric`        | 节点、组件、路径、地区的暴露有多集中？ | 否     | 是         |

一句话：

```text
evidence_level 保证“这件事是否有可靠证据”；
strength / freshness / observation / risk_metric 才解释“这件事是否重要、是否危险、是否变化”。
```

禁止把风险、热度、行业常识、LLM 判断、新闻线索或图算法结果写进事实边。

## AI 边界

SupplyStrata 不内置 agent，也不是 AI 产品。智能层在调用方。

```text
SupplyStrata 提供客观、分层、可追溯、可审计的供应链事实与证据；
外部 AI agent（Cursor / Claude Desktop / 自建 / @supplystrata/agent 参考实现）
  通过 MCP 消费这些数据；
agent 自己负责理解、搜索补充、综合、写报告；
任何 agent 都不能绕过下面的 LLM Helper 边界和 Fact 写入不变式。
```

详见 [decisions.md](../10-decisions/decisions.md) #3、#9。

### LLM Helper 边界

核心代码里所有 LLM 调用必须经过 `@supplystrata/llm-helpers`。该包导出 4 个有限用法：

| Helper                     | 用途                                | 输入                                         | 输出                                                 | 不允许                                          |
| -------------------------- | ----------------------------------- | -------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------- |
| `disambiguate_entity`      | 多候选实体消歧                      | surface + nearby_text + candidate list       | candidate ranking with confidence + reason           | 直接写 entity_master；多步循环                  |
| `derive_dynamic_profile`   | 从公开简介派生 plan-context profile | company description / SIC code / 10-K Item 1 | expected upstream components + source targets (plan) | 持久化 profile；写 fact / observation / unknown |
| `suggest_source_targets`   | 建议下一步该跑哪些 source target    | current source coverage + unknown context    | candidate source targets (plan, with rationale)      | 执行 source check；自动 sync target             |
| `summarize_with_citations` | 在已有 evidence 上做带引用的摘要    | evidence_id list + question                  | summary text + required citation refs                | 凭空生成 cite；引用未在输入中出现的 evidence_id |

硬约束（违反必须 CI 拦截）：

1. 任何写 `edges` / `evidence` / `claims` 的代码路径**不允许 import `llm-helpers`**。
2. 每个 helper **必须返回 candidate**（带 status、cite 来源、置信度），不能返回 final fact。
3. 每个 helper **单步**（不是 agent loop）；多步推理由调用方 agent 在 SupplyStrata 之外编排。
4. 全局环境变量可禁用所有 LLM 调用，禁用后 SupplyStrata 完整可用（行为退化为：identity bootstrap 只走 registry；profile 用 generic；suggest 不可用；summary 不可用）。
5. `ai_analysis_runs` 记录 provider/model、input refs、guardrail refs、prompt/output hash、错误；不保存密钥；不写 fact edge。

### MCP 接入面边界

外部 agent 通过 MCP 接入；MCP 暴露两类工具：

- **read tools / resources**：自由调用，返回当前 cache + audit 状态。
- **write tools**（`run_source_check`、`start_research_session`、`review.approve`、`review.reject` 等）：使用标准 MCP annotations，并由 server-side pending state + 单次 `confirmation_token` 做真正确认边界；任何写入仍走 evidence-gated promote (#13)，agent 不能绕过事实写入不变式。
  - `run_source_check` 在同一进程内跑完 source check → normalize → extract → evidence-gated promote：规则抽取的高可信关系会按 #13 自动写成 current 边，事实主干因此通过 MCP 走通，无需 CLI 专属步骤。
  - `review.approve` 在确认边界内直接对候选做 evidence-gated apply：可落边的候选写出 current 边/实体，只需登记处置的候选记 disposition；而不是只翻转 review 状态。`review.reject` 仍只翻转状态、不动事实。

确认门的口径必须精确，避免把它误读成系统内置的 human-in-the-loop：

- SupplyStrata 强制的是 **两步显式确认 + 单次 token + server-side pending + 全程可审计**：第一次调用只返回 `requires_confirmation`，必须用同一 server 颁发的、未过期、未用过的 `confirmation_token` 二次调用才执行；伪造 / 过期 / 已用 token 一律拒绝。
- 它**不**区分"人类宿主"和"自主 agent"。`confirmation_token` 通过 MCP 结果回给调用方，因此任何能读结果的 client（包括 `@supplystrata/agent` 参考实现）都可以在同一 loop 内自动回填 token 完成确认。这是预期行为：确认门防的是**误调用 / 意外写入 / 单步污染**，保证每次写入都有可追溯的 pending→confirm 记录，而不是替代人类审批。
- **真正的 human-in-the-loop 是 host 的责任**：需要人工把关时，宿主（Cursor / Claude Desktop / 自建 orchestrator）应在 token 回填前插入人工确认，或采用 out-of-band 确认通道。SupplyStrata 不假设、也不强制宿主这样做。
- 因此方法学层的不变式是"**写入必须经过受控两步确认门 + evidence-gated promote**"，而不是"agent 在技术上无法自动确认"。

SupplyStrata 不提供任何 MCP write tool 让 agent 直接提交 evidence / fact / 爬虫结果；agent 探索结果只能作为 candidate 进入 review 路径。

## 当前数据生成边界

本节记录当前已经落地的数据生成边界。

主流程是 9 步统一数据流，详见 [data-flow.md](../02-architecture/data-flow.md)：

```text
[1] company query
[2] universal identity bootstrap (GLEIF / OpenFIGI / Wikidata / 各国官方目录)
[3] dynamic profile derive (anchor 或 llm-helper, plan-context only)
[4] source plan & routing
[5] source checks (官方源 fetch + 归档)
[6] normalize & parse
[7] extract (rule + opt-in LLM helper, 候选)
[8] evidence-gated promote (auto / opt-in review)
[9] consume via MCP
```

每一层只能生成自己被允许生成的对象：

| 阶段                                 | 可以生成什么                                                     | 不能生成什么                                 |
| ------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------- |
| identity bootstrap                   | entity identity、alias、identifier、source provenance            | 供应链关系、风险结论                         |
| dynamic profile derive               | plan-context (expected components + source targets)              | 持久化 profile；fact / observation / unknown |
| source plan / checks                 | source target、source health、run status、retry/backoff          | "已证明供应商关系"                           |
| parsing / extraction                 | chunks、observations、relation candidates、semantic change       | approved fact                                |
| evidence-gated promote (auto)        | edges + evidence + change_records（仅 rule + 官方 + L≥4 或双源） | LLM 单源；弱源；有冲突                       |
| review (opt-in)                      | review decision、accepted/rejected candidate                     | 没有证据的行业常识补全                       |
| built-in profile (anchor)            | 验收锚点、expected source、readiness/backlog context             | 全球行业覆盖、动态业务画像                   |
| LLM helper                           | 4 个具名 candidate（见 LLM Helper 边界一节）                     | truth-store 写入；多步循环；agent 行为       |
| MCP read                             | 当前 cache + audit 状态                                          | 触发新 LLM；隐式 source check                |
| MCP write (server-side confirmation) | 入队 source check / 创建研究 run / approve review                | 直接写事实；绕过 evidence-gated promote      |

### 当前 Profile 能力

`research target profile registry` 现在分两层（与 [decisions.md](../10-decisions/decisions.md) #12 一致）：

**Layer A — 内置 verification anchor profile**

- `ai-compute-memory.v0` 和 `ev-battery-energy.v0`。
- 角色：gold path 验证用，**不是产品覆盖范围**。
- 命中条件：精确匹配 anchor 内 entity / component scope。
- 用途：CI 回归 fixture、文档示例、calibration 锚点。
- 限制：不写 fact edge，不提升 evidence level，不代表整条行业链已覆盖。

**Layer B — 运行时 derived profile**

- 命中 anchor 失败时，调 `llm-helpers.derive_dynamic_profile` 派生。
- 输入：公司公开简介 / SIC code / NAICS / 10-K Item 1 / Wikidata description。
- 输出：expected upstream components + source targets（plan-context only）。
- 生命周期：**单次 research session 内**；session 结束即丢；不持久化。
- 用户/agent 可通过 MCP tool 参数显式覆盖。

两层都可以由调用方关闭（`profile=none`），关闭后只走纯 source-plan + 国家路由。

### MCP Handoff

外部 agent 通过 MCP 消费 SupplyStrata 时，input / output 边界：

```text
allowed agent inputs  = MCP resources (scbom / evidence / unknowns / changes / source-health)
                      + MCP read tools (resolve_company / traverse_chain / read_evidence_for_edge)
                      + MCP write tools (server-side confirmation)

allowed agent outputs = agent 自己的报告、解释、跨源综合（不写回 SupplyStrata）
                      + 通过 MCP write tool 入队 source-check / 创建研究 run
                      + 通过 MCP write tool 提交 review decision（仍需 evidence-gated promote）
```

SupplyStrata 不发现"真实世界发生了什么"。真实世界由官方源 + adapter + parser + extractor 决定；agent 只能基于已有 evidence 帮助人理解、跨源综合、生成可引用报告。

## Fact 写入不变式

下面 7 条是方法学的"宪法"，跨所有 package、跨所有 client、跨所有部署形态都成立。违反任何一条都属于系统性 bug。

1. **任何写 `edges` / `evidence` / `claims` 的代码路径不允许 import `@supplystrata/llm-helpers`**。LLM 永远不直接写事实。
2. **LLM helper 必须返回 candidate**（不能返回 final fact）；任何 candidate 进入事实层都要经过 evidence-gated promote。
3. **agent loop 不允许直接写库**；MCP write tools 必须经过 server-side pending state + 单次 `confirmation_token`（两步确认、token 单次有效、全程可审计）。注意：该门保证"每次写入都有受控的 pending→confirm 审计记录"，**不**等于"agent 在技术上无法自动确认"——token 会回给调用方，自主 agent 可在同一 loop 内确认；真正的人工审批是 host 的职责（见"MCP 接入面边界")。
4. **community-pack 是 read-only baseline**；本地写入覆盖 pack 字段但不污染 pack；pack 升级时本地新写入保留。
5. **terminal state** (`deprecated` / `superseded` / `rejected` / `resolved` / `dead`) **不能被普通 upsert 复活**；必须走显式 lifecycle workflow 并写 change record。
6. **observation / lead / source health / risk metric / AI 输出永不写 fact edge**。它们只能进入派生层或 review 队列。
7. **fact edge 的两端必须解析到不同的已登记实体**。缺端点（交易对手未登记）→ 记 `unknown_item`，不写半截边；两端解析到同一实体（如年报第三人称自指"X 报告其……"被误读成 X→X）→ 直接丢弃，绝不写自环边。**关系抽取资格只由文档披露类型决定、不绑定来源/国家**（SEC、各国 IR 年报、EDINET/DART 英文披露同一套抽取）；信任不靠"是不是 SEC"，而由 evidence-scorer 按来源 authority 单独封顶（见 [evidence-model.md](evidence-model.md) source authority matrix）。

详见 [decisions.md](../10-decisions/decisions.md) #3、#13。CI 应通过 dep-check / lint 规则机械化拦截违反 #1、#3 的 import 边界。

## 分层方法

### Fact Layer

事实层只回答：

```text
谁和谁存在什么公开可证的关系？
证据来自哪里？
原文是什么？
抽取是否可靠？
还有哪些未知？
```

事实层对象：

- `edges`
- `evidence`
- `claims`
- `unknown_items`
- source provenance

事实层硬规则：

- fact edge 必须有可追溯 evidence。
- L4/L5 只能来自官方或强审计来源。
- observation、lead、official signal、source health、risk metric 都不能自动升级成 fact edge。
- unknown 是一等公民；不知道就显式记录，不用猜测填空。
- deprecated / superseded / rejected / resolved 等终态必须受保护，不能被普通 upsert 复活。

### Unknown Map

unknown map 回答：

```text
哪些关键问题阻止我们进一步下结论？
```

典型 unknown：

- 命名 edge 缺 share、capacity、dependency 或 time window。
- 只有单一来源，缺 counterparty corroboration。
- official source target 存在但未运行、失败或 blocked。
- observation 只能说明变化，不能证明公司级关系。
- entity / business unit / facility 仍未消歧。
- 关系已经过旧，freshness 降权但尚未被新证据确认。

规则：

- unknown 不是失败；它是研究边界。
- unknown 关闭必须有 evidence、review decision 或 explicit disposition。
- AI summary 不能关闭 unknown。
- 没有足够证据时，报告必须说“不能下结论”，而不是省略该问题。

### Relation Strength

关系强度回答：

```text
如果关系成立，它对主体有多重要？
```

第一版强度类型：

| strength_kind | 含义                   | 可接受来源                                     |
| ------------- | ---------------------- | ---------------------------------------------- |
| `share`       | 占比                   | 命名 counterparty 的明确百分比披露             |
| `spend_band`  | 金额/支出区间          | supplier list spend band、采购承诺             |
| `dependency`  | 依赖等级               | sole supplier、single-source、limited supplier |
| `capacity`    | 产能承诺或预留         | capacity reservation、take-or-pay、长期协议    |
| `qualitative` | 官方文字给出的强弱语义 | primary、strategic、key、major、significant    |

强度必须带 provenance：

```text
strength = value + evidence_id + method + time_window
```

禁止：

- 匿名 customer concentration 写到命名 edge。
- 用新闻、行业常识或 LLM 推测占比。
- 没有 share 时把供应商均分。
- 没有 strength 时装作已知；必须保留 edge-scoped unknown。

### Freshness

事实边不会因为旧就自动失效，但风险派生层必须知道证据是否新鲜。

第一版时间衰减：

```text
age_days = now - last_verified_at
freshness_score =
  1.00 if age_days <= 180
  0.85 if 180 < age_days <= 365
  0.70 if 365 < age_days <= 730
  0.50 if age_days > 730 and no recent corroboration
```

规则：

- freshness 只影响 intelligence / risk view，不降低 `evidence_level`。
- 新证据重新确认关系时刷新 `last_verified_at`。
- 新文件删除或改变原关系时进入 semantic change / review，不自动 deprecate。

### Claim Fusion

Claim 层把多个 evidence 组合成一个可读、可审计、可解释的结论。

第一版融合采用确定性 Noisy-OR：

```text
support_confidence = 1 - Π(1 - adjusted_evidence_confidence_i)
```

source independence weight：

| source relation              | weight |
| ---------------------------- | ------ |
| 同一 doc 同一 chunk          | 0.00   |
| 同一 document 不同 chunk     | 0.25   |
| 同一 source adapter 不同文档 | 0.50   |
| 不同 source adapter          | 1.00   |
| 对手方/供应商独立披露        | 1.00   |
| observation                  | 0.20   |
| lead / news                  | 0.10   |

硬规则：

- 融合只能提升 claim confidence，不能提升单条 evidence 的 `evidence_level`。
- 多条弱新闻不能把事实边升级成 Level 4/5。
- 反证必须保留为 contradicting evidence、conflict state 或 unknown。
- LLM summary 不能作为融合输入。

### Observation Signals

Observation 不是关系。它只回答：

```text
公开世界中有什么可复现的变化？
```

典型 observation：

- `FINANCIAL_METRIC_OBSERVATION`
- `TRADE_FLOW_OBSERVATION`
- `COMMODITY_PRICE_OBSERVATION`
- `ENERGY_PRICE_OBSERVATION`
- `POLICY_OBSERVATION`
- `FACILITY_PROFILE_OBSERVATION`
- `CAPACITY_EXPANSION_OBSERVATION`
- `FACILITY_CONSTRUCTION_OBSERVATION`
- `EQUIPMENT_INSTALLATION_OBSERVATION`
- `PROCESS_MATERIAL_OBSERVATION`

Observation 可用于风险、变化检测、研究优先级和 propagation context，但不能证明公司级供应关系。

变化检测第一版采用可解释 baseline：

```text
baseline = explicit baseline or trailing median
mad = median_absolute_deviation
z_like_score = (current - baseline) / max(mad, epsilon)
```

规则：

- 历史窗口不足时只记录 observation，不伪造 anomaly。
- anomaly 只进入 risk view / alert，不写 fact edge。
- policy / sanctions / export-control 是 constraint context；未命中不能解释成“无风险”。

### Statistical / Probabilistic Methods

SupplyStrata 已经使用统计和概率式方法，但只把它们作为可审计的派生层输入，不把它们伪装成事实、因果或投资结论。

当前允许的方法：

| 方法                              | 用途                 | 边界                              |
| --------------------------------- | -------------------- | --------------------------------- |
| deterministic Noisy-OR            | claim support fusion | 融合置信度，不提升 evidence level |
| explicit baseline threshold       | observation anomaly  | 需要显式基线，不证明关系          |
| trailing median / MAD z-like      | 稀疏时序变化检测     | 稳健异常分数，不是 p-value        |
| same-period peer z-score          | 同期公司横向比较     | 标准化比较，不是因果解释          |
| percentile                        | 排名和分位提示       | 只说明相对位置，不说明显著性      |
| reliability bucket / precision    | gold label 校准      | 依赖人工标签样本                  |
| ranking calibration / disposition | 候选排序质量审计     | 排名不是概率                      |

硬规则：

- 每个统计输出必须保留 sample size、time window、baseline、method、model version 和 input refs。
- 样本不足时输出 `insufficient_data`、`unknown` 或 `needs_review`，不能补值。
- 未校准 score 不能解释为真实概率。
- z-score、z-like score、percentile 不能单独生成 fact edge、risk conclusion 或投资判断。
- 当前默认链路不使用严格假设检验、p-value、置信区间、贝叶斯 posterior、因果推断或预测模型作为结论依据。
- 如果未来引入假设检验，必须显式记录 null hypothesis、样本选择、test statistic、p-value / confidence interval、multiple-testing policy、minimum sample size 和适用边界。

### Propagation Context

产业传导分析需要的是一组可审计的推理输入，不是一条新事实边。

AI compute 当前 gold path：

```text
GPU demand -> data center -> PCB / optical module / power / cooling
PCB -> resin / electronic glass cloth / copper foil -> upstream materials
fab expansion -> cleanroom -> equipment -> process materials -> raw materials
```

每层必须输出：

- L4/L5 fact refs。
- observation / lead refs。
- explicit unknown。
- source target state。
- official evidence gaps。
- next research targets。
- allowed outputs 与 prohibited truth-store writes。

允许状态：

| 状态                       | 含义                        |
| -------------------------- | --------------------------- |
| `covered_fact`             | 有可引用 L4/L5 anchor       |
| `observation_ready`        | 有可用观测，但不是事实关系  |
| `official_target_runnable` | 有官方 source target 可运行 |
| `lead_only`                | 只有线索或行业路径          |
| `unknown_open`             | 缺关键事实或强度            |
| `blocked_source`           | 来源、凭据或配置阻塞        |

硬边界：

- 有一个 L4/L5 anchor 不等于整层完整覆盖。
- source target 可运行不等于已经有证据。
- construction、equipment、material price、trade flow 只能作为 propagation context。
- 没有公司级官方证据时，不能写公司级买卖关系。

### Risk / Exposure

Risk view 是派生层，回答：

```text
哪里集中？
哪里单点？
哪些路径缺替代？
哪些节点失效影响大？
哪些证据过旧？
哪些政策约束影响路径？
```

第一版指标：

| metric                          | 目的                        |
| ------------------------------- | --------------------------- |
| `supplier_concentration_hhi`    | 供应集中度                  |
| `single_source_exposure`        | 单一供应商暴露              |
| `path_redundancy`               | 替代路径                    |
| `betweenness_centrality`        | 拓扑瓶颈                    |
| `node_knockout_reach`           | 节点失效可达影响            |
| `node_knockout_weighted_impact` | strength/freshness 加权影响 |
| `freshness_adjusted_exposure`   | 过期证据修正后的暴露        |
| `policy_exposure`               | 政策/制裁/管制暴露          |

规则：

- 风险指标必须记录 input fingerprint 和 model version。
- 缺 strength / freshness 时必须暴露不确定性，不补值。
- risk view 不写 `edges`，不改 `evidence_level`，不自动 approve review。
- 没有 calibration 的风险输出必须标为 baseline / experimental。

### Calibration

所有 confidence、ranking、risk threshold 最终都需要校准。

最低要求：

- 建立 gold review set。
- 抽样 Level 4/5 fact edge，记录人工正确率。
- 输出 reliability buckets。
- 错误分类：抽取错误、实体消歧错误、来源错误、过期错误、语义误判。
- 对 ranking / observation label 记录 useful、wrong direction、background、not useful 等标注。

校准结果只能用于阈值治理和方法学评估，不能自动提升/降低 `evidence_level`，不能自动改 edge。

## 实现映射

本文只定义方法学。当前主要实现位置如下，细节以 package README、单测和源码为准：

| 方法学能力                          | 主要实现边界                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| universal identity bootstrap        | `source-workflows`（GLEIF / OpenFIGI / Wikidata / 各国目录）                            |
| dynamic profile derive              | `llm-helpers.derive_dynamic_profile` + `research-pack`                                  |
| LLM helper (4 用法)                 | `@supplystrata/llm-helpers`（唯一 LLM 调用入口）                                        |
| fact edge 写入                      | `graph-builder`、`pipeline`、`review-store`                                             |
| evidence-gated auto-promote         | `pipeline`、`evidence-scorer`、`graph-builder`                                          |
| claim fusion                        | `claim-builder`                                                                         |
| strength/freshness/risk/calibration | `evidence-maintenance`                                                                  |
| observation 写入                    | `observation-store`、`source-workflows`、`pipeline`                                     |
| source target/monitor               | `source-plan`、`source-management`、`source-monitor`                                    |
| workbench/research output           | `workbench-export`、`research-pack`                                                     |
| SCBOM 开放交换格式                  | `scbom-spec`（独立 repo）+ `workbench-export` 参考实现                                  |
| community-pack 分发                 | release pipeline + Layer 1 加载（详见 [data-flow.md](../02-architecture/data-flow.md)） |
| MCP 接入面（唯一对外 surface）      | `@supplystrata/mcp`（替代旧 `apps/api` REST 路径）                                      |
| 参考 agent（独立 optional 包）      | `@supplystrata/agent` + `apps/agent-cli`（只通过 MCP；不被核心依赖）                    |
| 参考可视化（可嵌入）                | `@supplystrata/web`（Phase F；Web Components + Canvas/SVG）                             |

## 完成口径

后端方法学可认为基本成立，需要同时满足：

- fact / observation / lead / unknown / risk / AI analysis input 分层清楚。
- L4/L5 fact edge 可追溯到 evidence、source、cite text。
- strength、freshness、risk view 都是派生层，且有 unknown / missing input 说明。
- claim fusion deterministic、可测试、不会提升 evidence level。
- observation anomaly 和 risk metric 可重算、可解释。
- propagation readiness 能说明每层已知、未知、缺口、下一步和禁止写入。
- calibration 样本能持续积累，用来治理 confidence、ranking 和 risk threshold。
- 核心代码不内置 agent loop；所有 LLM 调用经过 `@supplystrata/llm-helpers`；任何写 `edges`/`evidence`/`claims` 的代码路径不允许 import 它；外部 agent 通过 MCP 消费，agent 探索结果只能作为 candidate 进 review。

没有这些，只能说“事实图谱可用”，不能说“供应链情报网络后端完成”。
