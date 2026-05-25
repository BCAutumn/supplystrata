# @supplystrata/db

`db` 是 Postgres truth store 的访问边界。它提供迁移 SQL、连接封装、读模型查询和受控写入 helper。

## 负责什么

- 创建 `DatabaseStore`、`DbClient` 和事务客户端。
- 暴露按领域拆分的 read / write helper。
- 保存事实边、证据、claim、observation、lead、unknown、source monitor、risk、intelligence 和 change records。
- 提供迁移 SQL，定义 truth store 的持久化结构。

## 不负责什么

- 不实现业务编排。
- 不执行外部 source adapter。
- 不做实体解析、证据评分或关系抽取。
- 不决定 observation、lead、unknown 是否可以升级成 fact edge。
- 不输出前端或 research DTO。

## 主要入口

- `@supplystrata/db/read`：只读查询和 read-side row。
- `@supplystrata/db/write`：事务写入 helper。
- `createDatabaseStore(...)`：创建读写 store。
- `migration-sql/`：数据库结构迁移。

## 边界约定

`db` 只表达持久化形状和最小写入约束。业务状态机、review 策略、派生刷新和 DTO mapping 必须留在上层 domain package。新增查询优先放进具体领域文件，避免继续扩大顶层 barrel 的隐式依赖面。
