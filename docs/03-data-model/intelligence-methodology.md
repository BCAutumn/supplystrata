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

### 5. Observation Signal Methodology

Observation 不是关系。它回答：

```text
公开世界中有什么可复现的变化？
```

第一版 signal 类型：

| signal_kind              | 来源                  | 用途                          |
| ------------------------ | --------------------- | ----------------------------- |
| `financial_metric_delta` | SEC/XBRL/财报         | 库存、capex、应付、收入集中度 |
| `trade_flow_delta`       | Census/USITC/Comtrade | 国家/HS/港口贸易变化          |
| `commodity_price_delta`  | WorldBank/FRED/LME    | 原材料价格变化                |
| `energy_price_delta`     | EIA/FRED              | 能源成本变化                  |
| `policy_event`           | BIS/OFAC/EU           | 管制与制裁暴露                |
| `news_event`             | GDELT                 | 线索，不作为事实边            |
| `port_activity_delta`    | NOAA/AIS/港口统计     | 物流拥堵或流量变化            |

第一版变化检测：

```text
baseline = trailing median over N periods
mad = median_absolute_deviation
z_like_score = (current - baseline) / max(mad, epsilon)
```

规则：

- 没有足够历史窗口时，只记录 observation，不给 anomaly。
- anomaly 只能进入 risk view / alert，不写 fact edge。
- 同一 observation 必须记录 time_window、geography、component/HS/material 映射。

### 6. Graph Risk Methodology

图算法只在派生层运行。

第一版指标：

| metric                        | 意义                 | 依赖输入                  |
| ----------------------------- | -------------------- | ------------------------- |
| `supplier_concentration_hhi`  | 某组件供应集中度     | relation_strength         |
| `single_source_exposure`      | 单一供应商暴露       | fact edge + strength      |
| `path_redundancy`             | 可替代路径数量       | chain graph               |
| `betweenness_centrality`      | 瓶颈节点             | graph topology            |
| `node_knockout_reach`         | 节点失效影响范围     | graph topology + strength |
| `freshness_adjusted_exposure` | 过期证据修正后的暴露 | freshness + strength      |
| `policy_exposure`             | 管制/制裁暴露        | policy observations       |

HHI 公式：

```text
HHI = Σ supplier_share_i^2
```

share 未知时：

- 如果有明确 single-source 文本，可按 `dependency=single_source` 处理。
- 如果没有 share，不能均分；risk view 必须显示 `share_unknown=true`。

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
[ ] evidence_level / confidence / strength / freshness / risk_metric 分层落库或可导出
[ ] claim fusion 有确定性算法和 fixtures
[ ] observation anomaly 有至少一种时间序列检测
[ ] risk_view 有 HHI、path redundancy、node knockout 三类指标
[ ] LLM 不参与事实层自动写入
[ ] ComponentCard / CompanyCard 能分别展示事实、观测、风险、未知
[ ] 所有风险结论都能追溯到 fact/observation/algorithm version
```

没有这些，只能说“事实图谱后端可用”，不能说“供应链监控后端完成”。
