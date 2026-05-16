# ADR-003 — LLM 使用策略

- **Status**: accepted
- **Date**: 2026-05-16
- **Deciders**: 项目维护者
- **Context window**: Phase 0；影响 relation-extractor / entity-resolver / cost / 法律

## Context

LLM 在本系统中的可能用途：

1. 关系抽取兜底（rule 没命中的段落）
2. 实体消歧的上下文判断
3. 文档分类 / chunking 辅助
4. 自然语言查询 → 结构化查询（远期）

LLM 的风险：

- Hallucination：编造关系
- Cost：长 context 易爆
- 不可重现：模型升级造成行为变化
- 法律：传送了什么内容到外部 API

## Options Considered

### Option A: 重度依赖 LLM

把所有抽取都让 LLM 跑，规则只作为后处理。

- 优点：起步快、覆盖广
- 缺点：
  - hallucination 风险高
  - cost 难控
  - 输出难以审计
  - 与"事实图谱"定位冲突

### Option B: 不用 LLM，全规则 + 词典

- 优点：可重现、低成本、可审计
- 缺点：覆盖率低、规则维护成本高、无法处理新文档类型

### Option C: 规则优先 + LLM 兜底（推荐）

- 优点：
  - 高置信度路径走规则（确定模式）
  - 长尾走 LLM（可控且可审）
  - 强制 cite + zod schema + needs_review 控制风险
- 缺点：
  - 抽取流水线复杂度增加
  - 需要严肃的 prompt 管理

### Option D: 自训本地 NER / Relation Model

- 优点：可重现 / 离线 / 低成本
- 缺点：
  - 标注成本高
  - 模型质量未必比商业 LLM 好
  - 偏离"利用免费/公开数据起步"的精神

## Decision

选择 **Option C：规则优先 + LLM 兜底**。

具体策略：

- **强制 cite_text**：LLM 输出的关系必须包含原文片段，且 cite_text 是 chunk.text 的子串（精确校验，不是模糊）
- **强制 zod schema**：LLM 输出过 zod；不合法直接拒收
- **evidence_level 上限 4**：LLM 抽取永远不能产生 Level 5
- **default needs_review = true**：LLM 边必须走人工审；cross-source corroboration 只能辅助判断，不能替代 review
- **不让 LLM 给"经验性"答案**：prompt 明确要求"仅基于原文，没有就输出空"
- **prompt 与模型版本入仓**：prompt 文件入 git；模型 ID 入 config；prompt_hash 落每条 evidence
- **cost 监控**：每次调用记录 input/output tokens、cost、latency
- **provider 切换抽象**：通过 `packages/llm-bridge` 抽象，支持 Anthropic / OpenAI / 未来本地模型
- **MVP 默认 provider**：Anthropic Claude（结构化输出 + 长 context + 法律导向较强的 helpful/honest 训练）；若 cost 不接受则切 OpenAI

### 实体消歧中的 LLM

- 仅作为 Step 5 fallback（详见 [entity-resolution.md](../05-modules/entity-resolution.md)）
- 必须 cite 上下文
- 默认 LLM_RESOLVER_ENABLED = false（MVP 阶段先不开，等规则覆盖足够后再考虑）

### 不让 LLM 做的事

- 不做"基于行业经验补全"
- 不做跨 chunk 拼接
- 不做"总结" / "归纳"（输出必须是 cite + 结构化字段）
- 不直接进图谱（必须经过 review queue）

## Consequences

### Positive

- 风险可控：所有 LLM 输出都可以追溯到原文
- 成本可控：明确 prompt + token 预算
- 审计可重现：prompt_hash + model_id 让我们能复现某次抽取
- 可降级：LLM 不可用时整个 pipeline 仍能跑（仅规则）

### Negative / Trade-offs

- 抽取覆盖率受规则覆盖率拖累
- LLM bridge 增加一个抽象层
- 需要持续维护 prompt 与回归

### Risks We Accept

- 个别长尾关系不会被抽到（属于 unknown_map 的内容）
- LLM 模型升级时需要重跑回归

### Risks We Mitigate Now

- 强制 cite_text 子串校验：从根本上挡住 hallucination
- prompt 入仓 + hash：保证可复现
- needs_review：人工是最后一道防线

## Implementation Notes

- `packages/llm-bridge/`：
  - 接口 `LlmExtractor<TIn, TOut>`，schema by zod
  - 内部实现：anthropic / openai 两个 provider；同一接口
  - 调用前后必写 `llm_calls` 表
- prompt 文件：`packages/relation-extractor/llm/prompts/<topic>.txt`
- 默认参数：
  - temperature 0
  - max_output_tokens 严格上限
  - timeout 30s
  - retry：单次失败仅一次重试，避免 cost 爆炸

## Revisit Triggers

- Hallucination 率超过阈值（≥ 1%）
- LLM cost 月度超过阈值
- 出现质量更稳定的开源模型 + 本地推理性价比合理
- LLM provider 出现 ToS 变化

## References

- [relation-extraction.md](../05-modules/relation-extraction.md)
- [evidence-model.md](../03-data-model/evidence-model.md)
- [entity-resolution.md](../05-modules/entity-resolution.md)
