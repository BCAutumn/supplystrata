# @supplystrata/research-pack

`research-pack` 负责把 truth store 和静态 Workbench snapshot 打包成可复现的研究输出。它是研究员、CLI、未来前端或 host app 读取供应链情报上下文的聚合层。

## 负责什么

- 生成 `workbench`、CompanyCard、ChainCard、ComponentCard、question readiness、official disclosure readiness、source plan、source target coverage、investigation backlog、corroboration source plan、supply-chain expansion plan、propagation readiness、Gate 1 data-depth workbench、Gate 1 run ledger 和 manifest。
- 把 Gate 1 的事实覆盖、source path、二源检查、single-source disposition、official signal disposition、monitoring config 和 review workbench 汇总成只读执行账本。
- 把 L4/L5 fact edge 增长、同组件相邻官方事实、counterparty corroboration、source blocker、strength 缺口、observation labeling batch 和 propagation context 缺口汇总成只读数据深度工作台，并拆成前端/host app 可消费的 action batch。每个 action item 都带推荐决策、允许决策、写入影响和命令提示，帮助下一轮跑数和算法校准聚焦高价值缺口。
- 把需求、扩产、设施建设、设备安装、工艺材料、价格/贸易和政策信号整理成结构化 reasoning inputs，供未来前端研究员或安全 AI 消费。
- 把 `ai_compute_propagation.v0` 的 demand、server、PCB/materials、fab capacity、cleanroom、equipment、process inputs 和 raw materials 逐层转成只读 matrix；每层显式列出 missing official evidence、allowed research outputs 和 prohibited truth-store writes。未被事实覆盖的层会进入 Gate 1 data-depth workbench 的 `intelligence_context` action batch，方便前端直接审查 source target、lead、unknown 和下一步动作。
- 把 `partial/blocked` propagation readiness 转成 investigation backlog，使补 observation / source target 的动作可排队、可审计。
- 把 source target 的 metric 覆盖转成只读 observation review seeds、calibration candidates 和下一批分层 labeling plan，并在 truth-store 模式回填已持久化 observation calibration label，给前端/host app 做指标审查、calibration 和 gold label 抽样；这些产物明确禁止自动写事实边。
- 为相邻官方事实的下一轮 research target ranking 输出稳定 `ranking_context` / `candidate_id`、`model_version`、assumptions 和 feature breakdown，供前端/host app 标注 ranking calibration gold labels。
- 从 `generatedAt` 派生保守的 source-plan 默认窗口：官方披露和年度材料观测默认取上一 UTC 年，贸易和商品价格观测默认取上一 UTC 月；调用方仍可显式覆盖。
- 支持 DB-backed `research run` 和无数据库 `from-workbench` snapshot 两条路径。
- 在显式 `prepare-data` 输入下调用派生刷新步骤。

## 不负责什么

- 不抓取外部来源。
- 默认不写 claims、edge intelligence 或 component risk。
- 不写 fact edge、evidence、observation 或 source target。
- 不把 source-plan、smoke 成功、observation、official signal 或 unknown 解释成事实证据。
- 不把同组件相邻官方事实自动并入当前研究公司的可见链路；它们只是递归研究候选。
- 不把相邻事实的 company rank 解释成概率结论；rank 只用于生成下一轮研究目标，且必须抑制披露中心节点、品牌方和高频 source-subject 偏差。ranking label 只进入 calibration 样本池，不会自动改 research target、fact edge 或 unknown。
- 不把 AI compute propagation layer 的 `official_target_runnable`、`observation_ready` 或 `lead_only` 解释成事实覆盖；这些状态只能驱动 source target、unknown/backlog 或人工审查动作。
- 不输出未经 schema 化的最终产业判断；开放式推理留给前端研究流程和安全 AI。

## 主要入口

- `buildResearchPack(client, input)`：从 truth store 构建完整研究包。
- `buildResearchPackFromWorkbench(input)`：从静态 Workbench snapshot 构建无数据库研究包。
- `writeResearchPack(...)` / `writeWorkbenchSnapshotPack(...)`：写 JSON/Markdown 文件。
- `buildGate1RunLedger(...)`：生成 Gate 1 主线执行账本。
- `buildGate1DataDepthWorkbench(...)`：生成 Gate 1 数据深度工作台，不写事实层。
- `buildPropagationReadinessReport(...)`：生成产业传导推理输入 readiness，不写事实层。

## 边界约定

`research-pack` 可以编排多个只读模型和报告，但业务规则必须落在具体 feature 文件中。写入动作只能通过显式 prepare-data 分支调用，不能混入默认导出路径。
