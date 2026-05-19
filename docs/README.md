# 文档地图

本目录是 SupplyStrata 的全部设计文档。代码动工前必须先把这里的关键文档定稿（带 ★）。

```
docs/
├── 00-overview/                  系统定位、术语、不做什么
│   ├── vision.md                 ★ 系统要解决什么
│   ├── non-goals.md              ★ 系统不做什么
│   └── glossary.md                  术语表
│
├── 01-product/                   产品/输出层面定义
│   ├── audience-and-personas.md      v0.2 用户边界：自用研究员 + 复现型外部研究员
│   ├── changes-and-monitoring-spec.md changes / source health 的产品契约
│   ├── mvp-scope.md              ★ MVP 边界与验收标准
│   ├── output-spec.md            ★ 公司卡片 / 组件卡片 / 证据卡片 / 未知地图
│   ├── research-workbench-spec.md    TypeScript + Canvas 研究工作台规格
│   ├── research-ui-preview.md       研究前端原型：链路图优先的信息架构
│   ├── target-companies.md          第一批研究对象
│   └── user-stories.md              典型使用场景
│
├── 02-architecture/              工程架构
│   ├── system-architecture.md    ★ 总体架构
│   ├── module-design.md          ★ 模块拆分与接口契约（高内聚低耦合的落地）
│   ├── embedding-runtime.md         无 Docker 与宿主 app 集成模式
│   ├── tech-stack.md             ★ 技术选型（TS 主栈，Python sidecar）
│   ├── data-flow.md                 数据从源到图谱的全流程
│   └── extensibility.md             如何接入新数据源 / 新关系类型
│
├── 03-data-model/                数据模型
│   ├── entity-model.md           ★ 实体（公司/产品/工厂/港口/船等）
│   ├── relation-model.md         ★ 关系类型与语义
│   ├── evidence-model.md         ★ 证据等级模型（Level 1-5）
│   ├── confidence-scoring.md        置信度打分规则
│   └── schema.md                 ★ Postgres + Neo4j schema
│
├── 04-data-sources/              数据源
│   ├── source-registry.md        ★ 数据源总表（含 P0/P1/P2 分级）
│   ├── source-roi-matrix.md         数据源 ROI 排序与 v0.2 接入顺序
│   ├── coverage-research-2026-05.md 数据覆盖研究与下一批 connector 顺序
│   ├── tier-A-disclosures.md        公司官方披露
│   ├── tier-B-entity-resolution.md  实体解析数据
│   ├── tier-C-facility-data.md      工厂/供应商设施
│   ├── tier-D-trade-customs.md      贸易/海关
│   ├── tier-E-shipping-logistics.md 船舶/港口/物流
│   ├── tier-F-energy-commodities.md 能源/商品/原材料
│   └── tier-G-procurement-news.md   政府采购/新闻/弱信号
│
├── 05-modules/                   模块详细设计
│   ├── ingestion.md              ★ 数据采集模块（含 source adapter 契约）
│   ├── parsing.md                   HTML/PDF/XBRL/CSV 解析
│   ├── entity-resolution.md      ★ 实体消歧（Foxconn / Hon Hai / 鸿海 / 富士康）
│   ├── relation-extraction.md    ★ 规则 + LLM 关系抽取
│   ├── evidence-scoring.md          证据等级与置信度自动评分
│   ├── graph-builder.md             把证据写入 Neo4j 的策略
│   ├── storage.md                   存储层（Postgres + Neo4j + 对象存储）
│   ├── query-api.md                 Phase 3 之后的查询接口
│   └── cli.md                    ★ MVP 阶段对外的唯一接口
│
├── 06-development/               开发流程
│   ├── roadmap.md                ★ 阶段化路线图（Phase 0-5，不承诺自然周）
│   ├── phase-2-upgrade-plan.md   ★ 公开 alpha 后的可信度优先升级计划
│   ├── multi-tier-chain-logistics-plan.md ★ 多级链路 / 原材料 / 物流追踪计划
│   ├── midterm-intelligence-network-plan.md ★ Claim / Observation / ChainView 中期骨架
│   ├── v0.2-alpha-plan.md           v0.2-alpha P0/P1/P2 任务与验收
│   ├── release-criteria.md          v0.2 与 Phase 2 full acceptance 的发布标准
│   ├── quickstart.md                从空环境跑到研究输出
│   ├── code-quality-hardening.md    进入中期目标前的质量修复计划与状态
│   ├── coding-standards.md          代码规范（TS strict、命名、目录约定）
│   ├── testing-strategy.md          测试策略（单元/契约/数据快照）
│   ├── git-workflow.md              分支策略、提交规范、PR 模板
│   └── open-source-readiness.md     开源发布前体检
│
├── 07-operations/                运维与质量
│   ├── local-dev.md                 本地启动
│   ├── observability.md             日志、指标
│   └── data-quality.md           ★ 数据质量校验规则
│
├── 08-research-workflow/         研究流程（系统使用方式）
│   ├── workflow-nvidia-hbm.md       范例：NVIDIA → HBM 链
│   ├── workflow-template.md         通用研究流程模板
│   └── unknown-map.md            ★ 未知地图方法论
│
├── 09-risks-compliance/          法律、伦理、ToS
│   ├── legal-tos.md              ★ 数据源 ToS 概览
│   ├── data-licenses.md             各数据源的许可
│   ├── manifest-confidentiality.md  CBP 保密条款
│   └── ethics.md                    伦理边界
│
└── 10-decisions/                 ADR (Architecture Decision Records)
    ├── ADR-template.md
    ├── ADR-001-language-choice.md   ★ 主语言 TS + Python sidecar
    ├── ADR-002-graph-db.md          ★ Neo4j vs PostgreSQL+pgvector
    ├── ADR-003-llm-strategy.md      ★ LLM 用法与降级策略
    ├── ADR-004-monorepo-structure.md ★ pnpm workspaces 拆包方式
    └── ADR-005-open-source-license.md ★ Apache-2.0 开源许可
```

---

## 阅读顺序建议

### 第一次读这个仓库（最少 30 分钟）

1. [00-overview/vision.md](./00-overview/vision.md)
2. [00-overview/non-goals.md](./00-overview/non-goals.md)
3. [01-product/audience-and-personas.md](./01-product/audience-and-personas.md)
4. [01-product/mvp-scope.md](./01-product/mvp-scope.md)
5. [01-product/output-spec.md](./01-product/output-spec.md)
6. [03-data-model/evidence-model.md](./03-data-model/evidence-model.md)
7. [02-architecture/system-architecture.md](./02-architecture/system-architecture.md)

### 准备开始写代码前必读

1. [02-architecture/module-design.md](./02-architecture/module-design.md)
2. [02-architecture/tech-stack.md](./02-architecture/tech-stack.md)
3. [03-data-model/schema.md](./03-data-model/schema.md)
4. [05-modules/ingestion.md](./05-modules/ingestion.md)（source adapter 契约）
5. [10-decisions/ADR-001-language-choice.md](./10-decisions/ADR-001-language-choice.md)
6. [10-decisions/ADR-004-monorepo-structure.md](./10-decisions/ADR-004-monorepo-structure.md)
7. [06-development/roadmap.md](./06-development/roadmap.md)
8. [06-development/phase-2-upgrade-plan.md](./06-development/phase-2-upgrade-plan.md)

### 公开 alpha 后继续 Phase 2 前必读

1. [06-development/v0.2-alpha-plan.md](./06-development/v0.2-alpha-plan.md)
2. [06-development/release-criteria.md](./06-development/release-criteria.md)
3. [06-development/phase-2-upgrade-plan.md](./06-development/phase-2-upgrade-plan.md)
4. [06-development/midterm-intelligence-network-plan.md](./06-development/midterm-intelligence-network-plan.md)
5. [04-data-sources/source-roi-matrix.md](./04-data-sources/source-roi-matrix.md)
6. [03-data-model/evidence-model.md](./03-data-model/evidence-model.md)
7. [03-data-model/relation-model.md](./03-data-model/relation-model.md)
8. [05-modules/entity-resolution.md](./05-modules/entity-resolution.md)
9. [05-modules/evidence-scoring.md](./05-modules/evidence-scoring.md)
10. [04-data-sources/source-registry.md](./04-data-sources/source-registry.md)

### 接入新数据源前必读

1. [02-architecture/extensibility.md](./02-architecture/extensibility.md)
2. [04-data-sources/source-registry.md](./04-data-sources/source-registry.md)
3. [05-modules/ingestion.md](./05-modules/ingestion.md)
4. [09-risks-compliance/legal-tos.md](./09-risks-compliance/legal-tos.md)

---

## 文档约定

- **★** 标记的是开发动工前的必读/必决文档。
- **ADR** 是不可变文档：决定了就不改，要变更就开新 ADR 标 `Supersedes ADR-XXX`。
- 所有文档默认中文，技术术语保留英文原文（如 `evidence_level`, `BOL`, `XBRL`），不强行翻译。
- 凡是带主观判断的段落，必须明确标注"未验证 / 需要决议 / TBD"。
