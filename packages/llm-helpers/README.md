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
- 提供 OpenAI-compatible JSON provider adapter，调用侧必须显式传入 provider，不允许 helper 隐式读 key。
- 承接从 `ai-analysis` 迁出的 provider 配置和本地 report artifact candidate 构造，避免应用层直接依赖 AI 执行文件。

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

## Helper 输出边界

每个 helper 都内置 prompt template，并执行输入 schema 校验、输出 schema 校验和 citation 校验。

| Helper                     | 返回什么                                          | 不能被当成什么                             |
| -------------------------- | ------------------------------------------------- | ------------------------------------------ |
| `disambiguate_entity`      | 对输入候选 entity 的排序 candidate                | 新 entity、entity merge 决策、fact edge    |
| `derive_dynamic_profile`   | 上游组件和 source target 的研究 profile candidate | 真实供应商关系、已验证 component taxonomy  |
| `suggest_source_targets`   | 下一步 source target candidate                    | 已排队 job、已抓取 source、已验证 evidence |
| `summarize_with_citations` | 只基于输入 evidence 的摘要 candidate              | claim、edge、evidence、review decision     |

如果 provider 输出引用了输入中不存在的 ref，helper 返回 `status: "invalid_output"`，并清空对应业务 payload。调用方不能绕过这个状态继续提升事实。

当 provider 给出的 `confidence < 0.5` 时，helper 返回 `status: "deferred"`。这表示输出可以作为人工研究线索，但不能被解释成已经消歧、已经确认 profile 或已经完成 source target 选择。

## 与 `ai-analysis` 的关系

`llm-helpers` 不依赖 `@supplystrata/ai-analysis`。当前 `research ai-analyze` 使用这里的本地 artifact candidate / OpenAI-compatible candidate 构造能力，但最终 artifact schema 和 audit ledger 写入仍由 `ai-analysis` 校验与记录。

这条边界避免 LLM package 反向绑定核心分析领域：helper 可以产出 candidate，不能拥有 fact、claim、evidence 或 audit 写入权。
