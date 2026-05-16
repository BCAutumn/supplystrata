# Evidence Model — 证据等级模型

**这是整个系统的灵魂**。如果证据等级不严谨，图谱就是一张漂亮但虚假的网。

## 五级证据等级（evidence_level）

| Level | 含义                       | 默认 `is_inferred` | 默认 `needs_review` | MVP 输出       |
| ----- | ------------------------ | ---------------- | ----------------- | ------------ |
| 5     | 公司监管文件直接披露的明文关系          | false            | false             | 默认显示 |
| 4     | 官方供应商名单 / 公司官方报告 / 跨监管文件交叉验证 | false            | false             | 默认显示 |
| 3     | 海关贸易数据反复出现 / 多源 LLM 抽取一致 | true             | true              | `--include-inferred` 才显示 |
| 2     | 宏观贸易流 + 新闻 + 行业报告（趋势证据）   | true             | true              | 不进默认输出 |
| 1     | 单一新闻 / 论坛 / 单一招聘信息（线索）    | true             | true              | 仅入 hypothesis_queue |

## Level 5 — 监管文件直接披露

**条件**：

- 来源是 `10-K / 10-Q / 20-F / 8-K / DART / 同等监管文件`
- 是公司**自己关于自己**的披露，或一方关于双方关系的明确陈述
- 抽取方式是 rule（高置信度模式匹配）
- cite_text 是非歧义的明确关系陈述

**例**：

```
"We utilize foundries such as TSMC and Samsung."
→ NVIDIA -USES_FOUNDRY-> TSMC      [Level 5]
→ NVIDIA -USES_FOUNDRY-> Samsung   [Level 5]
```

```
"We purchase memory from SK hynix, Micron Technology and Samsung."
→ NVIDIA -BUYS_FROM(memory)-> SK Hynix     [Level 5]
→ NVIDIA -BUYS_FROM(memory)-> Micron       [Level 5]
→ NVIDIA -BUYS_FROM(memory)-> Samsung      [Level 5]
```

**例外（不能升到 5）**：

- "we may rely on suppliers such as ..."（语态弱，留 4）
- "competitors include TSMC, Samsung"（不是供应关系陈述）
- "expects to qualify with ..."（未发生）
- LLM 抽取，即使来源是 10-K，最高只能 4

## Level 4 — 官方供应商名单 / 公司官方报告 / 跨监管交叉

**条件**：

- 来源是 `Apple Supplier List / Apple Supply Chain Reports / 公司官方 IR 文件 / sustainability 报告`
- 或者：同一关系在两份独立监管文件中均明确出现
- 或者：公司 CEO 在 official earnings call transcript 中明确提到

**例**：

```
Apple Supplier List 2024
→ Apple -BUYS_FROM-> [supplier X]                [Level 4]
（component 来自表格列；地点来自表格列）
```

```
TSMC 年报 + NVIDIA 10-K 同时明确双方关系
→ NVIDIA -USES_FOUNDRY-> TSMC                    [Level 5（两边交叉提升）]
（注：双向官方披露的交叉可作为 Level 5 例外，但需要严格匹配 entity 与时间窗）
```

**例外（不能升到 4）**：

- "Apple Supplier" 标签出现但不是来自官方 supplier list（如新闻文章宣称 X 是 Apple 供应商）
- 没有时间戳的"official-looking" PDF（必须能验证发布渠道）

**LLM 特别规则**：

- LLM 抽取自官方披露时，单条 evidence 的等级上限可以是 Level 4，但必须 `needs_review = true`
- 只有人工 approve 后才允许进入图谱；LLM 永远不能产生 Level 5

## Level 3 — 海关 / BOL 反复出现 / 多源 LLM 一致

**条件**：

- 美国 BOL 中同一买家从同一卖家进口同 HS code 商品 ≥ 6 次（默认阈值，可调）
- 或者：≥ 3 个独立 LLM 抽取出相同关系（基于不同文档不同 chunk）
- 或者：UN Comtrade 看出明显的国别 - HS 流量上升，且能锁定到具体公司（非常少见）

**自动属性**：

- `is_inferred = true`
- `needs_review = true`
- 必须挂 `risk_warnings`：

  ```
  - Importer/exporter on BOL may be freight forwarder, trader, or masked entity
  - HS code may not uniquely identify the actual product
  - Manifest confidentiality may exclude key shipments
  ```

**禁止**：

- 仅一次出现的 BOL（噪声太多）
- 重量 / 港口 / 描述不一致的 BOL（无法证明同一个产品流）

## Level 2 — 趋势证据

**条件**：

- 国家级贸易流 + 公司财报口吻一致 + 第三方行业新闻报告（如 TrendForce 公开新闻稿）
- 可以支持"价格在涨 / 需求在涨"这种**宏观陈述**
- **不**可以单独支持任何具体公司间关系

**典型用法**：

- 进 ComponentCard 的 `public_price_signals` 与 `demand_drivers`
- 不进图谱边
- 例外：当多条 Level 2 证据汇集到同一关系且与已有 Level 4-5 边一致时，可作为该边的 supporting evidence（但不会改变边的 evidence_level）

## Level 1 — 线索（不进图谱）

**条件**：

- 单一新闻文章
- 论坛 / 社媒 / 单条招聘信息
- 未经核实的爆料

**用法**：

- 入 `hypothesis_queue`
- 研究员手动审视；可以发起调查
- **永不**直接出现在 CompanyCard / ComponentCard 输出中

## 等级判定规则（自动）

scorer 实现的判定流程：

```
1. 看来源类型 (source_type)：先得一个上限
   10-K, 10-Q, 20-F, 8-K, DART → 5
   IR (annual report, presentation, earnings transcript) → 4
   ESG / Sustainability report → 4
   Apple Supplier List / OSH official → 4
   BOL → 3
   Comtrade / Census / USITC → 2
   News (mainstream) → 2
   Trendforce public articles → 2
   Forum / social → 1

2. 看抽取方法 (extraction_method)：再得一个上限
   rule → 不降级
   manual → 不降级
   hybrid (rule + manual review) → 不降级
   llm → 上限 4

MVP 实现里 `extraction_method` 从 `extractor_id` 前缀派生：`rule.*` → rule，`llm.*` → llm，`manual.*` → manual，`review.*` → hybrid。供应商名单 review apply 使用 `review.supplier-list-row`，因此是 hybrid，不应被误记为 llm。

3. 看候选自身特征：
   存在 cite_text >= 30 chars → ok
   原文措辞强 (utilize, purchase, ship to) → 保持
   原文措辞弱 (may, plan to, intends to, considering) → 至少 -1
   未来时态 / 推测语气 → 直接降到 2

4. 跨证据 corroboration：
   同一关系 ≥ 2 个独立来源 → 可在原 level 上 +1（封顶 5）
   独立来源定义：不同 source_adapter_id

5. 反向证据：
   有 superseding evidence → 当前边 deprecate

最终 = min(上述所有约束) 然后再调整
```

## 等级与置信度的区别

| 属性               | evidence_level (1-5) | confidence (0..1)         |
| ---------------- | ------------------- | ------------------------- |
| 是离散 vs 连续         | 离散                  | 连续                        |
| 主要由谁决定            | 来源类型 + 抽取方法         | 多种因素的综合分                  |
| 是否可自动 promote    | 否（需 review）         | 是（可随新证据自动调整）              |
| 是否影响默认输出过滤        | 是                   | 不直接（但低置信会显式标注）            |

详见 [confidence-scoring.md](./confidence-scoring.md)。

## 边的 evidence_level 计算

一条 edge 的 `evidence_level` = 它所有 `evidence` 的最高 level。

逻辑：再多 Level 1 证据也升不到 Level 4。
但 Level 5 出现一次就足够。

## Edge 的 confidence 计算（简化）

```
base = 0.6 + 0.1 * (max_level - 3)               # level=5 → 0.8 base
strength = 1 - exp(-evidence_count / 3)          # 多源加权
adjust = 1.0
  -0.1 if any evidence has weak modal verbs
  -0.05 if entity_resolver returned ambiguous on either end
  -0.05 if document is older than 24 months and no recent confirmation
  +0.05 if cross-source corroboration

confidence = clip(base + 0.2 * strength + adjust, 0, 1)
```

完整公式与单元测试在 `packages/evidence-scorer/`。

## 等级升级（promotion）的硬规则

升级一条边的 evidence_level 必须满足：

1. 新证据本身 evidence_level >= 目标 level
2. 新证据来源与原有证据不同 source_adapter_id
3. 新证据通过 review（即使是高 level 自动通过的来源也要写一行 ChangeRecord）

**禁止**：

- 仅靠"多个 LLM 抽取一致"就把 level 升到 4
- 仅因为时间过去得久了就降级（关系可能仍然有效）
- 自动 promote 之后回头修改老 evidence 的 level（老的不动，新的加入）

## 等级降级（demotion）

发生于：

- 原文被更新，新版本删除了原 cite_text
- 公司明确公告关系终止（"we have transitioned away from supplier X"）
- 跨源出现强反证

降级流程：

- 不修改老 evidence
- 加一条 superseding evidence
- 边 `validity = "deprecated"`，并写 superseded_by_edge_id
- 落 ChangeRecord

## 错误模式（必须杜绝）

| 反模式                                  | 危害                                          |
| ------------------------------------ | ------------------------------------------- |
| 把"市场普遍认为"作为 Level 4-5 证据             | 系统沦为传闻聚合器                                   |
| LLM 输出无 cite_text 的关系直接入 Level 4    | 一旦发现该 LLM hallucinate 整个等级体系报废               |
| 多次抽取同一段原文 = 多个独立证据                  | 是同一证据，不能算多源                                  |
| Level 1 证据被研究员"个人认为可靠" → 升到 Level 3 | 损害可重现性。任何升级必须基于规则                            |
| 把"未来语气" / "可能" 当确定关系                | 把假设当事实                                      |

## 等级展示约定

| 等级 | 默认 UI 颜色 / 标签 |
| -- | ------------- |
| 5  | 绿色 / "Filed Disclosure"     |
| 4  | 蓝色 / "Official Report"      |
| 3  | 橙色 / "Inferred (Trade)"     |
| 2  | 灰色 / "Macro / Trend"        |
| 1  | 浅灰 / "Lead"                 |

CLI Markdown 输出统一用 `[Level X, conf 0.YY]` 标记，不靠颜色。
