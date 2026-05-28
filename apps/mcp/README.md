# @supplystrata/mcp

`apps/mcp` 是 SupplyStrata v0.x 的对外 MCP surface。它负责 transport、tool/resource 注册和协议级 contract，不承载 HTTP 细节，也不反向依赖 `apps/api`。

## 当前 surface

- `ping` tool：只用于验证 stdio MCP server 能被 SDK client 连通。

### Read tools

- `resolve_company`
- `read_evidence_for_edge`
- `traverse_chain`
- `list_unknowns`
- `list_source_targets`
- `poll_research_run`

所有 read tools 都通过注入的 `@supplystrata/api-orchestration` handlers 返回既有 API envelope。`apps/mcp` 不直接读取数据库，也不直接调用 `llm-helpers`。

### Write tools

- `start_research_session`
- `run_source_check`
- `confirm_research_session`
- `review.approve`
- `review.reject`

Write tools 只使用 MCP spec 标准 annotation 字段：

- 启动型工具：`readOnlyHint: false`、`destructiveHint: false`
- 事实/终态写工具：`readOnlyHint: false`、`destructiveHint: true`

Annotation 只给 host 做 UX risk hint；真正护栏在 server-side pending gate。第一次调用写工具只返回 `requires_confirmation`、`pending_id`、`confirmation_token` 和 `summary_of_action`，不会写 truth/cache、不会入 source-check 队列、不会发 LLM 请求。显式确认后才执行；token 单次有效，过期或不匹配返回 `invalid_token`。

`start_research_session` 通过 `confirm_research_session` 确认；`run_source_check`、`review.approve`、`review.reject` 在同名 tool 中携带 `pending_id` + `confirmation_token` 确认。review 写入通过注入的 `api-orchestration` handler 进入现有 review-store 边界，并在 reason 中加 `via=mcp-tool` 来源。

## Resource URI grammar

B 阶段的 resource URI 使用 `supplystrata://{resource}/{id}` 形式，`resource` 只表示 MCP resource 类型，`id` 使用调用方已解析出的稳定标识。URI 是协议层定位符，不是真实源地址；官方源 URL 必须继续通过 evidence / citation DTO 返回。

- `supplystrata://entity/{id}`
- `supplystrata://evidence/edge/{id}`
- `supplystrata://unknowns/company/{id}`
- `supplystrata://changes/entity/{id}`
- `supplystrata://source-health`
- `supplystrata://reasoning-walkthrough/{id}`

当前 `api-orchestration` 只有全局 `ChangesApiResponse` 与 `SourcesHealthApiResponse`，还没有 entity-scoped changes 或 source-target DTO。因此 `changes/entity/{id}` 暂时返回现有 change timeline envelope，`list_source_targets` 暂时返回 source health envelope；真正的 entity filter / source target DTO 应单独扩展 API contract。

## 本地启动

```sh
pnpm --silent mcp --transport=stdio
```

`stdio` 的 stdout 是 MCP 协议通道；通过 pnpm 启动时使用 `--silent` 可以避免包管理器横幅污染协议流。构建后的 `supplystrata-mcp --transport=stdio` 不需要这个参数。
