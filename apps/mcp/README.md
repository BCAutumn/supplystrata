# @supplystrata/mcp

`apps/mcp` 是 SupplyStrata v0.x 的对外 MCP surface。它负责 transport、tool/resource 注册和协议级 contract，不承载 HTTP 细节，也不反向依赖 `apps/api`。

## 当前 surface

- `ping` tool：只用于验证 stdio MCP server 能被 SDK client 连通。

## 规划中的 surface

- `resolve_company`
- `list_source_targets`
- `run_source_check`
- `poll_research_run`
- `traverse_chain`

## Resource URI grammar

B 阶段的 resource URI 使用 `supplystrata://{resource}/{id}` 形式，`resource` 只表示 MCP resource 类型，`id` 使用调用方已解析出的稳定标识。URI 是协议层定位符，不是真实源地址；官方源 URL 必须继续通过 evidence / citation DTO 返回。

## 本地启动

```sh
pnpm --silent mcp --transport=stdio
```

`stdio` 的 stdout 是 MCP 协议通道；通过 pnpm 启动时使用 `--silent` 可以避免包管理器横幅污染协议流。构建后的 `supplystrata-mcp --transport=stdio` 不需要这个参数。
