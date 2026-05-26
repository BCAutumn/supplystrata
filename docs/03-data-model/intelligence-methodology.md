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

#### Propagation Context Methodology

产业传导分析需要的不是一条新事实边，而是一组可审计的推理输入。后端必须把下面这些信号准备成 observation / lead / backlog，而不是直接写成公司关系：

| propagation context                   | 回答的问题                           | 默认层级                 |
| ------------------------------------- | ------------------------------------ | ------------------------ |
| `demand_signal`                       | 下游需求是否增长？                   | observation / risk input |
| `capacity_expansion_signal`           | 公司或行业是否扩产？                 | observation              |
| `facility_construction_signal`        | 厂房、洁净室或数据中心是否在建设？   | observation / lead       |
| `equipment_installation_signal`       | 设备是否采购、交付、安装或调试？     | observation / lead       |
| `process_material_consumption_signal` | 生产过程可能消耗哪些材料或介质？     | component/material lead  |
| `material_price_or_trade_signal`      | 上游材料价格、贸易流或供应是否变化？ | observation / risk input |
| `policy_or_export_control_signal`     | 政策、管制或制裁是否影响路径？       | observation / alert      |

这类上下文服务未来 AI 和前端研究员回答链式问题，例如：

```text
GPU demand -> data center -> PCB / optical module / power / cooling
PCB -> resin / electronic glass cloth / copper foil -> upstream materials
fab expansion -> cleanroom -> equipment delivery / installation / qualification -> process materials
```

这类问题必须按“研究问题 readiness”组织，而不是按事实边数量堆砌。以 AI compute 为例，后端至少要能把下面几层拆成结构化对象：

| layer                         | 需要准备的数据                                         | 允许输出                                     |
| ----------------------------- | ------------------------------------------------------ | -------------------------------------------- |
| `demand_to_compute`           | GPU / accelerator 需求、云厂商 capex、订单或收入观测   | demand observation、claim、unknown           |
| `compute_to_server`           | AI server、ODM、power/cooling、optical module frontier | fact edge、source target、component lead     |
| `server_to_board_materials`   | PCB、substrate、CCL、铜箔、电子布、树脂                | component/material frontier、trade/price obs |
| `compute_to_fab_capacity`     | foundry、wafer、advanced packaging、capacity expansion | fact edge、capex/facility observation        |
| `fab_to_construction`         | cleanroom、facility buildout、hook-up 工程             | facility / construction observation          |
| `construction_to_equipment`   | lithography、etch、deposition、test、metrology         | equipment frontier、official source target   |
| `equipment_to_process_inputs` | photoresist、target、CMP slurry/pad、高纯气体、化学品  | material frontier、commodity/trade obs       |
| `process_to_raw_materials`    | 铜、玻纤、树脂上游、稀有气体、金属矿物                 | raw-material source target、unknown backlog  |

每一层都必须输出明确状态：`covered_fact`、`observation_ready`、`official_target_runnable`、`lead_only`、`unknown_open` 或 `blocked_source`。如果某层只有行业常识，没有可引用的事实或观测，正确输出是 `lead_only / unknown_open`，不是把口头传导链写成事实边。

每一层的 source target 还必须按研究角色分组，而不是只输出 adapter 大列表：

| source target group          | 含义                                     | 允许用途                             |
| ---------------------------- | ---------------------------------------- | ------------------------------------ |
| `official_evidence`          | 监管披露、官方 IR、供应商名单等可审来源  | 运行/同步 source target，进入 review |
| `observation_proxy`          | 贸易、商品、宏观、政策等观测代理         | 做 reasoning input 和 calibration    |
| `entity_or_facility_context` | LEI、企业注册、设施目录等实体/设施上下文 | 辅助实体对齐和设施研究               |
| `lead_or_manual_review`      | 物流、人工审查、线索型入口               | 生成 backlog 或人工复核任务          |

这个分组只服务前端/AI 选择下一步动作；它不能提升 evidence level，不能把 observation source 解释成官方事实，也不能因为某个 adapter 可运行就关闭 unknown。

每一层还必须输出 `next_research_targets`，把下一步可查对象显式拆成 `company`、`component`、`material_or_process` 或 `source_group`。这些 target 来自当前 layer scope、L4/L5 frontier、component dependency lead 和 source target group，只是“该研究什么”的结构化导航；它们不能证明关系存在，也不能授权自动写 fact edge。

每一层还必须输出结构化 `official_evidence_gaps`。`covered_fact` 只能说明该层至少有一个 L4/L5 anchor，不能说明层内每个组件、材料、工艺或 source path 都已经被官方证据覆盖。因此 gap 必须按 `component_without_l4_l5_fact`、`material_or_process_without_l4_l5_fact`、`official_source_not_reviewed`、`official_source_blocked`、`observation_only` 这类可审计原因列出，并带 refs 和 review-only write policy。未来 AI / 前端必须优先读这些结构化 gap，不能从 layer status 直接推断“整层已完整覆盖”。

Gate 1 action workbench 必须消费这些 gap：`covered_fact` layer 如果仍有未覆盖组件、材料或 source group，也要进入 review-only 行动队列。优先级只表示研究运营顺序：blocked official source 优先修复，可运行 official source 优先同步/审查，component/material gap 保持 unknown/backlog 或触发受控 source target，不允许直接生成事实边。

这些 workbench item 还必须携带结构化 `source_targets[]`。字符串 refs 只适合追溯；正式消费方应该读 `state`、`failure_kind`、`latest_event_type`、`source_adapter_id` 和 `target_kind` 来决定是 run、sync、repair credential 还是 keep unknown open，避免用文本解析来推断监控状态。

每一层还必须输出 `evidence_layer_summary`，把 `fact_edge`、`observation`、`lead`、`unknown`、`source_target`、`official_evidence_gap` 分开计数、列 refs、写明解释和禁止写入。未来 AI / 前端应该先读这个 summary 来判断“这是什么层级的信息”，再决定如何展示或排队；不能仅凭 status 或数组长度自行推断 truth-store 权限。

Gate 1 data-depth workbench 中的 propagation item 必须透传同一份 `evidence_layer_summary`。原因是 action batch 是未来前端/host app 最可能直接消费的入口；它必须自带事实/观测/线索/unknown/source/gap 边界，而不是要求调用方再回查 matrix 后自行合并。

同一个 layer 可能同时拥有 official disclosure、trade/commodity observation、facility context 和 manual lead source。workbench action 必须输出 `action_source_groups`，并按当前 gap 类型收窄命令提示和 `source_targets[]`：官方证据缺口优先 official evidence source group；材料/工艺观测缺口才带 observation proxy；facility/manual source 只能在对应动作中出现。这样可以避免“看起来有很多 source target”被误读成“这些 source 都能修同一个事实缺口”。

workbench action 还必须透传结构化 `official_evidence_gaps[]`。`refs` 可以用于追溯，但前端/host app 不能从字符串 refs 反推 gap 类型、target 或推荐动作；正式审查入口应该直接消费 gap 的 `gap_kind / target_kind / target_id / recommended_action / truth_store_write_policy`。

同一 action 还必须输出 `source_target_status_summary`，把当前 action 范围内的 source target 分成 runnable、blocked、degraded、missing credentials、source failed 和 by-state / by-failure 计数。这样前端或安全 AI 可以直接判断“现在该跑、该补 key、该排查 degraded source，还是先保持 unknown”，不需要自己重算 source monitor 状态，也不会把一个 blocked target 误读成可用证据。

硬边界：

- 如果没有公司级官方证据，不能把 `process_material_consumption_signal` 写成 `Company A -> Company B` fact edge。
- 建设进度、设备进场、材料价格和贸易流只能作为 propagation context，不能提升 `evidence_level`。
- 后端可以输出 `ready / partial / blocked` 的 propagation readiness，但不能把它包装成最终投资判断。
- L4/L5 fact edge 数量只能衡量证据厚度，不能替代问题 readiness。为了凑数量去扩无关公司、无关行业或单一官方名单，只能算广度样本，不能算 AI compute 主链变深。
- AI/前端只能消费 `claims / evidence / observations / risk_views / unknowns / source targets` 等结构化输入；任何写入 truth-store 的新事实仍必须走 review/apply。

research-pack 会用 `official-disclosure-signal-correlation` 纯函数模块，把 open `official_disclosure_signal` 和 edge-level corroboration queue 做确定性 review hint 关联。第一版只看来源是否命中 candidate source / runnable target、信号文本是否提到边两端公司或组件 token，并输出 `review_policy='review_only_no_fact_mutation'`、分数和原因。这个分数只给研究员排序下一步看什么，不计入 Gate 1 data progress，不把 signal 计为二源 corroboration，也不修改 review candidate / edge / claim / unknown。

official signal disposition 是后续审阅结论，不是证据本身。`review-store.recordOfficialDisclosureSignalDisposition()` 只允许记录 `supports_existing_edge`、`needs_more_evidence`、`not_relevant`、`record_single_source_unknown` 或 `create_counterparty_source_target`，并写入 `change_records.change_type='OFFICIAL_DISCLOSURE_SIGNAL_DISPOSITION_RECORDED'`；CLI/host app 的薄入口是 `review signal-disposition`。该事件必须带 `fact_write_policy.automatic_fact_mutation_allowed=false` 和 `allowed_edge_mutation='none'`。即使 decision 是 `supports_existing_edge`，也只表示研究员认为这个 signal 可以作为后续 evidence/claim/unknown/source-target 流程的上下文；真正写 evidence、unknown 或 source target 必须走各自受控用例。`record_single_source_unknown` 也不会由 review-store 直接写 unknown，而是由 `@supplystrata/evidence-maintenance` 的 `materializeOfficialSignalDispositionUnknowns()` 读取审计 change、默认确认目标 edge 仍为 `current`，再通过 unknown repository 写入 edge-scoped `unknown_items` 并记录 `UNKNOWN_ADDED/UPDATED`；CLI/host app 的薄入口是 `intelligence official-signal-unknowns`。这条路径只物化“独立官方二源仍缺失”的未知边界，不写 `edges`、不写 `evidence`，也不把 signal 自动升级成 corroboration。

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
- research-pack 会输出 `supply-chain-expansion-plan.json/md`，把当前 L4/L5 fact edge frontier、component-context taxonomy、source-plan、official-disclosure readiness 和 edge unknown map 组合成确定性递归展开计划。它回答“下一层应该研究哪个 counterparty / component / route，为什么，现有 source path 是否可跑，在哪里停止”，但只生成 planning/backlog context，不写 fact edge、evidence、claim、observation 或 unknown。递归展开必须带 component/process 语义；没有 `component_id` 的事实边只进入 `needs_component_context`，到达 `max_depth`、catalog boundary 或 logistics/route observation layer 时显式停止，避免把公司级供应商列表无限外推成事实图。component dependency lead 会显式输出 `source_path_authority`、source relation policy 和 output layer；只有命中具体 dependency、target，或锚定到 target component 的 source-plan item 才能让 lead 进入 source path 状态，不能把 parent component 的泛化 source-plan 借给所有下游材料。
- 当前 `component-context` 已把 AI server frontier 拆到 GPU、HBM、manufacturing services、PCB、optical module、power supply 和 cooling；PCB frontier 继续拆到 copper clad laminate、copper foil、electronic glass cloth 和 laminate resin；fab/wafer frontier 也保留 cleanroom construction context。`source-plan` 会把这些节点连到官方披露、贸易、商品价格或材料观测路径，但它们仍是 research lead / observation context，不能自动变成公司级供应关系。
- `propagation-readiness` 在同一原则下输出：它把 demand、capacity、facility、equipment、process material、raw material、policy signal 组合成结构化推理输入；同时内置 `ai_compute_propagation.v0` matrix，把 demand、server、PCB/materials、fab capacity、cleanroom、equipment、process inputs、raw materials 逐层标成 `covered_fact / observation_ready / official_target_runnable / lead_only / unknown_open / blocked_source`。它只描述“证据和观测是否够回答问题”，不生成自然语言结论，不写事实边，也不关闭 unknown。每个 context item 和 matrix layer 必须带 `reasoning_input_only_no_fact_mutation` policy、ready signals / status reason、missing requirements 或 refs；未覆盖层还会输出只读 `unknown_backlog_seeds`，把“该问什么、为什么未知、已有 unknown/source target 是什么、推荐审查动作是什么”结构化给未来 AI/前端，仍然不能自动写 `unknown_items`。matrix layer 还会输出 `evidence_layer_summary`，把事实、观测、线索、unknown、source target、official gap 的解释和禁止写入统一成机器可读摘要；输出 `source_target_groups`，把 source target 分成 official evidence、observation proxy、entity/facility context 和 lead/manual review，避免前端或 AI 把贸易/商品/设施线索误当成官方事实路径；输出 `next_research_targets`，把下一步公司、组件、材料/工艺或 source group 明确列出，让消费层不必从 refs 里反向猜；输出 `official_evidence_gaps`，逐项说明哪些组件、材料/工艺、官方 source group 或 observation-only layer 仍缺 reviewed official evidence。`investigation-backlog` 只把 `partial/blocked` context 转成补 observation / source target 的任务，供未来 AI/前端研究消费。research-pack 默认从 `generatedAt` 派生可审计 source-plan 窗口：官方披露/年度材料取上一 UTC 年，贸易/商品价格观测默认上一 UTC 月；这些默认只影响 target planning 和 backlog，不代表观测已存在。policy / export-control context 可以继承 SEC/IR/DART/EDINET/TWSE 等官方披露路径，用于后续抽取政策观测，但不能把 source path 当成政策结论。
- AI compute matrix 的 layer 覆盖必须按具体 component / material / process target 匹配。`official_disclosure`、`trade`、`commodity` 这类 source purpose 只能说明 source 的用途，不能把一个 source-plan 借给所有 layer；component dependency lead 的 category 也只能解释 lead 类型，不能把 lead 的 supporting edge 计入当前 layer 的 fact coverage。这样会让报告更保守，但能防止“有一个官方源/有一条上游 lead”被误读成整条产业传导链已覆盖。
- `gate1-data-depth-workbench` 在 readiness 和 run ledger 之上输出：它把 L4/L5 fact edge gap、counterparty corroboration queue、source blocker、edge strength gap、observation calibration labeling batch 和 propagation context 缺口合成 `review_only_no_fact_mutation` 优先级清单。每个 item 都显式列出 frontend action kind、推荐决策、允许决策、写入影响和命令提示；这些字段只帮助下一轮跑数、排障和 gold label 扩样，不写 `edges / evidence / unknown_items / observations`，也不把 observation 或 official signal 升级成事实证据。
- `adjacent_official_facts` 的 company ranking 只是候选生成，不是概率结论。排序必须先抑制披露中心节点、品牌方和高频 source-subject 带来的中心性偏差：组件/行业相关性和 likely upstream role 优先，edge frequency 只能作为弱 tie-breaker。每个 `ranking_context` 必须输出稳定 `context_id`、候选 `candidate_id`、`model_version`、assumptions 和 score breakdown，让前端/host app 能把候选标注为 `useful_target / wrong_direction / brand_center_bias / needs_more_context / not_relevant`。没有足够 ranking gold label / calibration run 前，任何 rank 都不能解释成“更可能是真实上游关系”；它只能生成下一轮研究目标。未来若输出概率，必须记录 features、score breakdown、假设、样本来源、gold label 覆盖、precision / recall 或 reliability bucket，并标明未校准输出为 `experimental`。
- research-pack 会输出 `gate1-run-ledger.json/md`，把 Gate 1 scorecard、data progress、source path progress、edge-level corroboration 批次和下一层 company switching 计划合成一个可重复执行账本。它只给出当前 mainline phase、下一步 action queue、source-management 命令提示和通用 `research run --company ... --component ...` frontier 建议，不抓源、不写库、不生成事实边。全量官方 source path 的同步/运行继续使用 `source-plan.json`；逐 edge 二源检查使用 `corroboration-source-plan*.json`，避免把全量监控目标和 corroboration 子集混在一起。账本会输出 `monitoring_config`，把 namespace、默认 cadence / jitter / retry / backoff / `next_check_at` 字段、前端控件类型和 source-plan 批次建议收口到同一个可配置契约；这些字段只写 `source_policy_config` / `source_check_targets` 调度状态，不代表研究结论，也不能触发事实层变更。`monitoring_config.batches[]` 会回流 source target coverage / preflight 状态，输出 not_synced、disabled、due、retry_wait、degraded、dead、source_failed、observation、preflight issue 和 DB-backed source failure kind 计数，并给出 `recommended_operational_action`，让宿主 App 区分同步、启用、运行、等待、补凭据、排查源响应/限流/adapter 失败或 review observation。账本还会输出 `review_workbench`：这是后续前端/host app 的审查队列契约，每个 item 都显式列出推荐决策、允许决策、引用对象、写入影响和 `review_policy='review_only_no_fact_mutation'`；系统可以自动排序和准备命令，但不能借此自动生成事实边、自动关闭 unknown 或自动把官方 signal 升级成 corroboration。
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
- `observation_calibration_labels` 保存 observation 层人工/规则 label：`useful_signal / background_context / needs_context / not_useful`，用于沉淀 source-target coverage 里的 calibration candidates；truth-store research pack 会把已持久化 label 回灌到 candidate 的 `existing_labels / latest_label / review_status`，让报告区分“推荐标签”和“已审查标签”。`labeling_plan` 会对未标注 candidate 做 priority/metric 分层抽样，生成下一批建议标注样本，防止 gold set 被单一指标占满。它只维护样本池和只读抽样计划，不生成事实边，也不计算 precision。
- `ranking_calibration_labels` 保存 research-target ranking 的人工/规则 label：`useful_target / wrong_direction / brand_center_bias / needs_more_context / not_relevant`。它消费 `gate1-data-depth-workbench.ranking_contexts` 的稳定 context/candidate id 和 score breakdown，用于统计候选排序偏差，尤其是披露中心节点、品牌方和高频 source-subject 偏差。它不写 fact edge，不修改 observation，也不能把 rank 变成概率结论。
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
[x] Gate 1 run ledger 的 action queue 能消费 `corroboration-source-plan.summary.by_next_action`，在 smoke 回灌后把二源目标分流成 review observations、补凭据、重试 preflight、sync、enable 或 run due，而不是重复提示 smoke
[x] runnable source-plan target 能同步到 source_check_targets，并进入统一 due/worker 监控链路
[x] 审计后的 runnable source-plan target 能受控启用，并继续使用统一 target 级 cadence / jitter / retry / next_check_at 配置
[x] Gate 1 run ledger 能输出 `monitoring_config`，把持续监控 namespace、频率、jitter、重试、退避、初始检查时间和 source-plan 批次建议暴露给后续前端/host app
[x] Gate 1 run ledger 的 `monitoring_config.batches[]` 能消费 source target coverage / preflight 汇总，把 retry_wait、degraded、source_failed、disabled、due、observation 等状态转成确定性 operational action
[x] source-target coverage 能把 DB-backed source-check job error 归类为 `missing_credentials / target_config_invalid / source_unreachable / source_response_error / rate_limited / adapter_error / unknown_failure`，让 Gate 1 排障不依赖人工读错误字符串
[x] research-pack 能输出 source target coverage，把 target 级 job/event/observation 状态回流到数据准备进度
[x] research-pack 能输出 AI compute propagation readiness matrix，把 demand、server、PCB/materials、fab capacity、cleanroom、equipment、process inputs、raw materials 逐层标成 covered_fact / observation_ready / official_target_runnable / lead_only / unknown_open / blocked_source，并列出 refs 与下一步 source target
[x] source target coverage 能把 metric 覆盖转成 deterministic observation review seeds 和只读 calibration candidates，用于前端/host app 审查和 calibration 小样本准备，且 policy 明确禁止自动写事实边；candidate 会携带 observation/doc/source item 样本、推荐标签、已持久化 label 状态和下一批分层 labeling plan，方便从聚合指标回到可审计来源并追踪 gold set 进度
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
