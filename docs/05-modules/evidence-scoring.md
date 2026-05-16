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
  cross_source_count: number; // 已观察到的其它 source 命中数
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
1. 取 source_adapter_id + document_type → source authority matrix（publisher_type、relation_authority、source_cap）
2. 用 relation_authority + relation_type 计算 relation_cap
3. 取 candidate.extractor_id 类型（`rule.*` / `llm.*` / `manual.*` / `review.*`）→ 映射为 rule / llm / manual / hybrid，再判断 method_cap
4. 检查 modal verb strength
5. 检查 resolver status（任一 ambiguous 严重降置信，unknown 直接拒收）
6. 检查 source_age_days（影响 confidence，不影响 level）
7. 检查 cross_source_count
8. 得到最终 evidence_level（取 min(raw_hint, source_cap, relation_cap, method_cap, modal_cap)）
9. 得到 confidence（按公式）
10. is_inferred = (level <= 3)
11. needs_review = (extractor 是 llm) OR (level <= 3) OR (resolver 任一 ambiguous) OR (source 是 lead/macro)
12. rationale 输出可读文字（用于 review queue 与日志）
```

## Source Authority Matrix

`packages/source-registry` 是来源权威矩阵的唯一入口。scorer 不再用 `document_type -> level` 的简单映射，而是先判断“这个来源能证明哪类事实”。

| publisher_type           | relation_authority | 典型来源                           | 最高等级 | 说明                                                          |
| ------------------------ | ------------------ | ---------------------------------- | -------- | ------------------------------------------------------------- |
| `regulator`              | `self_disclosure`  | SEC EDGAR 10-K / 10-Q / 20-F / 8-K | 5        | 监管披露里的公司自述可作为强证据。                            |
| `company_official`       | `self_disclosure`  | 公司 IR、年报、官方演示            | 4        | 官方但非同等监管文件，默认不升到 Level 5。                    |
| `official_supplier_list` | `facility_claim`   | Apple Supplier List                | 4        | 可证明供应商/设施声明，但仍走 review/apply。                  |
| `government_registry`    | `registry_fact`    | Companies House / OpenCorporates   | 4        | 可证明法人、注册、控制或设施事实；不能直接证明采购/供应链边。 |
| `manual`                 | `lead_only`        | ImportYeti 手工摘录、灰色线索      | 1-3      | 只能作为线索或低等级候选，默认需要 review。                   |

关系维度会再次收紧等级。例如 `registry_fact` 对 `OWNS_SUBSIDIARY` / `OWNS_BUSINESS_UNIT` / `OPERATES_FACILITY` 可到 Level 4，但对 `BUYS_FROM` / `SUPPLIES_TO` 只能到 Level 2。宏观贸易、能源、AIS 等后续来源必须落到 observations 或 lead，不得直接生成高等级公司关系边。

## 实现要求

- **纯函数**：无 IO、无随机、无时间依赖
- 时间相关计算（source_age）由调用方传入，不在内部读 `Date.now()`
- 单测覆盖：所有边界条件
- 同一 ScorerInput → 必须同样输出
- `extractor_id` 只能使用 `rule.` / `llm.` / `manual.` / `review.` 前缀；未知前缀必须 fail-fast，不允许静默当成 LLM

## 反向 sanity check

scorer 在 dev mode 下额外做：

- evidence_level == 5 但 candidate 是 LLM 抽取 → 降到 4 + 警告
- evidence_level == 5 但 modal_verb_strength == "future" → 降到 2 + 警告
- evidence_level == 5 但 resolver_results 任一 ambiguous → 降到 max(level - 2, 2) + 警告
- extractor_id 前缀未知 → 直接抛错，阻断 evidence 写入

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
