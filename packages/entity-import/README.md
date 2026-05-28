# @supplystrata/entity-import

`entity-import` 是外部实体候选进入实体主数据的写入边界。

## 负责什么

- 应用已审核的 `entity_source_candidate` review candidate。
- 应用 universal bootstrap 已证明唯一的官方身份候选。
- 写入或更新 `entity_master` 和 `entity_alias`。
- 解析并关闭对应 pending entity。
- 为 supplier list facility 创建稳定 facility entity。
- 记录 entity import change。

## 不负责什么

- 不抓取 entity source。
- 不做实体 lookup。
- 不自动批准多候选或非权威候选。
- 不写供应链 fact edge。

## 主要入口

- `applyEntitySourceReviewCandidateTransactionally(store, candidate, reviewer)`：事务化导入公司实体。
- `ensureEntitySourceCandidateEntity(client, { surface, candidate, reviewer })`：导入 bootstrap 已证明唯一的公司实体。
- `ensureSupplierListFacilityEntity(client, candidate, reviewer)`：确保 supplier facility entity。

## 边界约定

实体导入必须来自已审核候选，或来自 universal bootstrap 已证明唯一的官方身份候选，并检查 identifier / alias 冲突。实体存在不代表任何供应链关系成立。
