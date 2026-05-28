# @supplystrata/config

`config` 是运行时环境和公开 source credential 契约的集中入口。

## 负责什么

- 解析 `.env`、环境变量和 `config/source-credentials.local.json`。
- 定义 Postgres、Neo4j、object store、日志级别、source API key 和内部 AI provider 配置的 schema。
- 维护 source credential definitions，供 source-management、source-workflows 和 CLI 复用。
- 提供缺失凭据检查函数。

## 不负责什么

- 不执行业务流程。
- 不访问外部 source。
- 不决定 source target 是否可写入事实层。
- 不在库层隐式初始化全局配置。

## 主要入口

- `loadEnv(options)`：在 CLI、worker、app 顶层加载环境。
- `SOURCE_CREDENTIAL_DEFINITIONS`：统一 source key 定义。
- `missingSourceCredentialRequirements(env, requirements)`：检查 connector 所需 key。
- `requireSourceCredential(env, key)`：读取必需 key。
- 内部 AI 配置：`LLM_PROVIDER`、`LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`，以及 provider-specific key（如 `OPENAI_API_KEY`）。这些值只在 app 顶层加载，API 状态面只返回“是否配置”，不会返回密钥内容。

## 边界约定

`loadEnv()` 会写入 `process.env`，因此应只在 app/CLI/worker 顶层调用。库代码应通过显式 context 接收配置。
