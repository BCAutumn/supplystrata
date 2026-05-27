# 文档入口

`docs/` 只保留当前仍指导开发和审计的权威文档。旧产品规格、旧路线图、旧模块详设和历史审计记录已经删除；当前实现细节优先看各 package `README.md`。

## 最小阅读路径

第一次接手只读下面这些：

1. [00-overview/overview.md](./00-overview/overview.md) — 定位、边界、术语。
2. [03-data-model/intelligence-methodology.md](./03-data-model/intelligence-methodology.md) — 情报方法学边界。
3. [06-development/backend-completion-criteria.md](./06-development/backend-completion-criteria.md) — 后端完成 gate。
4. [02-architecture/module-design.md](./02-architecture/module-design.md) — 模块和 package 边界。
5. [02-architecture/data-flow.md](./02-architecture/data-flow.md) — 从 source 到 evidence / graph / research output 的主链路。
6. [03-data-model/schema.md](./03-data-model/schema.md) — truth store / derived view schema。
7. [04-data-sources/source-registry.md](./04-data-sources/source-registry.md) — 数据源权威表。
8. [06-development/quickstart.md](./06-development/quickstart.md) — 本地运行入口。

## 活动文档

### Overview

- [overview.md](./00-overview/overview.md)

### Architecture

- [module-design.md](./02-architecture/module-design.md)
- [data-flow.md](./02-architecture/data-flow.md)

### Data Model

- [intelligence-methodology.md](./03-data-model/intelligence-methodology.md)
- [schema.md](./03-data-model/schema.md)
- [evidence-model.md](./03-data-model/evidence-model.md)

### Sources / Runtime / Workflow

- [source-registry.md](./04-data-sources/source-registry.md)
- [backend-completion-criteria.md](./06-development/backend-completion-criteria.md)
- [quickstart.md](./06-development/quickstart.md)

### Compliance / Decisions

- [compliance.md](./09-risks-compliance/compliance.md)
- [decisions.md](./10-decisions/decisions.md)

## 约定

- 判断当前后端进度：只看 [backend-completion-criteria.md](./06-development/backend-completion-criteria.md)。
- 判断方法学边界：只看 [intelligence-methodology.md](./03-data-model/intelligence-methodology.md)。
- 判断 package / module 边界：优先看 [module-design.md](./02-architecture/module-design.md) 和各 package `README.md`。
- 不新增“临时计划文档”。如果规则变重要，合并进方法论、完成标准、模块设计或 package README。
