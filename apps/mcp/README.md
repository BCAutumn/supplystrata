# @supplystrata/mcp

`apps/mcp` 是 SupplyStrata v0.x 的对外 MCP surface。它负责 transport、tool/resource 注册和协议级 contract，不承载业务规则，也不反向依赖 `apps/api`。

## 当前 surface

- `ping` tool：只用于验证 stdio MCP server 能被 SDK client 连通。

### Read tools

- `resolve_company`
- `read_evidence_for_edge`
- `traverse_chain`
- `list_unknowns`
- `list_source_targets`
- `poll_research_run`

所有 read tools 都通过注入的 `@supplystrata/api-orchestration` handlers 返回既有 API envelope。`apps/mcp` 不直接调用业务 domain、source workflow 或 `llm-helpers`。

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

`start_research_session` 通过 `confirm_research_session` 确认；`run_source_check`、`review.approve`、`review.reject` 在同名 tool 中携带 `pending_id` + `confirmation_token` 确认。DB-backed runtime 下，写入通过注入的 `api-orchestration` handler 进入现有 workflow/review 边界；review reason 会加 `via=mcp-tool` 来源。

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
pnpm --silent mcp --transport=stdio --runtime=fixture
pnpm mcp --transport=http --runtime=fixture --port=7474
```

`stdio` 的 stdout 是 MCP 协议通道；通过 pnpm 启动时使用 `--silent` 可以避免包管理器横幅污染协议流。构建后的 `supplystrata-mcp --transport=stdio` 不需要这个参数。

`--runtime=fixture|db` 控制 handlers 来源；默认是 `fixture`，用于协议 smoke 和本地 tool shape 验证，不连接数据库。`--runtime=db` 会读取 `.env` / source credentials，要求显式提供 `POSTGRES_URL`，并通过 `@supplystrata/api-orchestration` 接入本地 Postgres cache + audit ledger；缺少 `POSTGRES_URL` 会 fail-fast，不会静默退回 fixture。

```sh
pnpm --silent mcp --transport=stdio --runtime=db
pnpm smoke:mcp
pnpm smoke:mcp:db
```

HTTP transport 默认绑定 `127.0.0.1`，endpoint 是 `/mcp`：

```sh
pnpm mcp --transport=http --runtime=fixture --port=7474 --bind=127.0.0.1
```

当前实现使用 SDK 的 Streamable HTTP transport；该 transport 自带 SSE stream 支持，不接已废弃的独立 SSE transport。HTTP 模式只用于本机 agent、浏览器调试或明确受控的远程调用。

远程访问必须显式绑定全部网卡：

```sh
pnpm mcp --transport=http --runtime=fixture --port=7474 --bind=0.0.0.0
```

⚠️ `--bind=0.0.0.0` 会把本机 MCP surface 暴露给局域网或外部网络。SupplyStrata v0.x 仍按 local-first 假设运行；如需远程访问，必须由调用方自行放在受控网络、隧道或反向代理之后，并承担访问控制责任。默认不设置宽泛 CORS；`OPTIONS` 只返回 MCP endpoint 需要的方法和 header。
