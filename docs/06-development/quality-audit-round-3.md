# Quality Audit Round 3 — 全模块质量审计跟踪

本文跟踪第三轮全模块代码质量审计。审计重点从“包边界是否干净”推进到“并发正确性、终态保护、派生写路径权限、DTO 契约和长期可维护性”。

## 总体判断

```text
当前底座已经具备较清晰的事务客户端、Row/DTO 分离、派生层与事实层边界、connector registry 和 source workflow 基础。
第三轮主要问题集中在：
1. 少数 upsert / review 状态转移仍存在并发或终态覆写风险。
2. 部分派生刷新流程仍会自动写入审计状态，需要更明确的 review / disposition 边界。
3. 部分 source workflow、research-pack、CLI 入口仍有编排职责偏胖或读写职责混合。
4. DTO / DB Row 边界已经改善，但仍有若干输出路径直接依赖 Row 形状。
5. 大文件和重复规则仍会拖慢后续数据源扩展。
```

## 第 1 批：并发正确性与终态保护

```text
[x] A1 unknown upsert 去掉 SELECT 后 INSERT 的 inserted 推断，改为 `INSERT ... ON CONFLICT ... RETURNING (xmax = 0) AS inserted`。
[x] A2 alert candidate upsert 对 `resolved` / `suppressed` 终态做 SQL 层保护，刷新任务不能覆写 severity / title / source refs / provenance / attrs。
[x] A3 claim upsert 冲突时不再改 status；状态迁移必须通过专用 lifecycle / review 流程表达。
[x] A4 review blocked 状态转移限定到 `pending` / `in_review` / `approved` / `blocked`，不能覆盖 `rejected` / `applied`。
[x] A4 official disclosure signal disposition 读取 review row 时使用 `FOR UPDATE`，disposition 与语义 change 在同一事务快照下完成。
[x] A6 observation anomaly semantic change 在 observation + risk view 粒度加事务级 advisory lock，避免并发 refresh 双写同一个异常事件。
[x] B1 graph-builder 写入 reviewed evidence 时拒绝追加到 deprecated edge；edge update / primary evidence update 只作用于 `validity = 'current'`。
[x] B4 Neo4j 投影遇到非 current edge 时删除图库边并跳过 upsert，Postgres truth store 中 deprecated edge 不再重新出现在 graph projection。
[x] C4 graph-builder 内部写 helper 与 db alert status helper 收紧到 `DbTxClient`。
[ ] A5 graph-builder edge identity 当前依赖事务级 advisory lock + SELECT/INSERT/UPDATE。后续可继续评估是否迁到原子 upsert；迁移前需要确认 deprecated identity 与唯一索引的历史语义。
[ ] B2 edge intelligence refresh 自动 resolve generated unknown 的权限边界仍需调整：应改为 review/disposition 候选，或区分 `auto_suggested` 与 `human_confirmed`。
[ ] B3 derived claim refresh 对 active claim 的人工修订保护仍需更细：可引入 generated/human edit guard，或限定 derived refresh 只改派生子集。
[ ] C1 entity import review apply 仍需继续核对多表写入是否完全只接受 `DbTxClient`。
[ ] C2 evidence trace backfill 仍需分批事务与 active evidence 过滤策略。
[x] C3 evidence-maintenance 的 edge intelligence / observation anomaly / alert candidates / component risk refresh 系列新增 `*Transactionally(store, input)` 入口，调用方可以统一通过 store 进入事务边界。
[ ] C5 edge claim refresh 大批量事务仍需分批提交或 cursor 方案。
```

## 第 2 批：编排分叉与隐式依赖

```text
[ ] D1 scheduled source check 默认 document observation store 当前仍偏轻；需要把完整 document observation / relation semantic change / review enqueue 作为显式可注入端口，而不是让不同入口产生不同深度的数据。
[ ] D2 Apple supplier-list cache fallback 语义需要复用 runtime 的 fallback/degraded 口径，缓存回退不能被误认为成功抓取。
[ ] E1 observability 默认 logger 需要继续核对：库层默认应保持 noop，app/CLI/worker 显式注入 env logger。
[ ] E2 CLI pipeline preview/ingest 仍有示例公司入口；后续应继续收敛到 source connector / source-management catalog 驱动。
[ ] K1/K2 clock / cwd 等隐式依赖需要逐步改为执行层显式注入，尤其是写入审计时间和批量任务。
```

## 第 3 批：契约边界、重复实现与硬编码

```text
[ ] F1-F6 DB Row / DTO 边界继续收敛：card-builder、workbench-export、chain-view-builder 不能把 Row spread 成公共 DTO。
[ ] G1-G8 长 if 链继续按 facts+rules / registry / table-driven 模式收敛，优先参考 `claim-conflict` 的规则表。
[ ] H1-H5 NVIDIA / Apple / TSMC 等示例公司硬编码继续迁出通用流程，保留为 seed/profile/fixture，而不是 library 默认行为。
[ ] I1-I11 registry、时间工具、policy 字面量、source runtime helper、Workbench 冗余字段继续去重。
```

## 第 4 批：大文件拆分与 citation 共享

```text
[ ] `workbench-export/src/schema.ts`、`source-management/src/index.ts`、`apps/cli/src/commands/sources-changes.ts`、`source-monitor/src/index.ts` 等文件继续按 feature / definitions / functions / orchestration 拆分。
[ ] EDINET / DART / TWSE 这类 source workflow 后续应把 parsing/normalization 下沉到对应 source 或 parser 包，workflow 保持 connector 薄层。
[ ] signal / observation / relation / pipeline citation locate 逻辑需要抽成共享 text-citation 能力，避免抽取器之间规则漂移。
```

## 第 5 批：性能与体验收尾

```text
[ ] 多处 N+1 写入后续可改批量 SQL 或 unnest。
[ ] source check due target 在 active job 存在时可能反复 enqueue 冲突，后续应减少空转。
[ ] preview-render 的中英文文案和 CSV 渲染应从 CLI 胖文件中拆出。
[ ] research-preview loading generation guard 需要继续加固，避免旧 model click 干扰新 model。
```

## 当前验收记录

```text
2026-05-23:
- 已完成第 1 批中 A1 / A2 / A3 / A4 部分 / A6 / B1 / B4 / C4。
- 已跑 targeted unit:
  pnpm -s vitest run tests/unit/db-intelligence-contract.test.ts tests/unit/review-store.test.ts
```
