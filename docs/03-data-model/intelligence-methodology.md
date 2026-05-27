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

内部 AI 是只读 analyst layer，不是 agent。

它可以读取 API / Workbench / research-pack 的结构化上下文，帮助用户理解：

- 当前可引用事实是什么。
- 哪些只是 observation、lead 或 policy constraint。
- 哪些 unknown 阻止进一步结论。
- 哪些 source target、review item 或 calibration label 值得优先处理。
- 哪些结论当前不能说。

它不能：

- 联网搜索、爬虫抓取或运行 source connector。
- 写 truth store、审批 review、关闭 unknown。
- 创建 L4/L5 fact edge、提升 `evidence_level`。
- 把 observation、lead、policy constraint 改写成事实关系。
- 把自己的摘要作为 evidence / claim fusion 输入。

外部 AI / 外部 agent 只是只读消费者。它可以调用公开 API，自行联网、校对或生成外部分析，但这些行为不属于 SupplyStrata 的可信边界。SupplyStrata 不提供外部 AI 提交 evidence candidate、review candidate、source target suggestion、爬虫结果或自动校对结果的写入接口。

边界如下：

```text
SupplyStrata 提供客观、分层、可追溯、可审计的数据；
内部 AI 解释这些数据；
外部 AI 可以只读消费这些数据，但外部探索结果不回写 SupplyStrata。
```

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

| 方法学能力                          | 主要实现边界                                         |
| ----------------------------------- | ---------------------------------------------------- |
| fact edge 写入                      | `graph-builder`、`pipeline`、`review-store`          |
| claim fusion                        | `claim-builder`                                      |
| strength/freshness/risk/calibration | `evidence-maintenance`                               |
| observation 写入                    | `observation-store`、`source-workflows`、`pipeline`  |
| source target/monitor               | `source-plan`、`source-management`、`source-monitor` |
| workbench/research output           | `workbench-export`、`research-pack`                  |
| public consumer contract            | `apps/api`                                           |

## 完成口径

后端方法学可认为基本成立，需要同时满足：

- fact / observation / lead / unknown / risk / AI analysis input 分层清楚。
- L4/L5 fact edge 可追溯到 evidence、source、cite text。
- strength、freshness、risk view 都是派生层，且有 unknown / missing input 说明。
- claim fusion deterministic、可测试、不会提升 evidence level。
- observation anomaly 和 risk metric 可重算、可解释。
- propagation readiness 能说明每层已知、未知、缺口、下一步和禁止写入。
- calibration 样本能持续积累，用来治理 confidence、ranking 和 risk threshold。
- 内部 AI 只读解释；外部 AI 只读消费；没有 AI 写 truth store 的路径。

没有这些，只能说“事实图谱可用”，不能说“供应链情报网络后端完成”。
