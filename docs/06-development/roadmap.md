# Roadmap — 阶段化开发计划

> **不承诺自然周**。原始的 Week 1-6 设计在实际工程中**几乎肯定会延期**，尤其是关系抽取和实体消歧。本文用 Phase 表示阶段，不写日期。每个 Phase 都有明确的入场 / 出场标准。

## Phase 0 — Pre-flight（动工前）

### 入场条件

仓库目前的状态。

### 任务

- [ ] 文档审稿：所有 ★ 标记文档定稿
- [x] ADR 决议：[ADR-001](../10-decisions/ADR-001-language-choice.md), [ADR-002](../10-decisions/ADR-002-graph-db.md), [ADR-003](../10-decisions/ADR-003-llm-strategy.md), [ADR-004](../10-decisions/ADR-004-monorepo-structure.md) 全部状态 = `accepted`
- [x] `seeds/entities.csv` 锁定 25 个核心研究节点 + 至少 30 个关联/桥接实体
- [x] `seeds/aliases.csv` 锁定第一批别名（高频实体每个 ≥ 3 个别名；主表名由 seed 导入自动补 alias）
- [x] `seeds/components.csv` 锁定第一批组件
- [ ] 法律 / ToS 评估完成（[legal-tos.md](../09-risks-compliance/legal-tos.md) 所有 P0 数据源 status=`approved`）
- [ ] 个人 / 团队成员对"non-goals"达成共识

### 出场条件

文档定稿 + 数据 seed 入仓 + ADR 审议通过。**任何一项未完成，不进 Phase 1**。

### 不做

代码、不开始任何 ingestion。

---

## Phase 1 — Skeleton（代码骨架 + 数据库）

### 入场条件

Phase 0 全部出场条件满足。

### 任务

- [x] pnpm workspace + `tsconfig.base.json` + ESLint + prettier + dependency-cruiser 全套
- [x] `docker-compose.yml`：postgres + neo4j (+ minio 可选)
- [x] `packages/core` 中的 IDs / zod schema / RelationType / EntityKind / 等基础类型
- [x] `packages/db` schema 与 migrations（[schema.md](../03-data-model/schema.md) MVP 核心表）
- [x] `packages/graph` Neo4j 客户端 + 索引 / 约束
- [x] `packages/object-store` 本地 FS 实现
- [x] `apps/cli` 骨架（commander + admin 子命令）
- [x] `supplystrata admin seed` 把 seeds 加载到 Postgres
- [x] `supplystrata graph rebuild` 能从 Postgres 当前态重建 Neo4j

### 出场条件

- [x] `pnpm install && docker compose up -d && pnpm db:migrate && pnpm cli admin seed && pnpm cli graph rebuild` 在本地跑通
- [x] CI 等价命令（lint + type-check + unit test + dependency-cruiser）全绿
- [x] `seeds` 数据全部进入 Postgres
- [x] Neo4j 节点数 == entity_master.active 数量

### 风险与缓解

| 风险                        | 缓解                                                           |
| --------------------------- | -------------------------------------------------------------- |
| schema 设计漏洞             | 在 PR 时跑 forward + backward + forward 迁移；至少 2 人 review |
| dependency-cruiser 限制踩坑 | 写一份 README 列出已知合法依赖，CI 报错时按图索骥              |
| pnpm workspace 包间引用问题 | 在 ADR-004 中固定方案；不轻易改                                |

---

## Phase 2 — MVP Core（SEC + 4 家亚洲 IR + Apple Suppliers + Entity Resolver）

### 入场条件

Phase 1 出场。

### 任务

- [x] `packages/source-adapter-spec`：接口契约
- [x] `packages/sources/sec-edgar`：plan + fetch + normalize（HTML）
- [x] `packages/parsers/html` + `packages/parsers/text`
- [ ] `packages/sources/opencorporates` + `packages/sources/companies-house`：只拉 seeds 覆盖范围内的实体解析数据
- [x] `packages/entity-resolver`：strict alias + fuzzy 候选不自动合并 + Samsung/Foxconn/TSMC 上下文消歧 + CIK/ticker identifier match
- [ ] Golden set ≥ 200 条 + CI 跑通 + 准确率 ≥ 99%
- [x] `packages/relation-extractor/rule`：10K foundry / memory / contract-manufacturer 规则
- [x] `packages/evidence-scorer`：MVP 规则
- [x] `packages/graph-builder`：apply / rebuild
- [x] `packages/graph-builder`：graph check（Postgres truth vs Neo4j 物化视图计数）
- [x] `packages/sources/apple-suppliers`：半自动候选 CSV 预览流程（review/apply 入图仍待接）
- [x] `packages/sources/company-ir/tsmc-ir`（已接入无库预览链路；完整 review/apply 待主链路统一接入）
- [x] `packages/sources/company-ir/{samsung-ir,skhynix-ir,asml-ir}`（已接入无库预览链路；Samsung 官网当前网络可用性不稳定，已做可解释降级）
- [x] `packages/render`：CompanyCard / EvidenceCard / UnknownMap markdown + json
- [x] `packages/render`：ComponentCard markdown + json
- [ ] `packages/graph-builder`：deprecate
- [x] `apps/cli`：`company / component / chain / evidence / unknown-map / changes`
- [ ] `apps/cli`：`search`
- [x] `apps/cli`：`ingest sec-edgar / pipeline nvidia / graph rebuild`
- [x] `apps/cli`：`graph check`
- [ ] `apps/cli`：独立 `parse / extract / score / apply`
- [x] `apps/cli`：通用 `review enqueue / stats / next / show / approve / reject / apply` 骨架（apply 遇到未解析实体会 blocked）
- [x] `apps/cli`：`review apply-approved --limit`（只处理已 approved 候选，不自动批准 pending）
- [x] `scripts/smoke-local.mjs`：`smoke:local` / `smoke:network` 一条命令链自检（联网模式能输出 NVIDIA company card + unknown map）
- [x] `tests/e2e/nvidia-fixture.test.ts`：不联网 fixture e2e，覆盖 parser/extractor/scorer/apply/render/unknown map
- [x] `apps/cli`：`dq run` 最小只读数据质量检查
- [x] `scripts/release-check.mjs`：开源发布前本地体检（secret scan + tests + smoke + dq + graph check）
- [x] [phase-2-upgrade-plan.md](./phase-2-upgrade-plan.md)：公开 alpha 后可信度优先升级计划
- [x] [multi-tier-chain-logistics-plan.md](./multi-tier-chain-logistics-plan.md)：多级链路 / 原材料 / 物流追踪计划
- [x] [v0.2-alpha-plan.md](./v0.2-alpha-plan.md)：v0.2-alpha 产品范围、P0/P1/P2 与不做事项
- [x] [release-criteria.md](./release-criteria.md)：区分 v0.2 发布标准与 Phase 2 完整验收

### 出场条件（即 MVP 验收）

详见 [mvp-scope.md](../01-product/mvp-scope.md) §"验收标准"。

简版：

- [ ] 25 个核心研究节点全部入 entity_master
- [ ] 至少 100 条 evidence_level >= 4 的边
- [ ] 任一 EV-xxx 都能 1 跳到原始证据
- [ ] Foxconn / Samsung / TSMC 实体消歧检测全过
- [ ] CLI 输出无任何无证据的陈述
- [ ] CLI 输出始终有 unknown_map（≥ 5 项）
- [x] 干净环境一条命令链跑通基础 pipeline（`pnpm smoke:local` / `pnpm smoke:network`；第一条正式 fixture e2e 已补）

### 估时态度

不给估时。逐 task 跟踪即可，但**不要在 Phase 2 之内开始接 Comtrade / EIA 等数据源**。

### 下一批 PR 顺序

公开 alpha 后，Phase 2 的下一步不先追更多数据源，而是按 [phase-2-upgrade-plan.md](./phase-2-upgrade-plan.md) 先修可信度：

1. Component taxonomy + memory/HBM 修正（规则抽取、`COMP-MEMORY` seed、`edges.component_id` / `component_specificity` 已落地；后续继续扩 taxonomy）。
2. Source authority matrix（`sourceAuthorityFor()` 与 scorer 的 `source_cap` / `relation_cap` 已落地；后续随新数据源扩展矩阵）。
3. EntityResolver hardening（fuzzy 不再自动 resolved，Samsung/Foxconn/TSMC family 规则和 identifier match 已落地；seed-derived golden set ≥ 200 已进入单测）。
4. Unknown extractor prefix fail-fast（`inferExtractionMethod()` 已改为未知前缀直接抛错；scorer / graph-builder 均覆盖测试）。
5. Exact citation offsets + evidence fingerprint。
6. SourceRegistry + FetchRun + SourceHealth。
7. Generic SEC rule pack（第二版 `rule.sec.official-supply-chain` 已去掉 NVIDIA gate，并覆盖 foundry / memory supplier / contract manufacturer / 命名 major customer / 命名 purchase obligation / 命名 single-source risk；后续扩 inventory / backlog 等非边型 observation）。
8. Apple Supplier List facility edges 提前到 v0.2 P0。
9. SEC 10-Q / 8-K 接入，为 source monitor 提供动态文件。
10. `cli changes` + ChangeRecord 完整化。
11. CompanyCard / ComponentCard 升级。
12. `apps/research-preview`：全量 TypeScript + Canvas，替代一次性 HTML 脚本。
13. ChainView / multi-tier segment contract（先定义 `edge / observation / lead / unknown` 分层，不先接宏观源）。

### 风险与缓解

| 风险                                               | 缓解                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| LLM 抽取出现幻觉                                   | 强制 cite_text 子串校验 + needs_review = true                                         |
| Apple Supplier List PDF 表格解析不稳定             | 半自动流程；不强求全自动                                                              |
| Entity Resolver 上下文消歧规则覆盖不到 corner case | 增量加 hard-code 规则 + golden set 持续扩充                                           |
| 韩文 IR 文件                                       | MVP 跳过；Samsung / SK Hynix 用英文版                                                 |
| Neo4j 与 Postgres 不一致                           | rebuild() 命令 + housekeeping 校验                                                    |
| memory 被过度具体化为 HBM                          | 先修抽取规则与 component taxonomy；未明确出现 HBM 原文时只输出 `memory`               |
| source cap 过粗导致宏观/线索源误入高等级边         | 引入 source authority matrix；宏观数据默认进 observations，不直接进 company edge      |
| fuzzy resolver 误合并短别名或集团/子公司           | fuzzy 已改为只返回候选；短别名和弱别名必须有 strong alias、identifier 或 context 支撑 |
| `pg-boss` 文档早于实现                             | Phase 2 保持单进程 CLI；队列化放到 Phase 3 monitoring layer，一起补 source health     |
| 静态 HTML 脚本继续膨胀                             | v0.2 迁移到 `apps/research-preview`，使用 TypeScript + Canvas，脚本只保留临时预览用途 |
| LLM 策略已写但真实路径未启用                       | v0.2 主动搁置 LLM 真实抽取，等规则覆盖、review、golden set 稳定后再决策               |

---

## Phase 3 — 扩源 + 持续运行

### 入场条件

Phase 2 出场。

### 任务

- [ ] `dart-kr` adapter（Samsung / SK Hynix 韩文披露的英文版）
- [ ] 扩展亚洲/欧洲 IR 的历史覆盖与非 MVP 公司（MVP 的 4 家 IR 已在 Phase 2 接入）
- [ ] `un-comtrade` adapter → macro_signals 表
- [ ] `census-trade` adapter
- [ ] `usitc-dataweb` adapter
- [ ] `eia` / `fred` / `worldbank-pink` adapter
- [ ] `usgs-mcs` / `iea-critical-minerals` / `rmi-facilities` / `eu-crma` observation 流
- [ ] `import-yeti` 手工流程的 CLI 子命令完善
- [ ] `osh` adapter（与 Apple Supplier List 交叉建 facility）
- [ ] Python sidecar (XBRL) 接入
- [ ] `apps/api` 上线（只读 REST）
- [ ] OpenSearch（可选）or Postgres FTS 升级

### 出场条件

- [ ] Macro signals 在 ComponentCard 中已被引用
- [ ] BOL 推断边总数 < 总边数 20%（避免被推断淹没）
- [ ] API 集成测试通过
- [ ] 生产部署文档（即使是单机部署）写完

---

## Phase 4 — 横向扩展

### 入场条件

Phase 3 出场。

### 任务

- [ ] 第二个研究领域：新能源 / 锂电池链
- [ ] 第三个研究领域：服务器 / 数据中心电力
- [ ] 政府采购 / 新闻线索接入（sam-gov / usaspending / eu-ted / gdelt）
- [ ] 简单 Web UI（如果需要）：Next.js + Cytoscape.js 图谱可视化

### 出场条件

- [ ] 新研究领域有 ≥ 50 条 Level 4-5 边
- [ ] CLI 仍是首选接口（Web 是辅助）

---

## Phase 5 — 推断 + 投资接口（外部项目）

### 入场条件

Phase 4 出场，且 ADR 通过"开放 Level 1-3 自动入图"。

### 任务

- [ ] 自动 BOL 推断流水线
- [ ] 关系强度量化与变化检测
- [ ] 一份完整的 Open API 文档供"投资推断系统"消费

**不**在本仓库做投资策略。投资策略是另一个项目。

---

## 进度跟踪

每周（仅作内部 cadence，不强加）：

- 更新本文件中的 task checkbox
- 把已识别的新风险补充到对应 Phase
- 把任何被打脸的乐观估计写入"教训"小节（保留诚实度）

## 教训记录区

> 这里写每个 Phase 真实跑下来的偏差。先留空，发生了再写。
>
> - Phase 0: TBD
> - Phase 1: 已落地。运行时发现并修复 3 个真实问题：workspace 直接依赖漏声明、seed alias 幂等性、Neo4j 关系索引语法。
> - Phase 2: NVIDIA/SEC 纵向切片已跑通；运行时发现并修复文档去重后的 chunk 外键问题、Samsung 远距离列表误抽取问题、Apple supplier `3M` seed 缺口、review apply 与 Neo4j 双写一致性问题。
> - Phase 2: 公开 alpha 后的静态审查发现 4 个可信度优先风险：memory/HBM 过度具体化、source cap 粗粒度、fuzzy resolver 自动合并风险、`pg-boss` 文档/实现不一致。前 3 项已开始逐步落地，整体计划沉淀为 [phase-2-upgrade-plan.md](./phase-2-upgrade-plan.md)。
