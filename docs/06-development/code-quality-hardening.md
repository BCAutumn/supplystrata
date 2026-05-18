# Code Quality Hardening — 质量修复阶段

本文记录进入中期目标前的代码质量修复原则与当前落地状态。目标是让 SupplyStrata 的核心代码能长期承接更多公司、更多来源、更多关系类型，而不是靠复制粘贴扩展。

## 本阶段原则

```text
1. core 只放领域类型与纯函数。
2. 配置读取必须显式发生在执行层或基础设施层。
3. 日志通过 observability 包注入或延迟获取。
4. source adapter 的限速、抓取、缓存、对象存储落盘走统一工具。
5. 查询函数保持只读；写入动作必须通过显式 sync/apply/record 命令发生。
6. 新功能开始前先清理会影响扩展性的抽象债。
```

## 已落地

```text
[x] 拆出 @supplystrata/config，集中 env schema、.env 显式加载和 required env 校验。
[x] 拆出 @supplystrata/observability，core 不再初始化 pino logger。
[x] @supplystrata/core 去除顶层 .env 读取、logger 初始化和 HTTP 抓取工具，恢复为纯领域包。
[x] fetchBytesWithTimeout 移入 @supplystrata/source-adapter-runtime，source 抓取超时和错误口径统一；source-adapter-spec 只保留接口契约和纯校验。
[x] 新增 defineHtmlSnapshotAdapter，TSMC / Samsung / SK hynix / ASML IR adapter 迁移到声明式工厂。
[x] SEC EDGAR adapter 接入统一 fetchBytesWithTimeout，不再裸 fetch。
[x] source monitor 的 health/due 查询函数保持只读；registry 写入改为显式 sync。
[x] object-store exists 只吞 ENOENT，其它文件系统错误继续抛出。
[x] review candidate kind 改为由实际联合类型派生，避免 kind 表和类型守卫分叉。
[x] db/src/index.ts 拆成 client / seed / documents / pending / query，公开入口只做 re-export。
[x] 新增 @supplystrata/signal-extractor，pipeline 不再直接承载 IR signal 抽取业务规则。
[x] review apply 拆成实体导入、supplier-list 实体解析、设施准备、证据评分、写图、状态标记等显式阶段。
[x] relation-extractor 的 counterparty / component 模式迁入 patterns.ts，主抽取器只保留流程。
[x] data-quality 改为规则注册表，实体专用规则不再散落在 runDataQualityChecks 主流程中。
[x] migrate 使用 schema_migrations 记录版本；DDL 拆入 migration-sql/*.ts，不再维护单个 baseline 大 SQL。
[x] `pnpm test` 改为离线 unit 门禁；`pnpm test:all` 才跑完整 vitest suite。
[x] ESLint 增加 no-floating-promises / no-misused-promises，并只在 apps/cli 限制直接 import source adapter。
[x] 新增 Dependabot 配置，自动跟踪 npm 与 GitHub Actions 依赖更新。
[x] 移除旧 extraction_review_queue；人工审核统一走 review_candidates。
[x] CLI 命令树拆到 commands/*.ts，main.ts 只负责组装。
[x] review apply 移除旧单边 apply_result 返回，接口统一为结构化 apply_results。
[x] relation-extractor 的规则数据下沉到 patterns/sec-official-supply-chain.json，pattern-catalog.ts 只负责读取和严格校验。
[x] 普通 manual evidence 降级为 lead_only / cap 2，避免人工录入绕过 source authority。
[x] 建立 Prettier 全仓格式化基线，并把 format:check 纳入 CI / release-check。
[x] 新增 build-packages.mjs，workspace packages/apps 可输出 dist JS 与 d.ts，package exports 指向 dist，development condition 指向 src。
[x] Vitest alias 改为从 `tsconfig.base.json` 自动读取，消除测试别名与 TypeScript paths 双维护。
[x] pending entity 写入改为单语句 `INSERT ... ON CONFLICT ... RETURNING`，避免先查后写的竞态；context 采用 JSONB 合并，避免后写覆盖整份上下文。
[x] review queue 领取改为 `UPDATE ... FOR UPDATE SKIP LOCKED ... RETURNING`，领取即进入 `in_review` 状态，避免多个 worker/CLI 拿到同一条候选。
[x] source check、Apple Supplier review enqueue、Census/OSH observation 写入、pipeline document observation 写入全部收束进 `DatabaseStore.transaction()`。
[x] CLI claim build 走事务包装器，claim、claim_evidence、change_records 不再分散提交。
[x] GraphStore 投影失败写入 `graph_projection_jobs` durable outbox，并提供 `graph retry-projections` 做局部重试；Neo4j/其它图后端失败不再只停留在日志里。
[x] `workbench-export` 输出改为稳定 DTO/serializer，不再把 `ClaimRow` / `EvidenceDetailRow` / `SourceHealthRow` 这类数据库 Row 作为公共 JSON 契约直接透传。
[x] source adapter 默认 rate limiter 改为 adapter 级实例；需要跨 adapter 共享限速时由调用方显式注入，避免隐式全局单例让测试或并发任务互相污染。
[x] CompanyCard 开始拆分加载与渲染：CLI 显式 `loadCompanyCard()` 后调用纯 `renderCompanyCard()`，为后续把 card loader 迁出 render 包铺路。
[x] ComponentCard 同步拆分为 `loadComponentCard()` + 纯 `renderComponentCard()`，组件研究卡片不再只能通过胖控制器入口消费。
[x] Chain/Evidence/Unknown 入口同步拆分为 loader + 纯 formatter；CLI 不再调用胖 `renderX(client, ...)` 路径。
[x] graph-builder 的 GraphStore rebuild/check/sync/retry 逻辑抽到 `projection.ts`；`index.ts` 从 578 行降到约 420 行，主类更聚焦 Postgres truth 写入与编排。
[x] graph-builder 的 Postgres edge/evidence/change 写入抽到 `sql-store.ts`；`index.ts` 只保留实体解析、事务边界和 GraphStore 投影编排。
[x] 自动 pipeline 的 citation-to-chunk 逻辑抽到 `citation-location.ts`；候选证据必须精确映射到唯一持久化 chunk，避免在主流程里用松散字符串猜测 chunk。
[x] research-preview 加入加载 token + AbortController；URL / 文件加载交错时，旧请求不能覆盖新工作台状态。
[x] `CandidateRelation` 增加 `source_location`；SEC 规则抽取器输出 chunk locator 与 cite offset，evidence trace 优先使用 extractor 提供的偏移并校验原文。
[x] Supplier List review/apply 接入统一 citation locator；半自动审核边写入 evidence 前必须定位到唯一 chunk，避免 reviewed evidence 只有 doc_id 没有 chunk_id。
[x] claim / observation upsert 改为 `RETURNING (xmax = 0) AS inserted`，删除先查后写的 inserted 推断，避免并发下两个调用者同时误判为新增。
[x] `saveNormalizedDocument()` 内部包裹事务，并提供 `saveNormalizedDocumentTx()` 供已有事务复用；document 与 chunks 不再可能半写入。
[x] graph projection job 增加 `in_progress` 状态和 `claimDueGraphProjectionJobs()`；worker 领取任务使用 `FOR UPDATE SKIP LOCKED`，避免多进程重复拉同一个投影任务。
[x] SEC 表单类型集中到 core 的 `SEC_FORM_TYPES / parseSecFormType / secFormTypeOrDefault`；CLI、SEC adapter、pipeline 不再各自维护一份校验逻辑。
[x] GraphStore 的 `validity` 收紧为 core `EdgeValidity`，图后端 adapter 不能再接收任意字符串状态。
[x] source-plan 引用的 `micron-ir` 补入 source registry，并增加测试覆盖，避免计划层引用未登记来源后静默过滤。
[x] source-plan 对未注册 source id 改为 fail-fast，不再把拼错或漏登记的数据源静默丢弃。
[x] research-preview 的本地文件加载接入同一个 AbortController 令牌，URL / 文件加载都不会被旧请求回写污染状态。
[x] `@supplystrata/chain-view` 降级为纯视图模型包；DB/组件上下文组装迁入 `@supplystrata/chain-view-builder`，前端和 JSON 消费方不再被拖入 `pg` / `db` 依赖链。
[x] dependency-cruiser 增加 `chain-view-model-must-stay-pure`，CI 会阻止纯视图模型包重新依赖 DB、图后端、组件上下文或 `pg`。
[x] 新增 `@supplystrata/card-builder`，集中 CompanyCard / ComponentCard / ChainCard / EvidenceCard / UnknownMap 的数据库加载和 DTO 组装。
[x] `packages/render` 降级为纯 formatter：移除 `DbClient`、`db`、`pg`、chain-view-builder 依赖，只接收稳定 DTO 后输出 Markdown / JSON。
[x] CLI、E2E 与 card 命令改为显式 `card-builder load -> render formatter`，数据库读取与展示格式化不再混在一个包里。
[x] dependency-cruiser 增加 `render-must-stay-pure`，CI 会阻止 render 重新依赖 DB、Graph、card-builder 或 `pg`。
[x] 增加 `DbTxClient` 事务客户端类型；`recordDocumentObservation()` / `recordSourceFailure()` / `recordSourceDegraded()` 这类多表监控写入必须在 `DatabaseStore.transaction()` 内调用。
[x] source monitor 对 source item observation 加事务级 advisory lock，避免并发检查同一个 item 时重复生成 `DOCUMENT_NEW`。
[x] HTML snapshot adapter 在网络失败后读取缓存时会写入 `source_fetch_status=fallback` / `source_fetch_error`；source check runner 不再把缓存回退当成功文档观察，而是记录 `SOURCE_DEGRADED`。
[x] Supplier List review/apply 的两条边、facility entity、pending entity resolution 和 review 状态改为同一个 outer transaction；第二条边失败时不会留下第一条边的半写入。
[x] `DeterministicEvidenceScorer` 支持 reviewed scoring option；review apply 不再在调用方强行覆写 `needs_review=false`。
[x] `sources check` 改为通过 `@supplystrata/source-connectors` registry 分发，CLI 不再硬编码只支持 `sec-edgar`；新增源只需要注册 connector。
[x] 通用错误消息转换收口到 `@supplystrata/observability/messageFromUnknown`，graph-builder 与 pipeline 不再各自复制错误字符串处理逻辑。
[x] 拆出 `@supplystrata/source-adapter-runtime`；`source-adapter-spec` 不再依赖 config / object-store / 网络抓取实现，并用 dependency-cruiser 固化纯契约边界。
[x] Observation type DB CHECK 通过 migration 0012 从 core `OBSERVATION_TYPES` 生成，并增加 contract test，避免 OSH / observation-store 写入类型和数据库约束漂移。
[x] GraphBuilder 在 `applySqlInTransaction()` 内把同一 `DbTxClient` 传给 resolver，实体解析查询与 edge/evidence 写入共享事务快照。
[x] `review apply-approved` 改为先 `claimApprovedReviewCandidates()`：`UPDATE ... FOR UPDATE SKIP LOCKED ... RETURNING` 领取 approved 候选，再处理自己领到的项，避免多 worker 重复 apply。
[x] ReviewCandidate 运行时校验从只看 `kind` 升级为逐 kind 校验 payload / evidence / confidence / relation 字段；DB JSON 读出后不再只凭顶层 kind 被信任。
[x] source monitor 的 `jitter_minutes` 接入 deterministic jitter；`next_check_at` 由纯函数 `calculateNextCheckAt()` 计算并覆盖测试，避免同 cadence 数据源集中触发。
[x] research-preview 的 Workbench JSON parser 升级为深层结构校验；坏 report 会在加载入口报出具体字段路径，不再拖到 canvas/panel 渲染阶段才失败。
[x] `.gitignore` 的 `data/` / `reports/` 改为根目录限定，避免误忽略 `apps/research-preview/src/data` 这类源码目录。
[x] `@supplystrata/source-monitor` 从单个 700+ 行 index 拆出 `types.ts` / `policy-config.ts` / `scheduling.ts`；index 继续只承载数据库编排入口，后续拆 health/event store 更容易。
[x] `@supplystrata/source-registry` 从单个大 index 拆出 `types.ts` / `registry-data.ts`，并移除 `sec-edgar-fixture` 在生产 registry 中的短路映射；离线 SEC fixture 使用真实 `sec-edgar` source id + fixture URL。
[x] 新增 `@supplystrata/source-workflows`，把 SEC/Apple/IR/OSH/Census/entity source 这类具体免费源编排从 `pipeline` 中移出；`pipeline` 回到 normalized document engine，只处理已标准化文档到 evidence/edge/observation 的内核链路。
[x] dependency-cruiser 增加 `pipeline-must-not-depend-on-concrete-source-adapters`，CI 会阻止 `pipeline` 重新 import `packages/sources/*`。
[x] `@supplystrata/source-adapter-runtime` 不再直接读取 `loadEnv()` 或创建 `FsObjectStore`；HTML snapshot 持久化改为通过 `AdapterContext.snapshotStore` / definition 显式注入，宿主 App 可替换为自己的存储后端。
[x] SEC / Apple PDF / registry JSON / Census / OSH 等非 HTML adapter 也改为通过 `AdapterContext.snapshotStore` 写原始响应；所有 source adapter 不再直接依赖 `@supplystrata/object-store`。
```

## 下一批质量修复

```text
[ ] 建立正式 npm publish 流程；当前已有 dist 构建与 package exports，但尚未做版本发布自动化。
[ ] LLM / 语义变化 review 候选仍以 `cite_text` 为主；后续应让这些入口也尽量补齐 `source_location`，做到所有自动或半自动 evidence 都有强定位。
[ ] `apps/cli/src/cli-utils.ts` 仍承担较多 DB 生命周期、参数解析和输出工具职责；后续可以继续拆成 runtime / parse / io 三个小模块。
[ ] source adapter 仍各自组装 `storage_key` 与 `RawDocument` 元数据；后续可继续抽成统一 raw-document builder，进一步减少重复。
[ ] `source-workflows` 当前是集中式 feature workflow 包；后续如果 DART / EDINET / AIS / procurement 等源继续增多，可以拆成多个 feature workflow 包并由 registry 聚合。
[ ] `claim` / `observation` upsert 仍偏“全量覆盖”；后续应把 create、patch、state transition 分开，避免状态字段被普通 upsert 意外覆盖。
[ ] `WorkbenchModel` 运行时校验已覆盖当前静态 preview 需要的核心结构；后续如果对外暴露 API，应把同一套 schema 上移到 `workbench-export` 或独立 contract 包，避免前后端各维护一份。
```

## 验收门槛

每轮质量修复至少跑：

```bash
pnpm type-check
pnpm test:unit
pnpm lint
pnpm dep-check
```

涉及 Postgres / Neo4j 行为时，再跑：

```bash
pnpm test:integration
pnpm test:e2e
```
