# Module Design — 当前模块边界与接口契约

本文描述代码库真实模块边界与目标架构。它不是早期 MVP 包清单，也不是所有实现细节的流水账；审计时应以这里的边界判断"高内聚、低耦合、事实层和派生层是否分离"。

本文反映 2026-05-28 产品定位重构后的目标架构（详见 [decisions.md](../10-decisions/decisions.md) #7–#15）。旧 `apps/api` REST 路径和 `seed-entities` 路径在 MCP / registry bootstrap 落地后逐步迁出；reference agent 已作为可移除客户端落地，web 组件仍按 Phase F 独立推进。

核心原则：

- **MCP-first**：唯一对外 surface 是 MCP server (`@supplystrata/mcp`)；REST/OpenAPI 推迟到 v1.x（#7）。
- **No agent in core**：核心代码不内置 agent loop；`@supplystrata/agent` 是独立 optional 包（#9）。
- **LLM helper 唯一入口**：核心所有 LLM 调用必须经过 `@supplystrata/llm-helpers`；任何写 `edges`/`evidence`/`claims` 的代码路径不允许 import 它（#3）。
- **Postgres = 本地 cache + audit ledger**，不是 truth store；truth 永远在官方源；可从官方源 + community-pack 重建（#2、#8）。
- **fact edge 只能来自可追溯 evidence + evidence-gated promote**；LLM、observation、lead、source health、risk metric、AI 输出都不能直接写 fact edge（#3、#13）。
- `evidence_level` 不是 `risk_score`。风险、强度、新鲜度、异常和 alert 只属于派生层。
- CLI、worker、MCP、HTML report 都是入口或输出层；业务编排下沉到 package use-case。
- package 数量已经偏多。新增能力优先放进现有 domain package 的 feature 文件，只有独立依赖、独立生命周期或独立消费价值明确时才新增 package。

## 工作区结构（当前 + 目标）

```text
supplystrata/
├── apps/
│   ├── cli/                 # 薄命令入口：参数解析、env/logger/db 装配、调用 use-case
│   ├── agent-cli/           # reference agent CLI：连接 MCP，用户自带 LLM provider，输出 markdown 报告
│   ├── mcp/                 # MCP server：tools / resources / prompts；唯一对外 surface
│   ├── worker/              # source-check 常驻 worker；复用 source-workflows
│   ├── web-demo/            # 薄 demo（Phase F）：拼接 @supplystrata/web 组件
│   └── api/                 # 【迁移中】Gate 8 REST 契约 + DTO；逐步迁出到 mcp + scbom-spec；v1.x 前可保留
├── packages/
│   ├── core/                # 纯领域类型、ID、证据等级、edge freshness 纯函数
│   ├── config/              # app 边界显式读取环境和凭据配置
│   ├── observability/       # logger port；库默认不应隐式读 env
│   ├── db/                  # 本地 cache + audit ledger（旧称 truth-store）；migration、read/write repository
│   ├── llm-helpers/         # LLM 调用唯一入口：4 用法 (disambiguate/derive_profile/suggest_target/summarize_with_cite)；可全局禁用
│   ├── source-registry/     # 权威数据源目录和 source metadata
│   ├── source-adapter-spec/ # SourceAdapter / AdapterContext 契约
│   ├── source-adapter-runtime/
│   ├── source-connectors/   # source-check connector port / target config 契约
│   ├── source-management/   # source catalog、policy/target config 校验
│   ├── source-monitor/      # source_check_targets/jobs、health、coverage、调度状态
│   ├── source-workflows/    # SEC/IR/DART/EDINET/TWSE/Apple/OSH 等公开源 use-case 编排；含 universal identity bootstrap
│   ├── sources/*            # 仍保留独立生命周期的源 adapter：SEC、Apple、OSH、Census 等
│   ├── source-plan/         # 根据组件/profile/registry 生成 source plan，不抓源不写库
│   ├── component-context/   # 组件上游 taxonomy / dependency lead；不产 fact edge；接管原 seeds/components.csv
│   ├── parsers/html|pdf|text/
│   ├── source-normalizers/  # source document normalization glue
│   ├── entity-source/       # 外部实体候选统一契约（GLEIF / OpenFIGI / Wikidata 等）
│   ├── entity-resolver/     # entity_id 解析；不写供应链事实
│   ├── entity-import/       # 受控导入 alias / identifier / pending entity
│   ├── relation-extractor/rule/
│   ├── signal-extractor/    # 官方披露 signal；review-only，不写事实图
│   ├── observation-extractor/
│   ├── observation-store/   # observation / lead 幂等写入边界
│   ├── evidence-scorer/
│   ├── evidence-trace/
│   ├── graph-store/         # GraphStore port
│   ├── graph/               # Neo4j adapter
│   ├── graph-builder/       # fact edge / evidence / change 写入与图投影 outbox
│   ├── pipeline/            # normalized document -> candidate/evidence/apply/review glue
│   ├── review-candidates/   # review candidate DTO 与纯转换
│   ├── review-store/        # review queue/disposition/change repository（review 现为 opt-in，#13）
│   ├── claim-builder/       # claim draft/fusion/conflict/lifecycle
│   ├── evidence-maintenance/# trace/intelligence/risk/unknown/calibration 派生维护 use-case
│   ├── chain-view/          # 纯 ChainView DTO
│   ├── chain-view-builder/  # DbClient -> ChainViewModel
│   ├── card-builder/        # DbClient -> Company/Component/Chain/Evidence/Unknown card DTO
│   ├── workbench-export/    # 稳定 Workbench JSON DTO；SCBOM v0.0.1 参考 exporter
│   ├── research-pack/       # 研究包、Gate 1 readiness/backlog/run ledger/report artifact
│   ├── ai-analysis/         # LLM audit / analysis plan；agent 行为已迁出到 @supplystrata/agent
│   ├── api-orchestration/   # REST/MCP 共用 route contract、DTO、operation handlers；不持有 HTTP transport
│   ├── agent/               # reference agent core：三段式 plan → fetch_via_mcp → synthesize；optional dep；核心不得依赖
│   ├── web/                 # framework-agnostic 可嵌入可视化（Phase F）：Web Components + Canvas/SVG
│   ├── data-quality/
│   ├── render/
│   ├── runtime-profile/
│   ├── object-store/
│   └── supplier-list/
├── docs/
├── tests/
│   └── fixtures/
│       └── dev-entities/    # 原 seeds/entities.csv + seeds/aliases.csv；仅 CI / 本地开发用
├── seeds/                   # 仅保留 components.csv；公司 entity 走 registry bootstrap (#11)
├── scbom-spec/              # 独立 repo：SCBOM 开放交换格式 JSON Schema + 规范文档
├── data/                    # 本地原始/缓存数据，gitignored
├── reports/                 # 本地生成报告，gitignored
└── releases/                # 【新增，目标】community-pack parquet/sqlite 发布产物
```

说明：

- `packages/sources/asml-ir`、`samsung-ir`、`skhynix-ir`、`tsmc-ir` 已不再是 workspace package；如本地残留 `dist/` 文件，只是历史构建产物。
- `ai-analysis` 当前只保留 artifact schema 校验、analysis plan 和 `ai_analysis_runs` audit；provider config / LLM provider adapter / cite-summarize helper 已迁入 `llm-helpers`；"作为 agent 跑分析"行为已迁出到 `@supplystrata/agent`。
- `seed-entities` 在 [source-registry.md](../04-data-sources/source-registry.md) 已标 `removed`；公司 entity fixture 只允许在测试、本地开发导入和 preview 路径使用。
- `reports/` 是本地输出目录，不属于代码模块；可清理、可重建。
- `releases/` 是 community-pack 发布产物目录（按 `pack-YYYY.QN.parquet` 命名），分发通过 GitHub Release / 公开对象存储。

## 依赖方向

```text
Layer 1: 纯类型 + schema
  core, scbom-spec (独立 repo)
    ↑
Layer 1.5: 共享世界知识 + 适配契约
  db/read, db/write, source-registry, source-adapter-spec, graph-store, chain-view,
  component-context, render contracts
    ↑
Layer 2: 数据获取 + 解析 + 抽取 + LLM helper
  sources/* + parsers/* + source-adapter-runtime
  source-workflows + source-management + source-monitor + source-plan
  llm-helpers (唯一 LLM 入口)
    ↑
Layer 2.5: 事实写入 + 派生维护
  pipeline + graph-builder + observation-store + review-store + claim-builder
  evidence-maintenance
    ↑
Layer 3: 编排 + 输出 + 接入面
  chain-view-builder + card-builder + workbench-export + research-pack + data-quality
  ai-analysis (provider config + audit) + api-orchestration
  apps/mcp ← 唯一对外 surface
    ↑
Layer 4: 参考客户端（独立 release cadence，optional）
  apps/cli + apps/worker + apps/agent-cli + apps/web-demo
  agent (调本机 MCP, 用户自带 LLM provider)
  web (Web Components，调本机或远程 MCP HTTP)
```

约束：

- `core` 纯净：不得读 `.env`、不得实例化 logger、不得 fetch、不得访问文件系统。
- `scbom-spec` 不依赖任何 SupplyStrata 包；它定义 schema，SupplyStrata 是它的参考实现之一（#10）。当前 v0.0.1 通过 `BCAutumn/scbom-spec#v0.0.1` pinned git dependency 消费。
- `llm-helpers` 只对外暴露 4 个具名 helper；**任何写 `edges` / `evidence` / `claims` 的代码路径不允许 import 它**（CI 通过 dep-check 拦截）。
- `sources/*` 不直接写 Postgres / Neo4j；抓取、snapshot、normalize 后交由 workflow / pipeline / monitor 编排。
- `source-plan` 只输出计划和 target suggestion；不抓源、不写库、不把弱源升级成事实。
- `source-monitor` 只维护 source target/job/health/coverage 状态；不承载 connector 业务规则。
- `source-workflows` 可以组合 adapter、connector、normalizer、observation persistence，但不得把 observation/lead 写成 fact edge。
- `source-workflows` 的 **universal identity bootstrap** 走 GLEIF / OpenFIGI / Wikidata / 各国官方目录链路；US 走 SEC、KR 走 DART、JP 走 EDINET、TW 走 TWSE、HK 走 HKEX、UK 走 Companies House、EU 各国 OAM。这是 entity identity bootstrap，不是供应链事实写入。
- `pipeline` 是 normalized document engine；它不直接依赖具体源，也不做 source policy 调度。
- `graph-builder` 只能通过 `graph-store` port 做图投影；事实写入以 Postgres cache + audit ledger 为准（不再叫 truth store；#2）。
- `workbench-export` 和 `research-pack` 是输出/研究编排层；默认只读，只有显式 prepare/refresh flag 才能调用受控派生维护 use-case。
- `api-orchestration` 是 REST/MCP 共享的 contract + handler 编排层；不得启动 server、绑定端口、读写 HTTP header，HTTP transport 留在 `apps/api`。
- `apps/mcp` 是 v0.x 唯一对外 surface；暴露 tools / resources / prompts。write tools 只使用 MCP spec 标准 annotations；真正安全边界是 server-side pending state + 单次 `confirmation_token`。它只做 app-level 装配，不承载业务规则。
- `apps/api`（旧 REST）在 v0.x 内逐步迁入 `apps/mcp`；contract test、DTO 来源、schema registry 复用。v1.x 评估是否补 REST shim。
- `apps/cli` / `apps/worker` / `apps/agent-cli` / `apps/web-demo` / `agent` / `web` 都是 Layer 4 客户端，可独立装/卸；删掉它们核心仍完整可用。
- `agent` 永远不被任何核心 / Layer 1-3 package 依赖；核心不知道它存在。
- `web` 以 Web Components 形式发布，IIFE bundle 和 npm ESM 双形态，不依赖 React / Vue / Svelte。
- `apps/*` 不写业务规则；它们只装配环境、DB、logger、命令参数、契约和输出。

## Source Domain

Source domain 分成五层，避免新增来源时改主路径：

| 层                  | Package                                         | 职责                                                                             | 禁止           |
| ------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------- | -------------- |
| 权威目录            | `source-registry`                               | 描述数据源、ToS、是否需要 key、官方性                                            | 抓取、调度     |
| Adapter 契约/运行时 | `source-adapter-spec`、`source-adapter-runtime` | fetch/snapshot/cache/rate-limit 的稳定边界                                       | 写 truth-store |
| 管理面              | `source-management`                             | target config、policy、credential requirements 校验                              | 跑 connector   |
| 调度状态            | `source-monitor`                                | source targets、jobs、health、coverage、retry/backoff                            | 解析业务语义   |
| 业务 workflow       | `source-workflows`、`sources/*`                 | SEC/Apple/DART/EDINET/TWSE/OSH/Census/WorldBank 等源的抓取、预览、监控 connector | 生成 fact edge |

新增数据源时先判断归属：

- 公司 IR / 监管目录 / 轻量 HTML/JSON official source：优先放 `source-workflows` feature，复用 runtime 和 connector catalog。
- 已有独立依赖或独立生命周期的源：保留或新增 `sources/<source>` package。
- 宏观、贸易、设施、价格、新闻、港口、制裁等弱源：默认 observation/lead/review-only，不能直接进入 fact edge。
- 任意上市公司研究不能新增 `nvidia-suppliers.ts`、`tesla-suppliers.ts` 这类公司专属 workflow。公司差异应通过 entity metadata、source target config、official source hints 和 review/backlog 表达。美国上市公司入口优先通过 SEC company ticker directory 动态 bootstrap；其它市场要补对应官方目录 bootstrap，而不是把全世界公司预塞进 seed。

## Fact Pipeline 与 Review

当前事实写入链路：

```text
NormalizedDocument
  -> extractor / scorer / resolver
  -> review candidate 或 approved candidate
  -> graph-builder 写 Postgres edge/evidence/change
  -> graph projection outbox 同步到 GraphStore
```

约束：

- fact edge 必须可追溯到 evidence chunk / cite text / source document。
- L4/L5 fact edge 是当前 Gate 1 数据深度的主目标，但不是机械追求数量。更重要的是 traceability、corroboration/disposition、unknown map 和 calibration。
- review-only signal、observation、lead、source failure、semantic change hint 只能进入 review/disposition/backlog，不得绕过 review 写事实。
- 已 deprecated / superseded / resolved / rejected 等终态对象必须有状态保护；默认 upsert 不能复活终态。

相关边界：

- `review-candidates`：候选 DTO 和纯转换，不读写库。
- `review-store`：review queue、decision、official signal disposition、change record。
- `pipeline/review-apply`：应用人工确认候选，调用对应 domain use-case。
- `claim-builder`：claim draft、confidence fusion、conflict、lifecycle；不写 fact edge。

## Intelligence / Risk / Unknown 派生层

`evidence-maintenance` 是派生维护层，允许写：

- `evidence_trace`
- `edge_strength_estimates`
- `edge_freshness`
- explicit `unknown_items`
- component `risk_views` / `risk_metrics`
- calibration run / labels
- alert candidates
- semantic change records for derived context

它不得写：

- `edges`
- `evidence_level`
- `claims` 的人工终态
- review decision

重要口径：

- relationship strength 只能从明确 evidence 文本推导；没有明确 share/dependency/capacity 时生成 explicit unknown。
- component risk baseline 是 `component_global` 派生视图，不等于当前公司 research-pack 的事实边集合。research-pack manifest 必须同时输出 `component_risk_global_edges` 和 `component_risk_visible_edges`。
- observation anomaly / financial signal / source health 是上下文，不能证明公司级供应链关系。

## Research Output

输出层分三类：

| Package                                       | 输出                                                                                  | 责任                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------- |
| `chain-view`                                  | 纯 ChainView DTO                                                                      | 不查库                                 |
| `chain-view-builder`、`card-builder`          | card / chain DTO                                                                      | 从 `DbClient` 组装稳定 DTO             |
| `workbench-export`                            | Workbench JSON + SCBOM v0.0.1 document exporter                                       | 稳定 machine-readable contract         |
| `research-pack`                               | 研究目录、Gate readiness/backlog/run ledger、read model / walkthrough                 | 研究编排和审计账本                     |
| `ai-analysis`                                 | provider config / `ai_analysis_runs` audit；agent 行为迁出后只留 audit + config       | LLM 调用审计；行为收敛到 `llm-helpers` |
| `api-orchestration`                           | REST/MCP 共用 API contract、DTO envelope、operation handler 装配                      | 不含 HTTP server / response 写入       |
| `apps/mcp`                                    | MCP tools / resources / prompts 契约、薄装配层                                        | 唯一对外 surface；版本化 MCP 契约      |
| `apps/api`（迁移中）                          | 旧 REST contract；逐步迁入 `apps/mcp`，v1.x 再评估 REST shim                          | 过渡期保留                             |
| `agent` / `apps/agent-cli`                    | 参考 agent core + CLI；用户带 LLM provider，调本机 MCP，输出 citation-backed markdown | optional；不被核心依赖                 |
| `web`                                         | Web Components：`<supplystrata-supply-chain-graph>` 等；canvas/SVG 渲染               | 可嵌入；调本机或远程 MCP HTTP          |
| `render` / `scripts/render-research-html.mjs` | Markdown / HTML / JSON 可读输出                                                       | 不查库、不写库                         |

`research-pack` 是当前 Gate 1 主工作台。它应回答：

- 当前公司/组件有哪些 L4/L5 fact edge？
- 哪些核心节点、上游组件、source target 还缺？
- 哪些 source target 已 synced / due / degraded / missing credentials？
- 哪些 edge 需要二源 corroboration 或 explicit disposition？
- 哪些 observation 值得标注为 useful/background/not useful？
- 递归 frontier company research 下一批该跑谁，为什么？
- 下游 MCP consumer 能先读哪些只读 summary 和 constraint context？
- 审计者不读全量 JSON 时，能否看到已知事实、unknown、受限证据、下一步动作和不能说的结论？

### MCP 接入面（v0.x 唯一对外 surface）

`apps/mcp` 暴露三类 surface：

| 类别        | 例子                                                                                                                       | 写入约束                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Resources   | `supplystrata://entity/{id}`、`evidence/edge/{id}`、`unknowns/company/{id}`、`changes/entity/{id}`、`source-health`        | 只读；返回当前 cache + audit 状态                                                                  |
| Read Tools  | `resolve_company`、`poll_research_run`、`read_evidence_for_edge`、`traverse_chain`、`list_unknowns`、`list_source_targets` | 只读；可触发 LLM helper 但不入库                                                                   |
| Write Tools | `start_research_session`、`run_source_check`、`confirm_research_session`、`review.approve`、`review.reject`                | 标准 MCP risk annotations + server-side confirmation gate；任何事实写入仍走 evidence-gated promote |

旧 `apps/api` 的 REST endpoint（`GET /companies/:id/supply-chain-report`、`POST /companies/:id/research-runs`、`GET /research-runs/:id` 等）逐步迁入对应 MCP tool / resource；DTO 复用，不重新设计。完整 MCP 契约见 `apps/mcp/README.md`。

外部 agent 通过 MCP 消费 SupplyStrata 时的允许 / 禁止边界详见 [intelligence-methodology.md](../03-data-model/intelligence-methodology.md) 的 "MCP Handoff" 一节。

它不应该回答：

- 投资建议。
- 未经 evidence 支撑的完整产业链推理。
- 由 observation/新闻/价格直接推导的公司供应链事实。
- policy / sanctions / export-control source 只能进入 constraint context、observation 或 alert candidate，不写 fact edge。

## Package 保留与合并策略

必须保留独立：

- `graph-store` / `graph`：port 与 Neo4j adapter 分离。
- `chain-view` / `chain-view-builder`：纯 DTO 与 DB builder 分离。
- `workbench-export` / `research-pack`：稳定 JSON 契约与研究目录编排分离。
- `source-adapter-spec` / `source-adapter-runtime`：source port 与 runtime helper 分离。
- `review-candidates` / `review-store`：纯候选契约与持久化状态分离。

可继续观察收敛：

- `source-connectors`、`source-management`、`source-monitor`、`source-workflows` 都属于 source domain，但当前分别承担 port、配置校验、调度状态、业务 workflow。短期保留边界；若要合并，必须先证明调用点、状态生命周期和依赖方向不会变成 source 上帝包。
- `observation-extractor` / `observation-store` 暂不合并：一个抽取草稿，一个持久化写入。
- `evidence-maintenance` 暂不并入 `db`：它是方法学和派生维护 use-case，不是 repository。

禁止：

- 为每个研究公司新增一个 workflow 文件。
- 为减少 package 数量机械搬文件。
- 把不好分类的代码丢进 `shared`、`utils`、`helpers`。
- 让 CLI 或 worker 复制 source-check / review / risk / claim 业务规则。

## 类型与 DTO 边界

三类类型必须分清：

- Domain Contract：业务概念，例如 edge、evidence、claim、observation、source plan、review candidate。
- Persistence Row：SQL 查询结果，只能留在 repository 或 package 内部 `db-rows`。
- Output DTO：Workbench、card、research-pack、render 输出契约。

规则：

- 不把 DB Row 直接作为 Workbench/card/research-pack DTO 暴露。
- 不用 `SELECT *` 扩散对外 DTO 形状。
- `db` root 入口不作为全量 barrel；业务代码选择 `@supplystrata/db/read`、`@supplystrata/db/write`、`@supplystrata/db/admin`。
- 新增 DTO 字段必须更新对应 schema/manifest/README 或 module README。

## 运行形态

当前 + 目标支持：

- **Local-first 默认**：每个用户本地实例，本地 Postgres（cache + audit），可选 Neo4j projection。
- **MCP server 默认启动**：`apps/mcp` 作为唯一对外 surface；HTTP/SSE transport 让浏览器和远程 agent 直接连接。
- **Community-pack warm start**（目标）：启动时可选 `--pack=supplystrata-pack-YYYY.QN.parquet`；pack 是 read-only baseline，本地写入覆盖 pack 字段但不污染 pack（#14）。
- **无 Docker 静态 research snapshot / HTML report 路径**（保留，用于 CI 和无数据库验证）。
- `apps/worker` 常驻 source-check loop（opt-in，#8 不假设 7x24 部署）。
- 任何宿主 app 可通过：(a) 嵌入 MCP server (b) 直接调 use-case package (c) 嵌入 `@supplystrata/web` 组件，三种方式按需选择。

定位（与 [overview.md](../00-overview/overview.md) 一致）：

> Local-first, evidence-first, MCP-native supply-chain intelligence backbone for AI agents.

不再把架构目标写成"已完成全球实时监控平台"或"开源 Bloomberg"（详见 [competitive-landscape.md](../00-overview/competitive-landscape.md) "不学的对照系"）。

## 测试与审计边界

至少保持：

- `pnpm type-check`
- `pnpm lint`
- `pnpm test:unit`
- `pnpm dep-check`
- `pnpm format:check`
- 修改导出/构建/包边界时跑 `pnpm build`

审计重点：

- **Fact 写入不变式**（[intelligence-methodology.md](../03-data-model/intelligence-methodology.md) 6 条）是否被 CI 拦截。
- `llm-helpers` import 边界：任何写 `edges`/`evidence`/`claims` 的 package 不允许 import `@supplystrata/llm-helpers`（dep-check）。
- `agent` package 不被任何核心 / Layer 1-3 package 依赖（dep-check）。
- MCP write tools 是否全部显式 `readOnlyHint: false`；事实写入类 tool 是否标 `destructiveHint: true`，且不带 token 只能返回 `requires_confirmation`（contract test）。
- source target / source job 是否有 lease、retry、policy 状态保护。
- review/disposition 是否不会自动生成 fact edge。
- evidence-gated auto-promote 是否严格满足 `extractor=rule AND source=官方 AND L≥4` 或双源 corroboration 条件（unit + integration）。
- research-pack 是否诚实区分事实、observation、unknown、global derived context。
- L4/L5 edge 是否有 evidence trace。
- 递归 research loop 是否产出可审计 backlog/commands，而不是把缺口伪装成结论。
- community-pack 加载是否校验 sha256；本地写入是否能正确覆盖而不污染 pack 内容。
