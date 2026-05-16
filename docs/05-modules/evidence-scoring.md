# Module: Evidence Scoring — 证据等级与置信度评分

`packages/evidence-scorer`。完整规则见 [evidence-model.md](../03-data-model/evidence-model.md) 与 [confidence-scoring.md](../03-data-model/confidence-scoring.md)。本文是模块实现要求。

## 输入

```ts
interface ScorerInput {
  candidate: CandidateRelation;
  document: NormalizedDocument;
  source_adapter_id: string;
  resolver_results: {
    subject: ResolveResult;
    object: ResolveResult;
  };
  cross_source_count: number;            // 已观察到的其它 source 命中数
}
```

## 输出

```ts
interface ScoringResult {
  evidence_level: 1 | 2 | 3 | 4 | 5;
  confidence: number;
  is_inferred: boolean;
  needs_review: boolean;
  rationale: string;
  confidence_breakdown: {
    base: number;
    factors: { name: string; value: number }[];
    cap?: number;
    final: number;
  };
}
```

## 算法

```
1. 取 source_adapter_id → 默认 evidence_level 上限 (见 source-registry.md 默认映射)
2. 取 candidate.extractor_id 类型（`rule.*` / `llm.*` / `manual.*` / `review.*`）→ 映射为 rule / llm / manual / hybrid，再判断是否降级
3. 检查 modal verb strength
4. 检查 resolver status（任一 ambiguous 严重降置信，unknown 直接拒收）
5. 检查 source_age_days（影响 confidence，不影响 level）
6. 检查 cross_source_count
7. 得到最终 evidence_level（取 min）
8. 得到 confidence（按公式）
9. is_inferred = (level <= 3)
10. needs_review = (extractor 是 llm) OR (level <= 3) OR (resolver 任一 ambiguous)
11. rationale 输出可读文字（用于 review queue 与日志）
```

## 实现要求

- **纯函数**：无 IO、无随机、无时间依赖
- 时间相关计算（source_age）由调用方传入，不在内部读 `Date.now()`
- 单测覆盖：所有边界条件
- 同一 ScorerInput → 必须同样输出

## 反向 sanity check

scorer 在 dev mode 下额外做：

- evidence_level == 5 但 candidate 是 LLM 抽取 → 降到 4 + 警告
- evidence_level == 5 但 modal_verb_strength == "future" → 降到 2 + 警告
- evidence_level == 5 但 resolver_results 任一 ambiguous → 降到 max(level - 2, 2) + 警告

警告写日志，但不阻塞流程（生产中 hard cap 已经把这些都堵住了）。

## Promotion / Demotion

scorer **本身不做 promotion/demotion**：

- 它只对单条 candidate 评级
- edge 综合 evidence_level（取 max）由 graph-builder 计算
- 因新证据带来的 promotion 也由 graph-builder 触发

scorer 是无状态的。

## CLI

```
supplystrata score --doc DOC-xxx
supplystrata score --candidate <id>
supplystrata score --rerun-all     # 危险，要带 --force
```

`rerun-all` 用于公式调整后批量重打分；不会改 evidence 表的历史记录，而是对每条 evidence 计算新的 confidence 并写新行（旧行 supersede）。
