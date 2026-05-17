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
[x] migrate 接入 schema_migrations baseline registry，后续增量迁移有正式记录入口。
[x] `pnpm test` 改为离线 unit 门禁；`pnpm test:all` 才跑完整 vitest suite。
[x] ESLint 增加 no-floating-promises / no-misused-promises，并只在 apps/cli 限制直接 import source adapter。
[x] 新增 Dependabot 配置，自动跟踪 npm 与 GitHub Actions 依赖更新。
[x] 新 pipeline 不再写入旧 extraction_review_queue；人工审核统一走 review_candidates，旧表仅作历史兼容。
```

## 下一批质量修复

```text
[ ] 将 relation-extractor 中 counterparty/component 白名单数据化。
[ ] 将 data-quality 中实体专用规则迁出主入口，改成规则注册表。
[ ] CLI 命令树拆到 commands/*.ts，main.ts 只负责组装。
[ ] 将 db schema 从 baseline migration 继续拆成真正的逐版本增量 migration。
[ ] 移除 extraction_review_queue 历史表前，先提供一次性迁移/归档脚本。
[ ] 建立 Prettier 全仓格式化基线；当前历史文件未统一格式，不能直接把 format-check 放入 CI。
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
