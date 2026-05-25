# @supplystrata/source-workflows

`source-workflows` 是具体公开来源 workflow 的编排层。它把 source connector、adapter context、source check runner、entity lookup 和无数据库 smoke 组合起来。

## 负责什么

- 注册并运行已支持的 source check connector。
- 为 SEC、官方 IR、DART-KR、EDINET、TWSE MOPS、Apple Supplier List、GLEIF 等来源提供 workflow 入口。
- 执行无数据库 `source-plan` connectivity smoke。
- 通过窄接口把 document observation 持久化委托给上层注入的 port。
- 暴露 connector capability 给 source-management / source-monitor。

## 不负责什么

- 不直接拥有 source policy / job 状态表。
- 不直接写 fact edge。
- 不把官方目录元数据或 normalized document 自动提升成 evidence。
- 不把 entity lookup candidate 自动写入实体主数据。

## 主要入口

- `runDueSourceChecks(store, input)`：运行 due source check jobs。
- `runManualSourceCheck(store, input)`：手动运行指定 target。
- `runSourcePlanConnectivitySmoke(input)`：无数据库 smoke。
- `listRegisteredSourceCheckConnectorCapabilities()`：导出 connector capability。
- 各来源的 adapter / parser helper，例如 `dartKrAdapter`、`edinetAdapter`、`twseMopsAdapter`。

## 手动检查约定

`runManualSourceCheck` 在没有显式 `check_target_id` 时，会登记一个 disabled manual target。这样手动 DB-backed check 仍有稳定的 source event / observation 归属，也能复用统一的 `next_check_at` 计算；但它不会被自动调度，避免一次性研究动作悄悄变成持续监控任务。

## 边界约定

source-workflows 是“外部来源执行编排”，不是事实层。新增来源时应优先注册 connector capability 和明确 target config schema，避免在 CLI 或 research-pack 里硬编码来源分支。
