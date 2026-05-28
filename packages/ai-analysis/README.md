# @supplystrata/ai-analysis

`ai-analysis` 是内部 AI 分析层的只读契约地基。

## 负责什么

- 生成脱敏的 provider readiness：只说明 key/url/model 是否配置，不返回密钥。
- 从 `consumer-read-model` 和 `reasoning-walkthrough` 生成 AI handoff plan。
- 从 research pack 的 `manifest.json`、`consumer-read-model.json`、`reasoning-walkthrough.json` 生成本地模拟 `ai-analysis.json`。
- 在 provider ready 时，通过 OpenAI-compatible chat completions 调用 `openai`、`deepseek` 或 `custom` endpoint，并写出同一份 `ai-analysis.json`。
- 校验 AI 输出 artifact：不得写事实、不得执行 agent 行为、不得运行 source connector、不得引用输入之外的 refs。
- 定义 AI 节点、guardrails、`cannot_conclude`、expected output sections。
- 查询 `ai_analysis_runs`，让外部 API/host app 能看懂 AI 调用状态、输入引用、错误和输出摘要。

## 不负责什么

- 不联网搜索、不运行 source connector、不做 crawler。唯一允许的网络调用是显式配置 provider 后的 LLM chat completions。
- 不写 fact edge、claim、evidence、observation、unknown 或 review decision。
- 不把 AI 摘要作为 claim fusion 或 evidence 输入。

## 配置

Provider 配置由 app 顶层显式传入：

- `LLM_PROVIDER`: `none`、`openai`、`anthropic`、`deepseek`、`custom`
- `LLM_API_KEY`: 通用密钥；也可使用 provider-specific key
- `LLM_BASE_URL`: 外部可配置 endpoint，`custom` provider 必填
- `LLM_MODEL`: 外部可配置模型名

API 状态面只暴露“是否配置”，不暴露具体密钥值。

## 本地模拟输出

当前可用的执行入口是：

```bash
pnpm cli research ai-analyze --pack reports/gate8-lite-check --previous-pack reports/gate1-latest-nvidia
```

它会写出 `reports/gate8-lite-check/ai-analysis.json`。如果 `LLM_PROVIDER` 和 key/url/model 已 ready，会调用 OpenAI-compatible provider；如果没有 ready，或者显式传 `--simulate`，则使用本地模拟输出。两种模式都必须写同一 schema，并通过相同 guardrail 校验。
