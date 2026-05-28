# @supplystrata/agent

`@supplystrata/agent` 是可选的参考 agent 包边界。

它不属于 SupplyStrata 核心运行时，也不被任何核心 package 依赖。v0.x 的核心对外 surface 是 MCP；参考 agent 只能像外部调用方一样通过 MCP 读取候选、证据和审计信息。

## 边界

- 不写入 fact edge、evidence、claim 或审计账本。
- 不被 `packages/*` 内的核心包 import。
- 不持有官方源 truth；truth 仍在官方源，Postgres 只是本地 cache 和 audit ledger。
- 不内置 LLM provider。调用方需要自行提供模型能力，并遵守 `@supplystrata/llm-helpers` 的 candidate-only 约束。

当前包只落地边界契约，后续如果提供示例实现，也必须保持“删除整个包不影响核心”的性质。
