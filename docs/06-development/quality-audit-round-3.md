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
[x] A5 graph-builder edge identity 已迁到 `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING (xmax=0)`；冲突更新仅允许 `validity='current'`，命中 deprecated/historical identity 时回读 blocked edge 并拒绝追加 evidence。
[x] B2 edge intelligence refresh 不再自动 resolve generated strength unknown；refresh 只写 strength / freshness / explicit unknown，unknown 关闭必须走人工或显式 resolution/disposition。
[x] B3 derived claim refresh 增加 claim human-edit guard：`claims.last_human_edit_at / last_human_editor` 标记人工维护，`upsertClaim()` 在 SQL 层保留人工 claim 的文案、范围、置信度、验证时间和 `generated_by`，并提供显式 `markClaimHumanEdited()` 写入口。
[x] C1 entity import / supplier-list facility import / pending entity resolution 多表写入口收紧到 `DbTxClient`，并补 `applyEntitySourceReviewCandidateTransactionally()` 包装入口。
[x] C2 evidence trace backfill 写入口收紧到 `DbTxClient`，默认只补 active evidence（`superseded_by IS NULL`），并提供 `backfillEvidenceTraceTransactionally()` 分批事务包装。
[x] C3 evidence-maintenance 的 edge intelligence / observation anomaly / alert candidates / component risk refresh 系列新增 `*Transactionally(store, input)` 入口，调用方可以统一通过 store 进入事务边界。
[x] C5 edge claim refresh 的 transactionally 包装改为先读取待处理 edge，再按 `batch_size` 分批进入事务；单批保持原子，避免默认 500 条全部压进一个长事务。
```

## 第 2 批：编排分叉与隐式依赖

```text
[x] D1 scheduled source check 的完整 document observation store 已作为显式端口接入；worker 与 CLI `sources run-due/check` 注入 pipeline 的 `persistDocumentObservations()`，connector 仍只通过窄运行时上下文接收能力，避免 `source-workflows -> pipeline` 反向依赖。
[x] D2 Apple supplier-list PDF fetch 改用 runtime 的 format-agnostic `fetchOrLoadCachedSnapshot()`，metadata 写入 `source_fetch_status=fallback` / `source_fetch_error`，缓存回退不再被误认为 live success。
[x] E1 `getLogger()` 默认返回 `noopLogger`，不再隐式 `loadEnv()`；worker 入口显式 `loadEnv()` 后 `setLogger(createLogger(env))`。
[x] E2 CLI pipeline preview/ingest 的示例公司入口已收敛到 `examples` 命名空间；generic `sec-edgar` ingest/preview 必须显式提供 `--entity`，NVIDIA 只作为 `examples nvidia ...` profile alias。旧 `pipeline nvidia` / `preview nvidia` / `preview report nvidia` 已从正式命令树移除，避免把示例公司误当成通用入口。
[ ] K1/K2 clock / cwd 等隐式依赖需要逐步改为执行层显式注入，尤其是写入审计时间和批量任务。K2 已局部收敛：`SeedEntityResolver.fromCsv()`、`seedFromCsv()` 不再默认读取 `process.cwd()`，由 CLI / test / workflow runtime 显式传入 seed root。K1 已局部收敛：semantic-change claim draft 不再默认 `new Date()`，必须使用 review lifecycle 的 `reviewed_at`；缺失该时间时 apply 会 block 候选；supplier-list review apply 同样要求 review row 带 `reviewed_at`，不再在写事实边前现场生成；official disclosure signal disposition 支持显式 `recordedAt`，测试可复现其审计时间；`buildWorkbenchModel()` 支持显式 `generatedAt`，并用同一个时点驱动 export metadata、edge freshness 和默认 change timeline window，研究快照可重复；`buildResearchPack()` / `buildResearchPackFromWorkbench()` 也支持显式 `generatedAt`，CLI `research run/from-workbench` 暴露 `--generated-at`，research-pack 子报告共享同一生成时点；card-builder 的 company/component card 支持显式 `computedAt`，research-pack 会把同一个 `generatedAt` 传入卡片 freshness summary；`runDataQualityChecks()` 支持显式 `checkedAt`，research-pack 会用同一个 `generatedAt` 生成 data-quality summary，CLI `dq run` 暴露 `--checked-at`；`ApprovedCandidate.approved_by` 统一为 `{ reviewer, reviewed_at }`，graph-builder 写 evidence 时不再为 `"auto"` 分支隐式取当前时钟，pipeline 自动通过候选默认使用文档 `fetched_at` 作为审计时间；edge intelligence / component risk / observation anomaly / financial peer refresh 的 `computed_at` 现由调用方必填，CLI 在入口层解析或生成默认时点，research-pack 复用 `generatedAt`，库层不再隐式决定派生视图计算时间；edge calibration label 的 `reviewed_at` 现由 evidence-maintenance / CLI 显式传入，db helper 不再隐式生成 Gold label 审计时间；alert candidate refresh 的 `since` 和 edge calibration run 的 `generated_at` 现由调用方必填，CLI 在入口层保留默认体验，库层不再自己决定 lookback 窗口或 run 生成时间；source monitor due/enqueue 的 `now` 现由 worker / CLI / test 显式注入，库层不再决定 source target due window 或 job `next_attempt_at`。
```

## 第 3 批：契约边界、重复实现与硬编码

```text
[ ] F1-F6 DB Row / DTO 边界继续收敛：`loadEvidenceCard()` 已改为显式 EvidenceCard DTO 映射，`db/query.ts` 的 evidence 查询已去掉 `ev.*`；`listCurrentEdges()` 与 `loadDocument()` 已去掉 `e.*` / `SELECT *`，并用 db read contract 测试防回退；observation anomaly history 的 `jsonb_to_recordset` CTE 也改为显式列，当前 packages 已无 `SELECT *` / `table.*` grep 命中；`WorkbenchModel.changes` 已改为本地 `WorkbenchChangeTimelineItem` DTO 并通过显式 mapper 从 db timeline 转换；card-builder 的 `UnknownItemRow -> UnknownMapItem` 映射已保留 `scope_kind/scope_id`，Unknown markdown/JSON 输出可审计归属；chain-view-builder 已新增本地 `ChainFact / ChainObservation / ChainLead / ChainUnknown` DTO 与 row mapper，segment mapper 和包入口不再导出或消费 DB Row；其他 Row 暴露面仍需继续治理。
[ ] G1-G8 长 if 链继续按 facts+rules / registry / table-driven 模式收敛，优先参考 `claim-conflict` 的规则表。G1/G2/G3/G4/G5/G6/G7 局部收敛：official disclosure signal extractor 用 source adapter registry 替代并列 source 分支；relation sentence extractor 不再默认 `ENT-NVIDIA`，调用方必须显式传 subject，foundry / memory supplier 触发逻辑改为 counterparty 规则表；edge strength inference 已拆到 `edge-strength-rules.ts` 的文本规则表，refresh 编排不再内联多段 regex 分支；investigation backlog 的 question priority/action 与 Gate 1 scorecard next-action 改为规则表；edge claim type / claim text 改为 relation 映射表，`reviewStats()` 用 status -> stats key 映射表替代并列状态分支。
[ ] H1-H5 NVIDIA / Apple / TSMC 等示例公司硬编码继续迁出通用流程，保留为 seed/profile/fixture，而不是 library 默认行为。H1/H2/E2 局部收敛：relation extractor 和 data-quality unknown-map 最小覆盖检查不再固定 `ENT-NVIDIA`；research-pack 对当前公司启用 unknown-map 检查；NVIDIA SEC 10-K 预览已迁为 `NVIDIA_SEC_10K_EXAMPLE_PROFILE` 和 CLI `examples nvidia ...`；generic SEC preview/ingest 不再隐式指向 NVIDIA；Apple Supplier List CLI preview/enqueue 需要显式 `--entity ENT-APPLE --fiscal-year 2022`，source 限制下沉到 adapter 校验而不是 CLI 隐式默认。
[ ] I1-I11 registry、时间工具、policy 字面量、source runtime helper、Workbench 冗余字段继续去重。I1/I2/I3/I4/I5/I7/I8/I9/I10 已局部收敛：source-check runtime connector 与 source-plan smoke runner 共享 `source-check-catalog.ts` 的只读目录，避免新增源时维护两套清单；手动 source check 不再保留等价 alias，直接复用运行态 connector 分发；Workbench schema validator 会校验 `chain.segments / chain_segments / edges / upstream_edges / downstream_edges` 这些兼容派生视图的一致性，避免重复字段静默漂移；Workbench claim-conflict schema 校验复用 claim-builder 导出的状态/动作/步骤常量，review candidate status 校验复用 review-candidates 导出的状态常量，避免 DTO validator 与 domain contract 漂移；CLI `research` 与 `sources plan` 复用同一 trade direction parser；CLI pipeline preview 复用 observability 的 `messageFromUnknown()`；CLI 的 source workflow runtime helper 收到 `apps/cli/src/source-workflow-runtime.ts`，避免预览与 review 命令各自读取 env/cwd；review-candidates 导出 `blockedFactWritePolicy()`，official signal 与 claim conflict review queue 复用同一 review-only fact-write policy 构造；db 内部 `toIsoString()` / date-only 转换集中到 `packages/db/src/time.ts`。
```

## 第 4 批：大文件拆分与 citation 共享

```text
[ ] `workbench-export/src/schema.ts`、`source-management/src/index.ts`、`apps/cli/src/commands/sources-changes.ts`、`source-monitor/src/index.ts` 等文件继续按 feature / definitions / functions / orchestration 拆分。`workbench-export/src/schema.ts` 已将 legacy JSON normalize 拆到 `schema-normalize.ts`，运行时 validator 拆到 `schema-validator.ts`，schema 入口从 639 行降到 10 行；`source-management/src/index.ts` 已将 definitions、source-plan parser、target generation 拆出，index 从 636 行降到 267 行；`source-plan/src/index.ts` 已将官方披露 target 展开、年度模板处理和 registered connector entity 映射拆到 `official-disclosure-targets.ts`；`apps/cli/src/commands/sources-changes.ts` 已将 source-check 输入拼装拆到 `source-check-options.ts`，source-check run 渲染拆到 `source-render.ts`，命令文件从 630 行降到 456 行；`source-monitor/src/index.ts` 已将 policy sync / target enable / health list 拆到 `source-policy-management.ts`，document observation / failure / degraded 写路径拆到 `source-observation-events.ts`，入口从 601 行降到 75 行；`db/src/observations.ts` 已将 `lead_observations` 状态机和读写入口拆到 `db/src/leads.ts`，observation measurement/correction 与 lead lifecycle 不再混在同一文件；`evidence-maintenance/src/observation-anomaly.ts` 已将异常评估、fingerprint、risk metric 构造拆到 `observation-anomaly-evaluation.ts`，refresh 文件只保留编排和 DB 读写；`review-candidates/src/index.ts` 已将 supplier-list review builder、review-to-relation、facility display/id 逻辑拆到 `supplier-list.ts`，entity-source candidate builder 和 proposed entity id 逻辑拆到 `entity-source.ts`，OSH facility candidate builder / row text / stable id 逻辑拆到 `osh-facility.ts`，semantic-change candidate builder / stable id / confidence 逻辑拆到 `semantic-change.ts`，index 只保留剩余 candidate builder facade。
[x] EDINET / DART / TWSE 目录监控已将 source-specific parsing / formatting / normalization 下沉到 `edinet-document-list.ts`、`dart-kr-disclosure-list.ts`、`twse-mops-electronic-documents.ts`；`*-checks.ts` 只保留 adapter / connector / config 入口。暂不新增 source/parser package，避免为了拆分制造更多包和跨包胶水。
[x] signal / observation / relation / pipeline citation locate 逻辑已收敛到现有 `@supplystrata/parsers-text`：共享 candidate sentence、sentence offsets、nearby snippet、exact occurrence 计数；未新增包，避免 package 数继续膨胀。
```

## 第 5 批：性能与体验收尾

```text
[ ] 多处 N+1 写入后续可改批量 SQL 或 unnest。`replaceRiskView()` 已将 `risk_metrics` 写入从逐条 insert 改为单次 `jsonb_to_recordset` 批量插入，component risk / anomaly / financial peer refresh 不再按 metric 数量放大写入语句数；`insertChainSegments()` 已改为单次 `jsonb_to_recordset` 批量插入，避免 chain view materialization 按 segment 数放大写入语句数。
[x] source check due target 查询已排除存在 active `pending / in_progress / failed` job 的 target，避免 worker 循环反复 enqueue 冲突；已有 job 仍由独立 claim/backoff/lease 路径处理。
[x] preview-render 的 CSV review sheet 渲染已拆到 `apps/cli/src/preview-csv.ts`，中文研究报告文案/翻译表已拆到 `apps/cli/src/preview-report-zh.ts`；`preview-render.ts` 只保留预览入口和英文 markdown 组装。
[x] research-preview loading generation guard 已加固：加载中 canvas segment click 会被忽略，成功/失败都会结束 active load token，避免旧 layout 在新模型加载期间反向改 selected segment。
```

## 当前验收记录

```text
2026-05-23:
- 已完成第 1 批中 A1 / A2 / A3 / A4 部分 / A6 / B1 / B4 / C4。
- 已跑 targeted unit:
  pnpm -s vitest run tests/unit/db-intelligence-contract.test.ts tests/unit/review-store.test.ts
- 继续完成 D1 / D2 / E1，补齐 source check job lease、research-pack 显式 prepare、claim-builder / workbench-export 局部拆分、graph-builder atomic upsert、entity-import / evidence trace / edge claim 事务边界。
- 本轮继续收敛 source check active-job 空转、research-preview loading guard、K1/K2 局部显式注入、G3/G7 表驱动、I5/I10 重复实现。
- 本轮继续收敛 E2/H1/H2/F4：generic SEC preview/ingest 不再默认 NVIDIA，NVIDIA 只作为 example profile；data-quality unknown-map 检查改为调用方传入当前 entity target；Workbench changes 改为本地 DTO。
- 本轮继续拆分 `workbench-export/src/schema.ts`：legacy Workbench JSON 兼容 normalize 与 schema validate 分离，降低单文件职责密度。
- 本轮继续拆分 `source-management/src/index.ts`：公共契约进入 `definitions.ts`，source-plan JSON 解析进入 `source-plan-parser.ts`，source-plan target 生成进入 `source-plan-targets.ts`。
- 本轮继续拆分 CLI source/change 入口：source-check 选择、手动 check config、target schedule option 进入 `source-check-options.ts`；due/check run markdown 渲染进入 `source-render.ts`；`research` 与 `sources plan` 共享 trade direction parser。
- 本轮继续拆分 Workbench schema：`schema.ts` 只保留 `parseWorkbenchModel()` 对外入口，运行时契约校验集中在 `schema-validator.ts`。
- 本轮继续拆分 `source-monitor/src/index.ts`：source policy 同步、target enable、source health list、target ensure 进入 `source-policy-management.ts`；document observation / source failure / source degraded 事件写入和 next-check 推进进入 `source-observation-events.ts`；入口文件只保留 public facade 与 due list 查询。
- 本轮继续收敛 citation / sentence 切分和 source 分发：`signal-extractor`、`observation-extractor`、`relation-extractor`、`pipeline` 复用 `@supplystrata/parsers-text` 的候选句、带 offset 句窗、nearby snippet 和精确 citation 计数，避免跨 extractor 规则漂移；official disclosure signal source 分发改为 registry，新增 source 时不再堆并列 `if`。
- 本轮继续拆分 EDINET / DART / TWSE source workflow：官方披露目录的 URL/校验/解析/格式化/normalize 进入 source-specific 模块，source-check 文件只保留调度入口和 target config 解析。
- 已跑完整门禁：
  pnpm -s type-check
  pnpm -s lint
  pnpm -s dep-check
  pnpm -s test:unit
  pnpm -s format:check
  pnpm -s build
```
