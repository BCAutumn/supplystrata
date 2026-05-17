# Module: Relation Extraction — 关系抽取

`packages/relation-extractor`。给定 `NormalizedDocument`，输出 `CandidateRelation` 流。

## 设计原则

1. **抽取器只产候选**，不写图、不打 evidence_level（评级在 evidence-scorer）
2. **每个候选必须挂 cite_text**（≥ 30 字符），无 cite 的拒收
3. **规则优先**，LLM 兜底
4. **可重现**：相同输入 → 相同候选集

## 三类抽取器

### 1. Rule extractors（高优先级）

当前代码里的通用 SEC 规则包是 `rule.sec.official-supply-chain`。它只依赖 SEC 官方披露契约：

- `doc.source_adapter_id === "sec-edgar"`（离线 fixture 可用 `sec-edgar-fixture`，按同一官方披露规则域处理）
- `doc.document_type` 属于 `10-K` / `10-Q` / `8-K`
- `doc.primary_entity_id` 存在

subject 直接使用 `doc.primary_entity_id`，再交给 EntityResolver 解析。因此同一套规则可以用于 NVIDIA、AMD、Micron、Broadcom、Microsoft 等 SEC 文件，不允许把 NVIDIA 这类测试样例写死在业务逻辑里。

当前规则族已覆盖：

- foundry / wafer manufacturing：命名 foundry 才产 `USES_FOUNDRY`。
- memory supplier：只有原文明确 `memory` / `DRAM` / `HBM` 时才产 `BUYS_FROM`，不会把普通 memory 升级成 HBM。
- contract manufacturer：命名 Hon Hai / Wistron / Fabrinet 等，且出现 assembly/testing/packaging 语境才产边。
- named major customer：命名客户 + revenue/sales/customer concentration 语境才产 `SUPPLIES_TO`。
- named purchase obligation / capacity reservation：命名供应商 + purchase commitment / supply agreement / capacity reservation 语境才产边。
- named single-source supplier risk：命名供应商 + sole/single-source 语境才产边。

匿名客户集中度（例如 `one customer accounted for 21%`）和匿名供应商风险（例如 `limited number of suppliers`）暂不产 company edge；后续进入 observation / unknown 层。

```
packages/relation-extractor/rule/
├── 10k/
│   ├── foundry-disclosure.ts
│   ├── memory-purchase.ts
│   ├── contract-manufacturer.ts
│   ├── customer-concentration.ts        # 抽 "one customer accounted for X%"
│   └── ...
├── supplier-list/
│   ├── apple-supplier-row.ts
│   └── ...
└── filings-8k/
    ├── material-agreement.ts
    └── ...
```

每条规则：

```ts
export const foundryDisclosureExtractor: RelationExtractor = {
  id: "rule.sec.foundry-disclosure",
  priority: 100,
  relation_types: ["USES_FOUNDRY"],
  applicable: (doc) =>
    ["10-K", "10-Q", "20-F"].includes(doc.document_type),
  extract: async function* (doc, ctx) {
    for (const chunk of doc.chunks) {
      for (const m of matchPattern(chunk.text)) {
        yield buildCandidate({
          subject_resolve: { surface: doc.primary_entity_id, context },
          object_resolve : { surface: m.foundry_name, context: { ... } },
          relation: "USES_FOUNDRY",
          cite_text: chunk.text.slice(m.startSentenceIdx, m.endSentenceIdx),
          cite_locator: chunk.locator,
          extractor_id: "rule.sec.foundry-disclosure",
          raw_evidence_level_hint: 5,
          raw_confidence_hint: 0.95,
        });
      }
    }
  }
};
```

约束：

- 模式必须有 negative test（防止 "competitors include TSMC" 误匹配）
- 模式不允许跨 chunk
- cite_text 必须包含完整句子（不是只截关键词周围）

### 2. LLM extractor（低优先级，兜底）

```
packages/relation-extractor/llm/
├── extractor.ts
├── prompts/
│   ├── relation-extraction.txt
│   └── customer-segment.txt
└── schemas/
    └── relation-output.schema.ts
```

#### Prompt

```
你将看到某家公司的官方文件片段。任务：从这段文字中抽取**明确陈述**的供应链关系。

仅当原文有清楚陈述时才输出关系。
不要从行业知识推测。
不要把"竞争对手"误认为"供应商"。
不要输出未来时态或计划性陈述（"may"、"plan to"、"expects to"）。
不要把代词解析跨越句子。

输出 JSON 数组，每个对象：
{
  "subject": "<原文中提到的主体>",
  "relation": "BUYS_FROM" | "SUPPLIES_TO" | "USES_FOUNDRY" | "USES_COMPONENT" | "MANUFACTURES_AT" | "OWNS_SUBSIDIARY",
  "object": "<原文中提到的客体>",
  "component": "<可选>",
  "cite_text": "<原文连续片段，>=30 字符>",
  "modal_verb_strength": "strong" | "neutral" | "weak" | "future",
  "confidence": 0..1
}

如果没有明确关系，输出空数组。
```

#### 强制约束

- LLM 输出过 zod schema
- `cite_text` 必须是 chunk.text 的子串（精确匹配检查）；不是子串 → 拒收
- `confidence` 上限 0.85（即使 LLM 报 0.99 也截断）
- `evidence_level_hint = 4`（受 LLM 上限规则限制）
- 默认 `needs_review = true`

#### 反对的事

- 不允许 LLM "总结" 关系（只能 cite 原文）
- 不允许 LLM 跨 chunk 拼接
- 不允许 LLM 输出 "as a major supplier" 之类无具体客体的描述

### 3. Cross-source corroborator

不直接抽，但跨已抽候选做合并：

- 同一关系（subject + object + relation + component）出现在多个独立 source_adapter_id → 合并 evidence
- 增加 cross_source_corroboration 计数（影响 confidence）
- 不改 evidence_level，只影响综合 confidence

## 抽取流水线

```
For each document:
  1. 跑 applicable() 选出可用 rule extractors
  2. 按 priority 降序跑 rule extractors（rule 之间互不依赖）
  3. 把 chunk 内 rule 已经命中的 sentence 标记
  4. 对未被规则命中的 chunk（且文档类型为 10-K 等）跑 LLM extractor
  5. 收集所有 candidates，去重（subject + object + relation + component + cite_text 哈希）
  6. 输出到 evidence-scorer
```

去重逻辑必须保留多个 cite_text（同一关系不同片段）作为多 evidence 而非合并。

## 候选的字段完整性检查

在送入 scorer 之前，pipeline 校验：

- [ ] `cite_text` 长度 ≥ 30
- [ ] `cite_text` 是文档原文子串
- [ ] `subject_resolve` / `object_resolve` 至少含 surface
- [ ] `relation` 在 RELATION_TYPES 内
- [ ] 主体/客体的合法 Kind 与 relation 矩阵一致

任一不通过 → 拒收并写 `extraction_rejections`（保留作 negative sample）。

## 性能

- 单文档 LLM 调用上限：默认 10 chunks（节省成本）
- chunk 选择策略：
  - 含已知实体 mention 的 chunk 优先
  - 文档类型为 10-K 时，限定到 Item 1 / 1A / 7 段
  - 其它文档类型按发现的实体密度排序

## 抽取器版本与重跑

- 每个抽取器维护 `version` 字段
- 同一 (doc_id, extractor_id, extractor_version) 是去重 key
- 抽取器版本升级时：
  - 老候选保留（用于对比）
  - 新候选作为 superseding evidence
  - 双跑期允许并存

## 测试

每条 rule extractor 必须配：

- 至少 3 条 positive 样本（应该命中）
- 至少 3 条 negative 样本（应该不命中）
- 至少 1 条 edge case（措辞模糊 / 标点异常）

`tests/extractors/<id>/positive_*.txt` 与 `negative_*.txt`。CI 强制跑。

LLM extractor：

- 用一组冻结 prompt（含模型版本）跑回归
- 任何 prompt / 模型变更 → 全量重跑 + 人工 review diff

## CLI 接入

```
supplystrata extract --doc DOC-xxx [--extractors rule.*]
supplystrata extract --since 2026-04-01
supplystrata extract --rerun-rejected
```
