# @supplystrata/llm-helpers

`llm-helpers` 是核心代码中唯一允许接触 LLM provider 的包。

## 负责什么

- 暴露 4 个具名 helper：
  - `disambiguate_entity`
  - `derive_dynamic_profile`
  - `suggest_source_targets`
  - `summarize_with_citations`
- 每个 helper 只返回 candidate，带 `status`、`confidence`、引用来源和 `fact_write_allowed: false`。
- 读取全局禁用开关 `SUPPLYSTRATA_LLM_DISABLED=1`，禁用时所有 helper 返回 `disabled` candidate。
- 提供 `LlmProvider` interface，后续 provider plugin 只能接在这个窄口上。
- 承接从 `ai-analysis` 迁出的 provider 配置、OpenAI-compatible 调用边界和本地模拟输出，避免应用层继续直接依赖 AI 执行文件。

## 不负责什么

- 不写 `edges`、`evidence`、`claims`、`unknowns` 或 review decision。
- 不执行 source check，不抓网页，不做 agent loop。
- 不把 LLM 输出升级成事实；candidate 进入事实层前必须经过 evidence-gated promote 或 review。

## Disabled 行为

以下情况 helper 必须返回 `status: "disabled"`：

- `SUPPLYSTRATA_LLM_DISABLED=1`
- 调用方没有传入 provider
- 调用方显式设置 `disabled: true`

disabled candidate 是合法输出，但不能被调用方当成事实、证据或结论使用。
