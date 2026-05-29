# Quickstart — 从空环境跑到研究输出

本文目标：让第一次 clone 仓库的人 5 分钟内确认：

- 代码能编译、依赖能装。
- 无数据库静态预览能跑出 NVIDIA 研究包。
- 本地数据库 smoke 能跑通。
- 联网 smoke 能从 SEC EDGAR 抓 NVIDIA 10-K 并写本地 cache。

新形态正在落地：MCP server (`apps/mcp`) 和 SCBOM 开放格式（[decisions.md](../10-decisions/decisions.md) #7、#10）将成为唯一对外接口；当前 CLI 命令在 v0.x 内仍可用。

## 先决条件

- Node.js LTS >= 22
- pnpm >= 9
- 可连接的 Postgres（持久化路径需要；纯预览不需要）
- Docker Compose v2（可选，用于一键起本地 Postgres / Neo4j）
- GraphStore 后端（可选；仓库内置 Neo4j adapter）

CLI 和 source adapter 都是 TypeScript。Docker 只是本地起 Postgres / Neo4j 的便利工具，不是产品运行时强依赖。

## 1. 安装

```bash
pnpm install
cp .env.example .env
cp config/source-credentials.example.json config/source-credentials.local.json
```

SEC 抓取、NVIDIA 规则切片、GLEIF LEI 查询、TWSE MOPS 目录 monitor 都**不需要 LLM key、不需要 source API key**。需要 key 的公开源（OpenDART、EDINET、OpenCorporates、Companies House、Census Trade、Open Supply Hub）配在 `config/source-credentials.local.json`（gitignored）。缺 key 时对应目标会稳定标记 `missing_credentials`，不阻断研究输出。

## 2. 无数据库预览（最快验证路径）

```bash
pnpm --silent cli examples nvidia preview --format markdown
pnpm --silent cli examples nvidia report --format markdown --lang zh
pnpm --silent cli research from-workbench --workbench reports/nvidia-workbench.json --out reports/nvidia-snapshot
```

这条路径不落库、不写 Neo4j，走 `plan/fetch/normalize` 契约。适合：

- 第一次评估系统能解析出什么。
- 未来嵌入式调用方式（host app / MCP server）的快速验证。
- CI 离线回归。

如果不确定该跑哪条路径：

```bash
pnpm --silent cli runtime doctor --format markdown
```

## 3. 本地 Smoke（含数据库）

```bash
docker compose up -d postgres neo4j   # 可选；或改 .env 指向已有服务
pnpm smoke:local
```

`smoke:local` 会跑：migration → dev fixture import → 图谱 rebuild → graph check。这个模式不访问外网；dev fixture 只用于本地/CI，不代表产品默认公司覆盖范围。

## 4. 联网 Smoke（含 SEC EDGAR）

```bash
pnpm smoke:research
```

会跑：migration → dev fixture import → `examples nvidia ingest` → claims build → workbench export。通过后说明当前环境能从 SEC EDGAR 抓 NVIDIA 10-K、解析、抽取关系、评分、落 Postgres cache、输出 workbench JSON。

## 5. 跑一份完整研究包

```bash
pnpm --silent cli research run \
  --company nvidia \
  --depth 3 \
  --prepare-data \
  --out reports/nvidia-research-pack

node scripts/render-research-html.mjs \
  reports/nvidia-research-pack \
  reports/latest-nvidia-research.html
```

`--prepare-data` 显式触发派生上下文刷新（claims / intelligence / root unknowns / component risk）。默认 `research run` 是只读打包。

研究包会输出 README + 大量结构化 artifact（consumer-read-model、reasoning-walkthrough、official-disclosure-readiness、propagation-readiness、investigation-backlog、source-target-coverage、gate1-data-depth-workbench 等）。具体每个 artifact 的语义见 `packages/research-pack/README.md`。

## 6. 持续监控（可选）

```bash
pnpm --silent cli sources policy sync --file config/source-policies.example.json
pnpm --silent worker --once --limit 5
# 持续运行: pnpm worker --interval-ms 60000 --limit 10
```

`apps/worker` 是 opt-in 常驻进程。SupplyStrata 不假设 7x24 部署（[decisions.md](../10-decisions/decisions.md) #8）。

## 7. MCP server

`apps/mcp` 是 v0.x 的唯一对外 surface（详见 [data-flow.md](../02-architecture/data-flow.md) "MCP 接入面"）。本机 agent / Claude Desktop / Cursor 这类 stdio host 使用：

```bash
pnpm --silent mcp --transport=stdio
```

通过 pnpm 启动 stdio 时要加 `--silent`，避免包管理器日志污染 MCP 协议流。浏览器调试或受控远程 agent 使用 HTTP endpoint：

```bash
pnpm mcp --transport=http --port=7474
```

HTTP 默认只绑定 `127.0.0.1`，endpoint 是 `/mcp`。只有确认网络边界后才显式开放：

```bash
pnpm mcp --transport=http --port=7474 --bind=0.0.0.0
```

`--bind=0.0.0.0` 会暴露本机 MCP surface；v0.x 不内置远程鉴权层，远程访问必须放在受控网络、隧道或反向代理后。

快速验证 MCP 协议和工具 shape：

```bash
pnpm smoke:mcp
pnpm smoke:mcp:http
```

`smoke:mcp` 会启动 stdio MCP fixture server，枚举全部 tools，调用 read/write tools、全部 read resources，并验证 write tool 必须先返回 `requires_confirmation`、再用单次 `confirmation_token` 执行；同时覆盖无效 token 与 token 重用。`smoke:mcp:http` 用 SDK Streamable HTTP client 连接 `/mcp`，验证 HTTP transport 的真实调用路径。DB-backed runtime 用 `pnpm smoke:mcp:db` 单独验证，需要可达 Postgres。REST API 只作为迁移期兼容路径保留。

SCBOM v0.0.1 通过 MCP resource 输出，适合外部 agent / host app 直接消费：

```text
supplystrata://scbom/company/ENT-NVIDIA
```

该 resource 返回原始 `ScbomDocument`，不是 API envelope；本仓库用 pinned `@scbom/spec` git dependency 校验。端到端验证：

```bash
pnpm vitest run tests/e2e/scbom-export.test.ts
```

## 8. Community-pack warm-start（可选）

community-pack 是只读 warm baseline，适合新本地实例先加载一份已发布的 SCBOM pack，再按需向官方源复核。它不是真相来源；本地 / 上游重新拿到 relationship-backed SCBOM 时会覆盖 pack baseline。

从当前本地 cache 构建 pack：

```bash
pnpm build
pnpm pack:build --company nvidia --pack-version pack-2026.Q2 --generated-at 2026-05-29T00:00:00.000Z --out reports/community-pack
pnpm pack:checksums
```

用 pack 启动 MCP HTTP runtime，再打开本地 viewer：

```bash
pnpm mcp --transport=http --runtime=fixture --pack=reports/community-pack --port=7474
pnpm web --company ENT-NVIDIA --mcp-url http://127.0.0.1:7474/mcp --port 8787
```

端到端验证：

```bash
pnpm vitest run tests/e2e/community-pack-warm-start.test.ts
```

## 9. Reference agent（可选）

`@supplystrata/agent` 和 `apps/agent-cli` 是独立 reference client，不被核心依赖。它只通过 MCP 调 SupplyStrata，报告阶段复用 `@supplystrata/llm-helpers` 的 provider 配置；没有 citation-backed evidence 时必须输出 `cannot_conclude`，不会补故事。

本地开发入口：

```bash
pnpm agent --company "Samsung Electronics" --provider openai --model gpt-4.1-mini --mcp-runtime db
```

等价的安装后命令名是：

```bash
supplystrata-agent --company "Samsung Electronics" --provider openai --model gpt-4.1-mini --mcp-runtime db
```

LLM key 走标准环境变量（如 `OPENAI_API_KEY`、`DEEPSEEK_API_KEY`、`LLM_API_KEY`）。不想触发 LLM 时可用 `--provider none` 验证 MCP 链路；这时如果没有可引用 evidence，命令会以退出码 `2` 输出 `cannot_conclude`：

```bash
pnpm agent --company NVIDIA --provider none --mcp-runtime fixture
```

如果已经有独立 MCP HTTP server，也可以改用 HTTP transport：

```bash
pnpm mcp --transport=http --runtime=db --port=7474
pnpm agent --company "TSMC" --provider openai --mcp-transport http --mcp-url http://127.0.0.1:7474/mcp
```

也可以让 agent 产出离线 HTML artifact；该文件内联 SCBOM document 和 viewer IIFE，不需要联网才能打开：

```bash
pnpm build
pnpm agent --company NVIDIA --provider none --mcp-runtime fixture --html-artifact reports/nvidia-scbom.html
```

## 10. SCBOM Web viewer（可选）

本地 viewer 是薄壳，默认只连本机 MCP HTTP endpoint：

```bash
pnpm build
pnpm mcp --transport=http --runtime=db --port=7474
pnpm web --company ENT-NVIDIA --mcp-url http://127.0.0.1:7474/mcp --port 8787
```

第三方页面可直接嵌入 Web Components：

```html
<script src="./components.iife.js"></script>
<scbom-evidence-view></scbom-evidence-view>
<scbom-unknown-map></scbom-unknown-map>
<script>
  window.ScbomViewer.registerScbomComponents();
  document.querySelector("scbom-evidence-view").scbomDocument = scbomDocument;
</script>
```

React / Vue 等深度定制场景不需要 wrapper；直接消费 L0 headless core 自画 UI：

```ts
import { createScbomView } from "@supplystrata/web";

const view = createScbomView(scbomDocument);
```

## 发布前体检

```bash
pnpm release:check            # 默认：不要求 Docker
pnpm release:check --with-db  # 含本地 DB cache / GraphStore 体检
```

跑：ignore rules、secret scan、type-check、unit、integration、fixture e2e、lint、dependency boundary、无数据库 `smoke:local`、MCP smoke。

## 常见失败

| 现象                                              | 处理                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `ECONNREFUSED localhost:5432`                     | Postgres 没起来；与解析 / 抽取逻辑无关；先 `docker compose up postgres` 或调 `.env`。       |
| `graph check` 不同步                              | 先 `pnpm cli graph rebuild`；仍不同步看 Neo4j 是否启动完成。                                |
| `smoke:research` SEC 抓取失败                     | SEC 临时限流或网络问题；先跑 `smoke:local` 缩小范围。                                       |
| GLEIF / OpenCorporates / Companies House 没结果   | GLEIF 不需要 key；其它必须配 API key；缺 key 时命令应明确报认证缺失，不退化爬网页。         |
| research-pack 显示 `observations_only` 但 facts=0 | 这是数据深度问题，不是架构问题；见 [data-flow.md](../02-architecture/data-flow.md) 附录 B。 |

## 进一步阅读

- [overview.md](../00-overview/overview.md) — 产品定位
- [decisions.md](../10-decisions/decisions.md) — 架构决策
- [data-flow.md](../02-architecture/data-flow.md) — 端到端数据流
- [module-design.md](../02-architecture/module-design.md) — 模块边界
- [intelligence-methodology.md](../03-data-model/intelligence-methodology.md) — 方法学
- [evidence-model.md](../03-data-model/evidence-model.md) — 证据等级
- [source-registry.md](../04-data-sources/source-registry.md) — 数据源清单
- [backend-completion-criteria.md](./backend-completion-criteria.md) — 完成门槛

具体 CLI 子命令的语义、参数和写入策略，见对应 package README：

- `packages/research-pack/README.md` — `research run / from-workbench`
- `packages/source-workflows/README.md` — `sources policy / due / run-due`
- `packages/source-monitor/README.md` — `sources due / run-due` 内部
- `packages/evidence-maintenance/README.md` — `intelligence` 子命令族
- `packages/review-store/README.md` — `review` 子命令族
- `packages/claim-builder/README.md` — `claims` 子命令族
- `apps/cli/README.md` — 全部 CLI 入口索引
