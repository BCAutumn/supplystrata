# Module Design — 当前模块边界与接口契约

本文描述当前代码库真实模块边界。它不是早期 MVP 包清单，也不是所有实现细节的流水账；审计时应以这里的边界判断“高内聚、低耦合、事实层和派生层是否分离”。

核心原则：

- Postgres / `@supplystrata/db` 是 truth store；图、报告、risk/intelligence 都是可重建视图或派生层。
- fact edge 只能来自可追溯 evidence 和受控 review/apply 流程；LLM、observation、lead、source health、risk metric 都不能直接写 fact edge。
- `evidence_level` 不是 `risk_score`。风险、强度、新鲜度、异常和 alert 只属于派生层。
- CLI、worker、HTML report 都是入口或输出层；业务编排应下沉到 package use-case。
- package 数量已经偏多。新增能力优先放进现有 domain package 的 feature 文件，只有独立依赖、独立生命周期或独立消费价值明确时才新增 package。

## 当前工作区结构

```text
supplystrata/
├── apps/
│   ├── cli/                 # 薄命令入口：参数解析、env/logger/db 装配、调用 use-case
│   ├── worker/              # source-check 常驻 worker；复用 source-workflows
│   └── research-preview/    # 本地 Workbench JSON 预览，不承载业务规则
├── packages/
│   ├── core/                # 纯领域类型、ID、证据等级、edge freshness 纯函数
│   ├── config/              # app 边界显式读取环境和凭据配置
│   ├── observability/       # logger port；库默认不应隐式读 env
│   ├── db/                  # Postgres truth-store adapter、migration、read/write repository
│   ├── source-registry/     # 权威数据源目录和 source metadata
│   ├── source-adapter-spec/ # SourceAdapter / AdapterContext 契约
│   ├── source-adapter-runtime/
│   ├── source-connectors/   # source-check connector port / target config 契约
│   ├── source-management/   # source catalog、policy/target config 校验
│   ├── source-monitor/      # source_check_targets/jobs、health、coverage、调度状态
│   ├── source-workflows/    # SEC/IR/DART/EDINET/TWSE/Apple/OSH 等公开源 use-case 编排
│   ├── sources/*            # 仍保留独立生命周期的源 adapter：SEC、Apple、OSH、Census 等
│   ├── source-plan/         # 根据组件/profile/registry 生成 source plan，不抓源不写库
│   ├── component-context/   # 组件上游 taxonomy / dependency lead；不产 fact edge
│   ├── parsers/html|pdf|text/
│   ├── source-normalizers/  # source document normalization glue
│   ├── entity-source/       # 外部实体候选统一契约
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
│   ├── review-store/        # review queue/disposition/change repository
│   ├── claim-builder/       # claim draft/fusion/conflict/lifecycle
│   ├── evidence-maintenance/# trace/intelligence/risk/unknown/calibration 派生维护 use-case
│   ├── chain-view/          # 纯 ChainView DTO
│   ├── chain-view-builder/  # DbClient -> ChainViewModel
│   ├── card-builder/        # DbClient -> Company/Component/Chain/Evidence/Unknown card DTO
│   ├── workbench-export/    # 稳定 Workbench JSON DTO
│   ├── research-pack/       # 研究包、Gate 1 readiness/backlog/run ledger/report artifact
│   ├── data-quality/
│   ├── render/
│   ├── runtime-profile/
│   ├── object-store/
│   └── supplier-list/
├── docs/
├── seeds/
├── data/                    # 本地原始/缓存数据，gitignored
└── reports/                 # 本地生成报告，gitignored
```

说明：

- `packages/sources/asml-ir`、`samsung-ir`、`skhynix-ir`、`tsmc-ir` 已不再是 workspace package；如本地残留 `dist/` 文件，只是历史构建产物，不代表当前模块边界。
- 当前没有 `llm-bridge` package，也没有 `parsers/xbrl` 或 `sidecars/xbrl-py`。AI / XBRL ZIP / PDF 正文解析属于后续能力，不能在审计中当成已实现边界。
- `reports/` 是本地输出目录，不属于代码模块；可清理、可重建。

## 依赖方向

```text
core
  ↑
db/read, db/write, source-registry, source-adapter-spec, graph-store, chain-view, render contracts
  ↑
sources/* + parsers/* + source-adapter-runtime
  ↑
source-workflows + source-management + source-monitor + source-plan
  ↑
pipeline + graph-builder + observation-store + review-store + claim-builder + evidence-maintenance
  ↑
chain-view-builder + card-builder + workbench-export + research-pack + data-quality
  ↑
apps/cli + apps/worker + apps/research-preview
```

约束：

- `core` 纯净：不得读 `.env`、不得实例化 logger、不得 fetch、不得访问文件系统。
- `sources/*` 不直接写 Postgres / Neo4j；抓取、snapshot、normalize 后交由 workflow / pipeline / monitor 编排。
- `source-plan` 只输出计划和 target suggestion；不抓源、不写库、不把弱源升级成事实。
- `source-monitor` 只维护 source target/job/health/coverage 状态；不承载 connector 业务规则。
- `source-workflows` 可以组合 adapter、connector、normalizer、observation persistence，但不得把 observation/lead 写成 fact edge。
- `pipeline` 是 normalized document engine；它不直接依赖具体源，也不做 source policy 调度。
- `graph-builder` 只能通过 `graph-store` port 做图投影；truth-store 写入以 Postgres 为准。
- `workbench-export` 和 `research-pack` 是输出/研究编排层；默认只读，只有显式 prepare/refresh flag 才能调用受控派生维护 use-case。
- `apps/*` 不写业务规则；它们只装配环境、DB、logger、命令参数和输出。

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
- 任意上市公司研究不能新增 `nvidia-suppliers.ts`、`tesla-suppliers.ts` 这类公司专属 workflow。公司差异应通过 entity metadata、source target config、official source hints 和 review/backlog 表达。

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

| Package                                       | 输出                                                                              | 责任                           |
| --------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------ |
| `chain-view`                                  | 纯 ChainView DTO                                                                  | 不查库                         |
| `chain-view-builder`、`card-builder`          | card / chain DTO                                                                  | 从 `DbClient` 组装稳定 DTO     |
| `workbench-export`                            | Workbench JSON                                                                    | 稳定 machine-readable contract |
| `research-pack`                               | 研究目录、Gate readiness/backlog/run ledger、Gate 8-lite read model / walkthrough | 研究编排和审计账本             |
| `render` / `scripts/render-research-html.mjs` | Markdown/HTML/JSON 可读输出                                                       | 不查库、不写库                 |

`research-pack` 是当前 Gate 1 主工作台。它应回答：

- 当前公司/组件有哪些 L4/L5 fact edge？
- 哪些核心节点、上游组件、source target 还缺？
- 哪些 source target 已 synced / due / degraded / missing credentials？
- 哪些 edge 需要二源 corroboration 或 explicit disposition？
- 哪些 observation 值得标注为 useful/background/not useful？
- 递归 frontier company research 下一批该跑谁，为什么？
- 下游 API / host app 能先消费哪些只读 summary 和 constraint context？
- 审计者不读全量 JSON 时，能否看到已知事实、unknown、受限证据、下一步动作和不能说的结论？

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

当前支持：

- 本地 Postgres truth store。
- 可选 Neo4j graph projection。
- 无 Docker 静态 research snapshot / HTML report 路径。
- `apps/worker` 常驻 source-check loop。
- 未来宿主 app 可通过 CLI/use-case/API 包装相同后端能力。

不要在现阶段把架构目标写成“已完成全球实时监控平台”。当前定位更准确：

> evidence-first supply-chain intelligence backend alpha，正在通过 Gate 1 把公开官方披露、source monitoring、递归 research loop、unknown/disposition/calibration 做扎实。

## 测试与审计边界

至少保持：

- `pnpm type-check`
- `pnpm lint`
- `pnpm test:unit`
- `pnpm dep-check`
- `pnpm format:check`
- 修改导出/构建/包边界时跑 `pnpm build`

审计重点：

- source target / source job 是否有 lease、retry、policy 状态保护。
- review/disposition 是否不会自动生成 fact edge。
- research-pack 是否诚实区分事实、observation、unknown、global derived context。
- L4/L5 edge 是否有 evidence trace。
- 递归 research loop 是否产出可审计 backlog/commands，而不是把缺口伪装成结论。
