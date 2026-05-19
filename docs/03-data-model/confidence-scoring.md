# Confidence Scoring — 置信度打分

`confidence` 是一个 0..1 的浮点数，作为 evidence_level（离散）之外的连续维度。本文给出可重现的打分函数。

注意：本文的 `confidence` 是证据/抽取置信度，不是风险概率。供应链暴露、集中度、单点失效和异常信号的计算见 [intelligence-methodology.md](./intelligence-methodology.md)。

## 设计原则

1. **可重现**：相同输入必须给出相同输出。不允许引入 wall-clock 时间作为输入。
2. **可解释**：每个加减分项必须有原因，记录在 `confidence_breakdown` 中。
3. **保守**：宁可低估，不可高估。confidence 不应超过 0.95（除非是手动 reviewed 的 Level 5）。
4. **与 evidence_level 解耦**：confidence 不是 evidence_level 的简单线性映射。

## 输入

```ts
interface ScoringInput {
  evidence_level: 1 | 2 | 3 | 4 | 5;
  extraction_method: "rule" | "llm" | "manual" | "hybrid";
  cite_text: string;
  document_type: string; // "10-K", "earnings_call", ...
  source_age_days: number; // 从 source_date 到当前
  modal_verb_strength: "strong" | "neutral" | "weak" | "future";
  subject_resolver_status: "resolved" | "ambiguous" | "unknown";
  object_resolver_status: "resolved" | "ambiguous" | "unknown";
  cross_source_corroboration: number; // 独立来源数（含本条 = 1）
  recent_corroboration_within_180d: boolean;
  has_superseding_evidence: boolean;
}
```

## 评分函数

```
base =
  0.50 if level == 1
  0.65 if level == 2
  0.75 if level == 3
  0.85 if level == 4
  0.92 if level == 5

method_factor =
  +0.00 if rule
  +0.00 if manual
  -0.05 if llm
  +0.02 if hybrid (rule pattern + llm reformatting)

modal_factor =
  +0.00 if strong (utilize, purchase, ship)
  -0.03 if neutral (use, supply)
  -0.10 if weak (may, can, sometimes)
  -0.25 if future (will, plans to, expects to, intends to)

resolver_factor =
  +0.00 if both resolved
  -0.10 if either ambiguous
  -0.30 if either unknown            # 应该已被 reject，这里 defensive

age_factor =
  +0.00 if source_age_days <= 365
  -0.03 if 365 < source_age_days <= 730
  -0.07 if source_age_days > 730 and not recent_corroboration_within_180d
  +0.00 if recent_corroboration_within_180d

corroboration_factor =
  +0.00 if cross_source_corroboration <= 1
  +0.04 if cross_source_corroboration == 2
  +0.07 if cross_source_corroboration == 3
  +0.10 if cross_source_corroboration >= 4

supersession_factor =
  -0.30 if has_superseding_evidence

confidence = clip(
  base + method_factor + modal_factor + resolver_factor + age_factor + corroboration_factor + supersession_factor,
  0.0,
  0.95
)
```

只有满足"manual reviewed AND level == 5 AND modal == strong AND both resolved AND no supersession"时，可以放宽到 0.97 上限。

## 例子

### 例 1：NVIDIA 10-K 直接披露 → SK Hynix 内存

```
level = 5
method = rule
cite_text = "We purchase memory from SK hynix, Micron Technology and Samsung."
modal = strong (purchase)
source_age_days = 90
resolver = both resolved
corroboration = 2 (NVIDIA 10-K + SK Hynix earnings 提及向 NVIDIA 供货)
no supersession

base                = 0.92
method (rule)       = 0.00
modal (strong)      = 0.00
resolver            = 0.00
age (<= 365)        = 0.00
corroboration (==2) = +0.04
supersession        = 0.00
---
confidence = 0.96 → cap to 0.95
```

### 例 2：BOL 推断 → Importer X 从 Supplier Y 进口（6 次重复）

```
level = 3
method = rule (BOL aggregator)
cite_text = "BOL evidence count = 8 over 2025-10..2026-04"
modal = neutral (BOL 不是叙事文本，按 neutral 处理)
source_age_days = 30
resolver = subject ambiguous (importer 可能是 freight forwarder)
corroboration = 1
no supersession

base                = 0.75
method              = 0.00
modal (neutral)     = -0.03
resolver (ambig)    = -0.10
age                 = 0.00
corroboration       = 0.00
supersession        = 0.00
---
confidence = 0.62
```

注意：is_inferred = true、needs_review = true 仍然成立。

### 例 3：LLM 抽取 + 单一新闻文章

```
level = 2
method = llm
cite_text = "Sources say Company A may begin sourcing from Company B next quarter"
modal = future (may begin)
source_age_days = 200
resolver = both resolved
corroboration = 1
no supersession

base                = 0.65
method (llm)        = -0.05
modal (future)      = -0.25
resolver            = 0.00
age                 = 0.00
corroboration       = 0.00
supersession        = 0.00
---
confidence = 0.35
```

这种 evidence_level 2 + confidence 0.35 → 不进默认输出，进 hypothesis_queue。

## confidence_breakdown 必须落库

```ts
interface ConfidenceBreakdown {
  base: number;
  factors: { name: string; value: number }[]; // 每一项加减分
  cap?: number;
  final: number;
}
```

存在 evidence 表中作为 JSONB。任何 confidence 都必须可追溯到这一份 breakdown。

## edge 的综合 confidence

一条 edge 可能挂多条 evidence。综合 confidence 计算：

```
edge.confidence = max(evidence_confidences)
                + 0.05 * min(3, len(evidence_confidences) - 1)
                # 多证据加 bonus，封顶 +0.10
                # 但 edge.confidence 不超过 0.97
```

不要用平均：低置信证据不会"稀释"高置信证据。

## confidence 的展示

```
[Level 5, conf 0.95]    显示三位，截断不四舍五入
[Level 3, conf 0.62, inferred]
```

不显示百分号（避免误读为概率）。

## confidence 不该用来做什么

- **不**直接做投资决策权重
- **不**用来排序"哪些公司更值得关注"
- **不**用来代替 evidence_level 过滤
- **不**用作 supplier risk score、exposure score 或 alert priority

confidence 是辅助信号，给研究员看的，不是给自动化决策用的。

## 实现要求

- 全函数纯函数（无副作用、无外部 IO）
- 100% 单元测试覆盖
- 任何因子调整必须开 ADR + 全量重算
