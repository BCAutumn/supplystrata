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
```

## 下一批质量修复

```text
[ ] 将 pipeline 中 IR signal 抽取搬到 relation-extractor 或 signal-extractor。
[ ] 拆分 db/src/index.ts，按 migration / seed / documents / edges / evidence / pending 分层。
[ ] 将 review apply 拆成状态机阶段，明确 approved / blocked / applied 转移。
[ ] 将 relation-extractor 中 counterparty/component 白名单数据化。
[ ] 将 data-quality 中实体专用规则迁出主入口，改成规则注册表。
[ ] CLI 命令树拆到 commands/*.ts，main.ts 只负责组装。
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
