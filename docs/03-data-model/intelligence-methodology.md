# Intelligence Methodology — 供应链情报方法学

本文定义 SupplyStrata 从“证据事实图谱”升级为“供应链情报网络”时必须遵守的方法学。它补充 [evidence-model.md](./evidence-model.md)、[confidence-scoring.md](./confidence-scoring.md) 和 [relation-model.md](./relation-model.md)，并直接服务 [backend-completion-criteria.md](../06-development/backend-completion-criteria.md)。

## 核心原则

SupplyStrata 必须把下面六个概念分开：

| 概念                 | 回答的问题                             | 是否事实层 | 是否可直接用于风险 |
| -------------------- | -------------------------------------- | ---------- | ------------------ |
| `evidence_level`     | 证据来源有多强？                       | 是         | 否                 |
| `confidence`         | 当前抽取/解析对这条证据有多确信？      | 是         | 否                 |
| `relation_strength`  | 这条关系有多重要？                     | 派生/扩展  | 是                 |
| `freshness`          | 这条关系多久没有被重新验证？           | 派生       | 是                 |
| `observation_signal` | 外部观测是否发生异常或趋势变化？       | 否         | 是                 |
| `risk_metric`        | 节点、组件、路径、地区的暴露有多集中？ | 否         | 是                 |

一句话：

```text
evidence_level 保证“这件事是真的”；
relation_strength / freshness / observation_signal / risk_metric 才能解释“这件事重要不重要、危险不危险”。
```

## 方法学分层

### 1. Fact Methodology

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

事实层禁止保存：

- 总风险分。
- 新闻热度。
- 宏观趋势直接推导出的公司关系。
- LLM 判断。
- 图算法结果。

### 2. Strength Methodology

关系强度回答：

```text
如果这条关系成立，它对主体有多重要？
```

第一版强度类型：

| strength_kind | 含义                   | 示例来源                                     |
| ------------- | ---------------------- | -------------------------------------------- |
| `share`       | 占比                   | customer concentration、供应商采购占比披露   |
| `spend_band`  | 金额/支出区间          | supplier list spend band、采购承诺           |
| `dependency`  | 依赖等级               | single-source / limited supplier risk factor |
| `capacity`    | 产能承诺或预留         | capacity reservation / take-or-pay           |
| `qualitative` | 官方文字给出的强弱语义 | primary supplier、strategic supplier         |

强度必须带 provenance：

```text
strength = value + evidence_id + method + time_window
```

未知就留空，并生成 unknown：

```text
UNKNOWN: exact allocation / exact share / contract price / capacity reservation quantity
```

当前后端第一版由 `@supplystrata/evidence-maintenance` 的 `refreshEdgeIntelligenceContext()` 执行，规则刻意保守：

- 只扫描 `current`、非 inferred、Level 4/5 且有 primary evidence 的事实边。
- `share` 只来自命名 counterparty 的明确百分比披露，例如“Sales to Microsoft accounted for 18% ...”；匿名“one customer accounted for ...”不能写到命名边。
- `dependency` 只来自 `sole supplier / single-source / limited suppliers` 等明确措辞。
- `capacity` 只来自 `capacity reservation / purchase obligation / take-or-pay / long-term supply agreement` 等明确合同或产能承诺措辞。
- `qualitative` 只来自 `primary / strategic / key / major / significant` 等明确强弱语义，且文本必须提到该 counterparty。
- 没有明确 strength 时，生成 `scope_kind='edge'` 的 explicit unknown，说明缺少 allocation、share、contract price 或 capacity schedule；不得用均分或 LLM 猜测补齐。

禁止：

- 用新闻推测占比。
- 用 LLM 给 share 编数字。
- 没有证据时把所有供应商均分。

### 3. Freshness Methodology

事实边不会因为旧就变假，但风险视图必须知道它是否新鲜。

第一版 freshness：

```text
age_days = now - last_verified_at
freshness_score =
  1.00 if age_days <= 180
  0.85 if 180 < age_days <= 365
  0.70 if 365 < age_days <= 730
  0.50 if age_days > 730 and no recent corroboration
```

规则：

- freshness 只影响 risk / intelligence view，不降低 `evidence_level`。
- 新证据重新确认关系时刷新 `last_verified_at`。
- 如果新文件删除了原关系，应进入 semantic change / review，不自动 deprecate。

### 4. Claim Fusion Methodology

单条 evidence 使用 source cap 是正确的，但情报结论需要 claim 层融合多源证据。

Claim 融合目标：

```text
把多个独立证据合成一个可读、可审计、可解释的结论。
```

第一版建议用确定性 Noisy-OR：

```text
support_confidence = 1 - Π(1 - adjusted_evidence_confidence_i)
```

其中 `adjusted_evidence_confidence_i` 必须乘以 source independence weight：

| source relation              | weight |
| ---------------------------- | ------ |
| 同一 doc 同一 chunk          | 0.00   |
| 同一 document 不同 chunk     | 0.25   |
| 同一 source adapter 不同文档 | 0.50   |
| 不同 source adapter          | 1.00   |
| 对手方/供应商独立披露        | 1.00   |
| 宏观 observation             | 0.20   |
| lead / news                  | 0.10   |

硬规则：

- 融合只能提升 claim confidence，不能提升单条 evidence 的 `evidence_level`。
- 多条弱新闻不能把 fact edge 升级为 Level 4/5。
- 反证必须单独建 `conflict_state` 或 `CONFLICTING_EVIDENCE` unknown。
- LLM summary 不能作为融合输入，只能引用已有 evidence/claim。

当前实现：

- `packages/claim-builder` 已实现第一版 deterministic Noisy-OR：只消费同一 current fact edge 下未 supersede、非 inferred 的 evidence。
- `claim_evidence.role` 已区分 `primary` 和 `supporting`；同一 doc/chunk 的重复证据权重为 0，同 source 不同文档权重为 0.50，不同 source adapter 权重为 1.00。
- 融合结果只更新 `claims.confidence`，并在 semantic change payload 中记录 source independence 贡献；不会提升 `evidence_level`，也不会写 graph edge。
- 官方披露 relation `*_REMOVED` 语义变化已生成确定性 `UNK-CONFLICT-*` unknown，并挂到 draft claim 与匹配到的 active claim；这只是冲突边界，不会自动删除或降级 fact edge。
- `linkContradictingEvidenceToClaim()` 已支持把现有 evidence 作为 `claim_evidence.role='contradicting'` 关联到 claim，并生成 blocking conflict unknown。
- `resolveClaimConflictUnknown()` 已通过 `unknown_items` 的 resolve 机制收口，并额外记录 claim-scoped semantic change；它不修改 fact edge。
- Workbench / research-pack 已导出 claim 的 `evidence_refs`、`unknown_refs` 和派生 `conflict_state`，让后续 AI 或研究员先读结构化冲突上下文，而不是从 Markdown 文本猜。
- Workbench / research-pack 也会导出 claim 的 edge lifecycle context：`edge_validity`、deprecation reason、superseded-by edge 和 `active_claim_on_inactive_edge` warning。这样 edge 已经 deprecated 时，active claim 不会在研究包里伪装成当前事实；后续是否 supersede/reject claim 仍需要独立人工流程。
- claim lifecycle 维护由 `claim-builder` 统一执行，目前支持 `supersede_claim`、`reject_claim` 和 `keep_with_context`。三类动作都必须带至少一个已存在的 `evidence`、`review`、`claim`、`unknown` 或 `semantic_change` source ref，并写 `CLAIM_LIFECYCLE_ACTION_RECORDED`。`supersede_claim` / `reject_claim` 只更新 claim status；`keep_with_context` 只记录上下文。任何 claim lifecycle action 都不能修改 fact edge。
- `adjudicateClaimConflict()` 已完成第一版确定性裁决：open blocking unknown + contradicting evidence 会建议 `review_edge_for_deprecation`，resolved conflict 只保留历史上下文；所有裁决都输出 `allowed_edge_mutation='none'`，禁止自动改事实边。
- `buildClaimConflictReviewPacket()` 会把裁决结果包装成 safe-write 审阅包：包含 `review_queue_kind`、`safe_write_status`、`required_review_steps` 和 `fact_write_policy.automatic_fact_mutation_allowed=false`。
- `enqueueClaimConflictReviewCandidates()` 会扫描 active/draft claim 的 contradicting evidence 与 open blocking/boundary unknown，把 unresolved conflict 幂等写入 `review_candidates(kind='claim_conflict_review')`。这条路径只入人工审阅队列，不自动 deprecate edge，不自动修改 claim status。
- `review apply` 对 approved `claim_conflict_review` 只写 `CLAIM_CONFLICT_REVIEW_APPLIED` claim-scoped change record，并把 review candidate 标为 applied；它不修改 `edges`、不修改 claim status、不 resolve unknown。rejected / blocked 决策仍由 review-store 写 `REVIEW_REJECTED` / `REVIEW_BLOCKED` 审计事件。
- 更细的人工 resolution action 由 `claim-builder` 统一执行，目前支持 `confirm_claim_valid`、`recommend_edge_deprecation` 和 `request_more_evidence`。`confirm_claim_valid` 必须带 resolution evidence 并通过 linked unknown 边界关闭 unknown；`recommend_edge_deprecation` 只记录人工建议；`request_more_evidence` 只记录继续调查上下文。三类 action 都会写 `CLAIM_CONFLICT_RESOLUTION_ACTION_RECORDED`，并显式声明 `automatic_fact_mutation_allowed=false`，不能让 AI、worker 或 CLI 直接执行事实层变更。
- 真正的 fact edge deprecation 已收口到独立 lifecycle workflow：只能对 current edge soft-deprecate，必须带至少一个已存在的 `evidence`、`review`、`claim`、`unknown` 或 `semantic_change` source ref，并写 `EDGE_DEPRECATED`。它不删除 evidence，不自动修改 claim status，也不能由 observation/lead 直接触发。
- Workbench / research-pack 现在会额外输出 `attention_queue`：把 claim conflict、claim lifecycle warning、open alert candidates、degraded source health 和 `requires_attention=true` 的 change 统一成即时处理队列。该队列只给研究员和后续 agent 排优先级，不自动裁决冲突、不修改事实边、不关闭 unknown；长期数据缺口仍由 `investigation-backlog` 负责。
- Changes timeline 会把 `evidence_superseded` 和官方披露 relation semantic diff 解析成结构化字段。`EVIDENCE_SUPERSEDED` 说明证据链更新；`SUPPLIER_RELATION_REMOVED / *_CHANGED` 等 relation diff 说明披露文本发生可复现变化。二者都可进入 attention queue，但都不能自动修改 fact edge 或 claim 状态。

### 5. Observation Signal Methodology

Observation 不是关系。它回答：

```text
公开世界中有什么可复现的变化？
```

第一版 signal 类型：

| signal_kind                  | 来源                   | 用途                                                                |
| ---------------------------- | ---------------------- | ------------------------------------------------------------------- |
| `financial_metric_delta`     | SEC/XBRL/财报          | 库存、capex、应付、收入集中度                                       |
| `trade_flow_delta`           | Census/USITC/Comtrade  | 国家/HS/港口贸易变化                                                |
| `commodity_price_delta`      | WorldBank/FRED/LME     | 原材料价格变化                                                      |
| `energy_price_delta`         | EIA/FRED               | 能源成本变化                                                        |
| `policy_event`               | BIS/OFAC/EU            | 管制与制裁暴露                                                      |
| `news_lead`                  | GDELT/新闻             | 线索，优先进入 lead layer                                           |
| `port_activity_delta`        | NOAA/AIS/港口统计      | 物流拥堵或流量变化                                                  |
| `disclosure_semantic`        | 官方披露文本           | inventory/backlog/capex/procurement/customer concentration 语义观测 |
| `official_disclosure_signal` | 官方 IR / 监管披露文本 | 供应链、产能、需求或技术路线的 review-only 信号，不写 fact edge     |

`official_disclosure_signal` 由 source-check / pipeline 在保存官方文档后生成 review candidate。它只把已有文档中的可引用句子推进到人工复核队列，帮助研究员寻找 corroboration、补 claim 或记录 unknown；即使 approved，也只能 acknowledge 并写审计 change，不能自动生成供应链事实边。

research-pack 会用 `official-disclosure-signal-correlation` 纯函数模块，把 open `official_disclosure_signal` 和 edge-level corroboration queue 做确定性 review hint 关联。第一版只看来源是否命中 candidate source / runnable target、信号文本是否提到边两端公司或组件 token，并输出 `review_policy='review_only_no_fact_mutation'`、分数和原因。这个分数只给研究员排序下一步看什么，不计入 Gate 1 data progress，不把 signal 计为二源 corroboration，也不修改 review candidate / edge / claim / unknown。

official signal disposition 是后续审阅结论，不是证据本身。`review-store.recordOfficialDisclosureSignalDisposition()` 只允许记录 `supports_existing_edge`、`needs_more_evidence`、`not_relevant`、`record_single_source_unknown` 或 `create_counterparty_source_target`，并写入 `change_records.change_type='OFFICIAL_DISCLOSURE_SIGNAL_DISPOSITION_RECORDED'`。该事件必须带 `fact_write_policy.automatic_fact_mutation_allowed=false` 和 `allowed_edge_mutation='none'`。即使 decision 是 `supports_existing_edge`，也只表示研究员认为这个 signal 可以作为后续 evidence/claim/unknown/source-target 流程的上下文；真正写 evidence、unknown 或 source target 必须走各自受控用例。`record_single_source_unknown` 也不会由 review-store 直接写 unknown，而是由 `@supplystrata/evidence-maintenance` 的 `materializeOfficialSignalDispositionUnknowns()` 读取审计 change、默认确认目标 edge 仍为 `current`，再通过 unknown repository 写入 edge-scoped `unknown_items` 并记录 `UNKNOWN_ADDED/UPDATED`。这条路径只物化“独立官方二源仍缺失”的未知边界，不写 `edges`、不写 `evidence`，也不把 signal 自动升级成 corroboration。

第一版变化检测：

```text
baseline = trailing median over N periods
mad = median_absolute_deviation
z_like_score = (current - baseline) / max(mad, epsilon)
```

当前已落地的 deterministic baseline 是 `refreshObservationAnomalyViews()`：

- 它优先消费已经带有 `baseline_value` 且能得到 `change_percent` 的 observation；如果没有显式 baseline，则查询同一 `observation_type / scope / geography / component / metric / unit` 的历史 observation，用 trailing median/MAD 计算 baseline 和 z-like score。
- 输出写入 `scope_kind='observation'` 的 `risk_views / risk_metrics`，metric kind 为 `observation_anomaly`。
- 显式 baseline 路径用绝对百分比变化阈值，默认 `25%`；历史窗口路径用 z-like 阈值，默认 `3.5`，默认最多看 12 个历史点，至少需要 5 个可比较历史点。
- `severity` 只表达相对阈值的变化幅度，不是全局风险分。
- 输入指纹包含 observation id、类型、scope、metric、baseline/change 或历史点 id、confidence、阈值和模型参数；同一输入应得到稳定 view / metric id。
- CompanyCard / ComponentCard / research-pack 会在已有 observation anomaly view 时把 anomaly summary 带进 JSON/Markdown 输出；ComponentCard 还会基于当前组件的 Level 4/5 fact edges，显示 supplier/consumer 公司级 `FINANCIAL_METRIC_OBSERVATION`，作为 linked company financial signals。
- research-pack 会输出 `observation-coverage.json/md`，按本研究包可见的 typed observation 汇总 source adapter、scope、component、geography、metric、样本 id 和 methodology gap；它还会按同一 `observation_type / scope / geography / component / metric / unit` 汇总 series readiness，区分 `sparse`、`explicit_baseline_ready` 和 `time_series_ready`。`investigation-backlog` 会把 `sparse` series 转成数据积累任务，提示继续积累同序列窗口点或寻找 explicit baseline/change。它只描述数据准备覆盖和下一步调查，不给风险结论，也不把 observation 升级为事实边。
- research-pack 会输出 `supply-chain-expansion-plan.json/md`，把当前 L4/L5 fact edge frontier、component-context taxonomy、source-plan、official-disclosure readiness 和 edge unknown map 组合成确定性递归展开计划。它回答“下一层应该研究哪个 counterparty / component / route，为什么，现有 source path 是否可跑，在哪里停止”，但只生成 planning/backlog context，不写 fact edge、evidence、claim、observation 或 unknown。递归展开必须带 component/process 语义；没有 `component_id` 的事实边只进入 `needs_component_context`，到达 `max_depth`、catalog boundary 或 logistics/route observation layer 时显式停止，避免把公司级供应商列表无限外推成事实图。
- research-pack 会输出 `gate1-run-ledger.json/md`，把 Gate 1 scorecard、data progress、source path progress、edge-level corroboration 批次和下一层 company switching 计划合成一个可重复执行账本。它只给出当前 mainline phase、下一步 action queue、source-management 命令提示和通用 `research run --company ... --component ...` frontier 建议，不抓源、不写库、不生成事实边。全量官方 source path 的同步/运行继续使用 `source-plan.json`；逐 edge 二源检查使用 `corroboration-source-plan*.json`，避免把全量监控目标和 corroboration 子集混在一起。
- `is_anomaly=true` 时会幂等写入 `OBSERVATION_ANOMALY` semantic change；该事件只引用 observation/risk_view，并把 observation scope、metric、baseline、change percent、severity 和 direction 写入 `after`，用于 timeline 和后续 alert rules，不改变事实层。

第一版同行横向比较由 `refreshFinancialMetricPeerComparisonViews()` 生成：

- 输入只使用 company-scoped `FINANCIAL_METRIC_OBSERVATION`，并且要求 `metric_name / metric_unit` 一致；优先按 `fiscal_year / fiscal_period` 对齐，缺 fiscal period 时才要求 `time_window_start / time_window_end` 完全一致。
- 默认至少 3 家公司才计算，样本不足时跳过，不用行业均值、空值或手写 fallback 补造 peer baseline。
- 输出写入 `scope_kind='financial_metric_peer_group'` 的 `risk_views / risk_metrics`，metric kind 为 `financial_metric_peer_zscore`。
- `value` 保存 signed population z-score；`attrs.percentile / rank_descending / peer_count / mean / standard_deviation / peer_company_ids` 保存可解释上下文。
- CompanyCard / research-pack 会把 company subject 上已有的 `financial_metric_peer_zscore` 带进 JSON/Markdown 的 financial peer position；Markdown 是研究可读输出，正式消费仍以 JSON DTO 为准。
- 该结果只表达同一期间的同行位置，不是 risk score，不会写入 `edges`，也不能作为供应关系或客户关系证据。

规则：

- 没有足够历史窗口时，只记录 observation，不给 anomaly。
- anomaly 只能进入 risk view / alert，不写 fact edge。
- peer comparison 只能比较同单位、同 fiscal period 的财务 observation；没有 fiscal period 的 observation 必须使用完全相同的 time window，不可比期间必须拆成不同 peer group。
- 同一 observation 必须记录 time_window、geography、component/HS/material 映射。
- coverage/reporting 层只能读取 observation DTO、ChainView context segment 和 card DTO；不能从自由文本 label 反推出 observation type。
- series readiness 只是可分析性标记：`explicit_baseline_ready` 表示可用显式 baseline/change 做确定性检测，`time_series_ready` 表示已有至少 5 个历史点加当前窗口点，`sparse` 表示仍需继续积累，不代表没有价值或没有风险。

### 6. Graph Risk Methodology

图算法只在派生层运行。

第一版指标：

| metric                          | 意义                 | 依赖输入                              |
| ------------------------------- | -------------------- | ------------------------------------- |
| `supplier_concentration_hhi`    | 某组件供应集中度     | relation_strength                     |
| `single_source_exposure`        | 单一供应商暴露       | fact edge + strength                  |
| `path_redundancy`               | 可替代路径数量       | fact edge / strength / freshness      |
| `betweenness_centrality`        | 瓶颈节点             | graph topology / strength / freshness |
| `node_knockout_reach`           | 节点失效影响范围     | graph topology + strength             |
| `node_knockout_weighted_impact` | 节点失效加权传播影响 | strength + freshness                  |
| `freshness_adjusted_exposure`   | 过期证据修正后的暴露 | freshness + strength                  |
| `policy_exposure`               | 管制/制裁暴露        | policy observations                   |

Freshness-adjusted HHI baseline：

```text
freshness_adjusted_share_i = supplier_share_i * freshness_score_i
HHI = Σ freshness_adjusted_share_i^2
```

share 或 freshness 未知时：

- 如果有明确 single-source 文本，可按 `dependency=single_source` 处理。
- 如果没有 share，不能均分；risk view 必须显示 `share_unknown=true`。
- 如果没有 freshness，不能把旧证据当成新证据；risk view 必须显示 `freshness_missing=true`。

当前已落地的 deterministic baseline 是 `refreshComponentRiskView()`：

- 输入只包括 `current`、非 inferred、Level 4/5、component-scoped fact edge，以及对应 `edge_strength_estimates` / `edge_freshness`。
- 输出写入 `risk_views` / `risk_metrics`，不写 `edges`，不改变 `evidence_level`。
- HHI 只有在所有相关供应边都有明确 share 和 freshness 时才写数值；缺 share 或缺 freshness 时写 `value=NULL` 并暴露 `missing_share_edge_ids / missing_freshness_edge_ids`。attrs 会保留 `raw_hhi` 和每条边的 raw/freshness-adjusted share，避免把陈旧披露当作同等新鲜的集中度证据。
- 单点暴露来自“只有一个供应商”或明确 `dependency=single_source`，不由 LLM 或匿名风险句子推断。
- `path_redundancy` 当前沿 component-scoped Level 4/5 fact edge 的 supplier -> consumer 方向，寻找从 source supplier 到 terminal consumer 的 simple upstream paths；`value = Σ max(path_count_by_terminal - 1, 0)`。attrs 同时保留 `direct_supplier_count / direct_alternate_supplier_count`，用于审计“直接 supplier 多”与“真实替代路径多”的差异。重复的同向 route edge 会先折叠，避免把重复证据误读成替代路径。若路径上所有边都有 strength/freshness，还会输出 `weighted_alternate_path_score`；任一路径缺权重时正式加权分数保持 `null`，并输出 `known_weighted_alternate_path_score / weighted_missing_edge_ids` 供审计。
- `node_knockout_reach` 当前沿 component-scoped Level 4/5 fact edge 的 supplier -> consumer 方向计算下游可达实体数；它是无权多跳 reachability baseline。
- `node_knockout_weighted_impact` 当前沿同一有向图计算 max-product path 传播：每条边权重为可追溯 `strength_weight * freshness_score`，每个下游实体只取当前已知最强路径，最终 value 是这些实体 impact 的求和；缺 strength 或 freshness 的边只写入 `missing_weight_edge_ids`，不做均分、不做补值。
- `betweenness_centrality` 当前使用 component-scoped Level 4/5 fact edge 的有向无权图，按 supplier -> consumer 方向计算瓶颈节点；metric `value` 保持 unweighted shortest-path betweenness。attrs 额外输出 `weighted_path_centrality_score`：它按 source supplier 到 terminal consumer 的 simple path，把每条路径的 `strength_weight * freshness_score` 乘积累加到内部节点，用于区分“拓扑瓶颈”与“高权重路径瓶颈”。缺权重边只进入 `weighted_missing_weight_edge_ids`，不补值。
- `freshness_adjusted_exposure` 是 experimental baseline，用于让过期证据在派生视图里降权；它不是正式风险评分。
- 同一 component 的新版 risk view 会与上一版同模型派生结果做稳定 metric key 对比；超过每类指标的绝对阈值或 25% 相对阈值时，写入 `change_records.change_type='RISK_METRIC_CHANGED'`。
- `RISK_METRIC_CHANGED` 使用 `scope_kind='risk_metric'`，`scope_id` 为稳定 metric key；事件只记录 before/after、阈值、方向和 severity，不反写 fact edge，也不提升 evidence level。
- component risk alert 只消费派生 risk metric，不直接读取或修改 fact edge。当前阈值 policy 是 `alert-rules.component-risk.threshold-policy.v1`：`single_source_exposure>=1`、`supplier_concentration_hhi>=0.25`、`node_knockout_reach>=1`、`node_knockout_weighted_impact>=0.25`、`betweenness_centrality.attrs.weighted_path_centrality_score>=0.5` 会生成 component risk alert candidate；high 阈值分别是 1、0.5、3、1、0.8。alert attrs 必须记录 `alert_policy`，包括 evaluated label/value、medium/high threshold 和 value source，避免阈值变成不可审计的硬编码。`evaluateComponentRiskAlertPolicy()` / `summarizeComponentRiskAlertPolicy()` 提供不写库的纯函数校准入口，用于在人工 gold set 落库前先固定 trigger/skip/reason 的 regression fixture。

### 7. Exposure Methodology

暴露模型回答：

```text
某个外部事件会影响哪些公司、组件、设施、路径？
```

事件类型：

- 政策/制裁。
- 地震/洪水/自然灾害。
- 港口拥堵。
- 能源价格冲击。
- 商品价格冲击。
- 供应商停产/财务风险。

第一版传播：

```text
event -> affected_entity/facility/geography/component
affected node -> upstream/downstream paths within N hops
path score = edge_strength * freshness_score * observation_signal_weight
```

规则：

- 如果路径缺少 strength，输出不确定性，不伪装成精确评分。
- 传播结果是 `risk_view`，不是 fact edge。
- 每个 risk view 必须有 `inputs_fingerprint` 和 `model_version`。

### 8. Calibration Methodology

任何 confidence / risk metric 都必须能被校准。

最低要求：

- 建立 gold review set。
- 每个季度抽样 Level 4/5 fact edge，记录人工正确率。
- 画 reliability buckets：预测 confidence 0.8-0.9 的样本，实际正确率是否接近。
- 错误分成：抽取错误、实体消歧错误、来源错误、过期错误、语义误判。

如果没有 calibration，risk view 只能标为 experimental。

当前已落地的 calibration baseline：

- `edge_calibration_labels` 保存人工 gold label：`correct / incorrect / uncertain`。
- `incorrect` 必须带错误类型；`uncertain` 不进入 precision 分母，避免把证据边界问题误算为错误。
- `refreshEdgeCalibrationRun()` 只评估已有人工标签，输出 precision、confidence reliability buckets 和 error summary。
- calibration run 写入 `edge_calibration_runs / edge_calibration_run_items`，带 `model_version` 和 `inputs_fingerprint`。
- 校准结果只能用于阈值治理和方法学评估；不能自动改 edge、不能自动提升或降低 `evidence_level`。

## LLM / Agent 的方法学位置

LLM 可以做：

- unknown-driven source plan。
- 候选关系抽取。
- 多语言段落解释。
- 报告草稿。
- 反例检查建议。

LLM 不能做：

- 自动写 fact edge。
- 自动提升 evidence level。
- 自动生成 share / risk score。
- 自动 approve review。
- 把 observation 改写成事实关系。

所有 LLM 写路径必须进入 review queue，并保留 prompt version、model、输入、输出、schema validation 结果。

## 远期：Probabilistic Intelligence Layer

贝叶斯、概率图模型、因果图和统计校准属于远期方法学，不属于 v0.2 或中期后端完成门槛。

原因很简单：

```text
概率模型需要干净事实层、稳定 observation 层、关系强度、时间衰减和校准样本。
如果这些基础不稳，概率模型只会把不确定性包装得更高级，而不是更可靠。
```

远期可以研究的方向：

| 方法                          | 适用问题                      | 前置条件                         |
| ----------------------------- | ----------------------------- | -------------------------------- |
| Bayesian updating             | 新证据到来后更新 claim belief | 多源 evidence + calibration set  |
| Bayesian changepoint          | 财报/贸易/价格序列的拐点检测  | 足够长的 observation time series |
| Probabilistic graphical model | 供应链冲击在网络上的概率传播  | relation strength + topology     |
| Causal graph                  | 区分相关变化和潜在因果路径    | 稳定的 event/observation history |
| Survival / hazard model       | 关系长期未披露后的有效性衰减  | freshness history + renewal data |
| Bayesian decision support     | 给 review/alert 分配优先级    | 已校准的 risk metrics            |

硬边界：

- 概率结果只能进入 `risk_view` / `alert_priority` / `investigation_priority`。
- 概率结果不能提升 `evidence_level`。
- 概率结果不能自动写 fact edge。
- 没有 calibration 的概率输出必须标为 experimental。
- 如果模型无法解释输入、先验、后验和不确定性区间，不允许进入默认报告。

推荐阶段：

```text
Phase 6+
  在事实层、observation 层、risk view 和 calibration fixtures 稳定后再启动。
```

## 后端方法学完成标准

后端方法学完成至少满足：

```text
[x] evidence_level / confidence / strength / freshness / risk_metric 分层落库或可导出
[x] claim fusion 有确定性算法和 fixtures
[x] observation anomaly 有 baseline/change 与 trailing median/MAD 检测
[x] risk_view 有 HHI、path redundancy、node knockout 三类指标
[ ] LLM 不参与事实层自动写入
[x] ComponentCard / CompanyCard 能分别展示事实、观测、风险、未知
[x] research-pack 能输出 question readiness matrix，区分 ready / partial / blocked
[x] research-pack 能输出 investigation backlog，把 gap / unknown / source-plan 转成下一步调查任务
[x] runnable source-plan target 能在无数据库场景下执行 plan/fetch/normalize smoke，用于同步前发现外部源和凭据问题
[x] `corroboration-source-plan` 能按 audited next-action 生成非空的 smoke / sync / enable / run-due source-plan 执行批次，避免把仍需预检或排错的二源 target 误混入后续步骤
[x] runnable source-plan target 能同步到 source_check_targets，并进入统一 due/worker 监控链路
[x] 审计后的 runnable source-plan target 能受控启用，并继续使用统一 target 级 cadence / jitter / retry / next_check_at 配置
[x] research-pack 能输出 source target coverage，把 target 级 job/event/observation 状态回流到数据准备进度
[x] source target coverage 能把 SOURCE_DEGRADED 标为 degraded，避免把缓存回退或源退化误读成完全成功
[x] Workbench / research-pack 能输出 attention queue，统一 claim conflict、claim lifecycle、alert、source degraded 和 requires-attention change
[x] research-pack 能输出 official disclosure readiness，把内置研究 target profile、逐节点覆盖、显式 target node 覆盖、逐 expected source 覆盖、edge-level corroboration queue、profile expansion candidates、Level 4/5 边数量、traceability、cross-source corroboration、single-source disposition/unknown、intelligence context gap 和官方披露 source target 状态量化
[x] evidence-maintenance 能把 official-disclosure readiness 的 single-source disposition `proposed_unknown` 受控落库为 edge-scoped unknown，并默认跳过缺失或非 current 的 fact edge
[x] evidence-maintenance 能把 official signal disposition 中的 `record_single_source_unknown` 审计结论受控物化为 edge-scoped unknown，且不写 fact edge / evidence
[x] research-pack 能输出 supply-chain expansion plan，把 L4/L5 fact frontier 转成带 component/process 约束、source path、unknown 和 stop condition 的下一层研究计划
[x] investigation backlog action 能随 source target coverage 细化为同步、启用、运行、等待、排错或 review observation
[x] 所有风险结论都能追溯到 fact/observation/algorithm version
[x] calibration run 能从人工 edge labels 计算 precision / reliability buckets / error summary
```

说明：ComponentCard 已能展示 component risk baseline、component-scoped observation anomaly summary，以及由当前组件事实边关联到 supplier/consumer 的 company financial signals；CompanyCard 已能展示 company-scoped observations、observation anomaly summary，并基于 component risk metrics 聚合出 top exposure nodes。research-pack 默认只读打包；需要刷新当前包内 eligible component risk baseline 时必须显式传 `--prepare-data` 或 `--refresh-component-risk`，且 eligible 的前提是已有可审计 Level 4/5 component fact edge；只有 taxonomy、source-plan 或 observation 的组件必须继续保留为 coverage gap，不能写空风险结论。`official-disclosure-readiness` 是 Gate 1 的数据账本：它只读取 Workbench 里已有事实边和 evidence，统计研究 target profile、逐节点覆盖状态、显式 target node 覆盖、逐 expected source 覆盖、edge-level corroboration queue、profile expansion candidates、Level 4/5 fact edge、完整 traceability、严格 cross-source corroboration、strength/freshness 覆盖和 explicit unknown；同时读取 official source-plan / source-target coverage，把 runnable target 的 not_synced、disabled、due、active、degraded、dead 和 observation 状态带进报告和 backlog action。corroboration queue 会逐条列出 single-source / missing-evidence L4/L5 edge 的已有来源、候选 counterparty/profile source、source target、linked unknown、proposed single-source disposition unknown 和处置动作；没有二源路径且没有已记录 disposition unknown 时，报告会生成确定性 proposed unknown payload；evidence-maintenance 可受控落库为 edge-scoped unknown，并默认检查目标 edge 仍为 current。这不能把沉默当验证，也不能写事实边。逐节点状态只表达数据准备路径：`covered_fact` 表示已有 L4/L5 fact，`official_target_synced` / `official_target_runnable` 表示已有与该节点相关的可执行官方源路径，不能把聚合 source-plan item 里其它节点的 target 借给当前节点；`official_source_planned` 表示仍需把计划转成 target，`missing` 表示当前 pack 没有官方披露入口。逐 expected source 覆盖会把 profile 期待来源拆开审计：`connector_available` 只代表已有 source-check connector，仍需要针对节点的 source-plan/target；`source_registered_unimplemented` 代表 registry 已登记但还缺 connector 或人工 review workflow；`missing_source_mapping` 代表 profile 期待来源还没映射到 source registry。`ai-compute-memory.v0` 是内置确定性研究验收锚点，不是全球供应链全集；系统会按选中公司/组件自动选择该 profile，也允许调用方显式关闭或覆盖 target nodes。内置 profile 会把已有 SEC CIK 作为 source-plan hint 下沉给 `sec-edgar/sec-company-filings`，不依赖官方披露年份；给定 `officialDisclosureYear` 时，TSMC / Samsung / SK hynix / Micron / ASML 的官方 IR source 会生成 node-specific runnable target，显式配置了 HTTPS URL 的 `company-ir` 目标也会生成 runnable target；Samsung / SK Hynix 还会生成 `dart-kr/company-filings` runnable target，silicon wafer / ABF substrate 会生成 `edinet/daily-filings` runnable target，Foxconn / Quanta 会生成 `twse-mops/electronic-documents` runnable target，manufacturing-services 目标会生成 Apple Supplier List FY2022 的 `apple-suppliers/supplier-list-review` target。这条 Apple 路径只把官方名单转成 review candidate、facility lead 和 OSH 交叉检查 target，不能自动 apply 或生成事实边；DART / EDINET / TWSE 当前也只落官方披露目录元数据和 monitor 事件，用来建立监管披露覆盖账本，不自动下载/解析正文、不写事实边。缺少显式 URL 的 `company-ir` 节点和缺少公司级 EDINET code 的更细目标仍显示为 connector-only 或配置缺口，不会被自动校准成已覆盖。不在 profile 中但已经通过事实边、官方 source-plan 或 runnable target 出现的节点会进入 expansion candidates/backlog，等待人工或后续安全 AI 审阅是否纳入 profile。调用方传入 target node set 后，Gate 1 core node 口径按这批目标节点中非 `missing` 的数量衡量；未传 target node set 且未命中内置 profile 时只能回退到当前 pack 可见节点，不能宣称核心 25 个研究节点已完成。它不会把 single-source silence 当作已解释，也不会生成事实边。`investigation-backlog` 是 question readiness / official disclosure readiness 的后续规划层，只把 gap / unknown / source-plan / profile expansion candidate / corroboration queue item 转成可审计任务；其中 `corroboration_review` 是逐 edge 任务，会继承 runnable target、source target coverage 和 preflight 状态，让 action 精确落到同步、启用、运行、排错、review observation 或记录 explicit disposition；summary / manifest 会按 corroboration review 汇总 runnable、coverage、sync、enable、due、preflight、credentials、config、connector、reachability 和 disposition-only 状态。`corroboration-source-plan` 会进一步把这些 review 的 runnable target 过滤成标准 source-plan 子集，供 source-management 预览、smoke、同步和启用；它只是二源检查批次入口，不抓源、不写 observation、不把二源候选升级成 fact edge。runnable source-plan target 可以先通过无数据库 smoke 执行 `plan / fetch / normalize`，提前暴露外部源不可达、凭据缺失或 target config 问题，但 smoke 不写 monitor event、不写 observation、不代表已进入持续监控。需要 key 的公开源使用统一 source credential 契约：key 定义集中在 `@supplystrata/config`，真实值默认从 `config/source-credentials.local.json` 读取，并允许 `.env` / 环境变量覆盖；缺 key 只进入 `missing_credentials` 和 backlog action，不阻断当前 research-pack。随后再通过 source-management 同步到 `source_check_targets`，默认 disabled，审计后用 `enable-plan-targets` 受控启用并写入统一 target 级调度参数，最后才进入 due/worker。`source-target-coverage` 会把 target 级 sync、enable、due、job、event、degraded、observation 状态回流到研究包，说明数据准备卡在哪里；backlog action 会消费这些状态，给出同步、启用、运行、等待、排错或 review observation 的具体下一步。该路径只调度源检查，不自动生成事实边。当前 anomaly 支持显式 baseline/change 和同一序列的 trailing median/MAD；component risk refresh 已能把派生指标的实质变化写成 `RISK_METRIC_CHANGED`，供 changes timeline 区分 risk change。多跳 node knockout reachability 已有无权 baseline，weighted impact 已能用 strength/freshness 做 max-product propagation；path redundancy 已从直接 supplier count 升级为 terminal consumer simple-path redundancy，并带有 weighted alternate-path attrs；betweenness centrality 也带有 weighted path centrality attrs。component risk alert policy 已统一收口到 threshold-policy 函数，并有 deterministic regression fixture 覆盖 single-source、weighted centrality trigger、低于阈值的 weighted impact skip 和 missing weighted centrality skip；summary 函数会输出 trigger/skip、matched expected、by metric kind 统计，作为后续人工 gold set 的轻量校准入口。真实世界样本校准、阈值治理和误报治理仍未完成。

没有这些，只能说“事实图谱后端可用”，不能说“供应链监控后端完成”。
