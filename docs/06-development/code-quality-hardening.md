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
[x] fetchBytesWithTimeout 移入 @supplystrata/source-adapter-spec，source 抓取超时和错误口径统一。
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
```

## 下一批质量修复

```text
[ ] 建立正式 npm publish 流程；当前已有 dist 构建与 package exports，但尚未做版本发布自动化。
[ ] `packages/render` 仍保留兼容性 `renderX(client, ...)` 包装函数；下一轮可把 loader 整体迁到独立 card/use-case 包，并让 render 包只保留 formatter。
[ ] LLM / 语义变化 review 候选仍以 `cite_text` 为主；后续应让这些入口也尽量补齐 `source_location`，做到所有自动或半自动 evidence 都有强定位。
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
