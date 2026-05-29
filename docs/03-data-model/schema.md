# Schema — 数据模型地图

本文只记录当前 schema 的分层、权威边界和不能破坏的契约。实际 DDL 以 `packages/db/src/migration-sql/0001_current_schema_baseline.ts` 和 `packages/db/src/migrations.ts` 为准；读写 API 以 `packages/db/README.md` 和 `@supplystrata/db` 子路径出口为准。

不要在本文复制完整 SQL。当前无人生产使用的历史 migration 已 squash 为 current schema baseline；后续新增表、字段、约束或索引必须进入 baseline 之后的新 migration，并同步更新本文的分层地图。

## 存储边界

| 存储                | 角色                          | 规则                                                                                                                             |
| ------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 官方源（外部）      | **truth**                     | 真相永远在 SEC / DART / EDINET / TWSE / HKEX / Companies House / GLEIF / OpenFIGI / Wikidata / 公司 IR；本地任何存储都是它的派生 |
| PostgreSQL          | **本地 cache + audit ledger** | 缓存证据、关系、observation、unknown、change、job 与审计；不是事实唯一来源；可从官方源 + community-pack 重建                     |
| GraphStore / Neo4j  | materialized graph view       | 只保存当前态图查询所需字段；可从 Postgres 重建                                                                                   |
| ObjectStore / local | raw bytes / normalized files  | 保存原始 HTML / PDF / JSON / CSV 等抓取结果，做内容寻址（sha256）                                                                |
| community-pack      | **read-only warm baseline**   | 维护团队周期发布的预跑数据集；本地写入覆盖 pack 字段，但不污染 pack；详见 `decisions.md` #14                                     |
| Workbench / SCBOM   | read contract                 | 稳定消费 DTO / 开放交换格式；不是存储 schema                                                                                     |

参见 [decisions.md](../10-decisions/decisions.md) #2 和 #8。

community-pack 与本地 cache 的关系：

- pack 是外部 artifact，不是数据库表，也不是 truth store。
- `apps/mcp --pack=<dir>` 会在 read path 上叠加 baseline；它不把 pack 回写进 pack 文件，也不把 pack 当成官方源。
- 当本地 Postgres 能从官方源或本地已验证事实导出 relationship-backed SCBOM 时，本地结果覆盖 pack baseline。
- pack 对象的 provenance method 必须带 `community-pack:<pack_version>`，方便 downstream 区分"热启动 baseline"和"本地/上游复核结果"。

## PostgreSQL 表分层

### Entity Layer

| 表                 | 作用                                   |
| ------------------ | -------------------------------------- |
| `entity_master`    | 公司、业务部门、设施、组件等实体权威表 |
| `entity_alias`     | 实体别名与语言/来源信息                |
| `pending_entities` | 无法自动解析的实体候选                 |
| `chunk_entities`   | 文档 chunk 中的实体 mention            |
| `components`       | 组件/材料/设备 taxonomy 节点           |

契约：

- 所有图节点必须能映射到 `entity_master.entity_id` 或明确的 component id。
- 公司、业务部门、设施、组件不能混成一个模糊实体。
- pending entity 只能进入 review/import 流程，不能直接写 fact edge。

### Source / Document Layer

| 表                  | 作用                             |
| ------------------- | -------------------------------- |
| `documents`         | 规范化文档元数据                 |
| `document_chunks`   | 文档分块和 locator               |
| `source_items`      | 可重复观察的 URL/API item        |
| `document_versions` | source item 的内容版本           |
| `fetch_runs`        | fetch 尝试、状态、错误和快照信息 |

契约：

- `documents.bytes_sha256` 和 object storage key 是证据可重建的基础。
- source item / document version 只说明文档变化，不自动说明供应关系变化。
- 解析失败要保留状态和错误上下文，不能静默丢弃。

### Fact / Evidence Layer

| 表               | 作用                                  |
| ---------------- | ------------------------------------- |
| `edges`          | 可证事实关系                          |
| `evidence`       | 支撑 edge / claim / review 的原文证据 |
| `change_records` | fact / semantic / lifecycle 审计变化  |

契约：

- fact edge 必须有 evidence；证据必须可追溯到 document、source URL、cite text 和 locator/fingerprint。
- `evidence_level` 只描述来源强度，不是 risk score。
- `confidence` 是抽取/解析置信度，不是投资概率。
- `edges.validity` 使用 current / deprecated / historical 等状态；普通 upsert 不能复活终态。
- 事实边废弃必须走受控 soft-delete，并写 change record。
- `component` 是兼容字段；新写入优先使用 `component_id`。

### Claim / Review Layer

| 表                      | 作用                         |
| ----------------------- | ---------------------------- |
| `claims`                | 多证据融合后的可读结论       |
| `claim_evidence`        | claim 与 evidence 的角色关系 |
| `claim_unknowns`        | claim 与 unknown 的边界关系  |
| `review_candidates`     | 人工 review 统一入口         |
| `extraction_rejections` | 硬校验失败的候选             |

契约：

- claim 不能成为新的事实来源。
- claim fusion 只能提升 claim confidence，不能提升 evidence level。
- contradicting evidence 必须保留为 conflict / unknown / review context。
- review candidate approved 不等于自动写 fact edge；写入策略必须由 candidate kind 和 safe-write policy 决定。

### Unknown Layer

| 表              | 作用                                       |
| --------------- | ------------------------------------------ |
| `unknown_items` | 公司、组件、edge、claim 等范围内的显式未知 |

契约：

- unknown 是一等对象，不是失败日志。
- 没有 share / capacity / dependency / 二源 corroboration 时保留 unknown。
- unknown 关闭必须有 evidence、review decision 或 explicit disposition。
- AI summary 不能关闭 unknown。

### Observation / Lead Layer

| 表                  | 作用                                           |
| ------------------- | ---------------------------------------------- |
| `observations`      | 财务、贸易、价格、政策、设施、产能等可复现观测 |
| `lead_observations` | 值得调查但不能写事实边的线索                   |

契约：

- observation / lead 不能被 graph-builder 直接物化成 fact edge。
- `FINANCIAL_METRIC_OBSERVATION`、`TRADE_FLOW_OBSERVATION`、`POLICY_OBSERVATION` 等只能提供上下文、风险输入或研究优先级。
- policy / sanctions / export-control 是 constraint context；未命中不能解释为无风险。

### Intelligence / Risk Layer

| 表                        | 作用                                                     |
| ------------------------- | -------------------------------------------------------- |
| `edge_strength_estimates` | share / spend_band / dependency / capacity / qualitative |
| `edge_freshness`          | fact edge 新鲜度                                         |
| `risk_views`              | 某 scope 的派生风险视图                                  |
| `risk_metrics`            | HHI、single-source、centrality、knockout、anomaly 等指标 |
| `alert_candidates`        | 可审核告警候选                                           |

契约：

- strength / freshness / risk / alert 都是派生层，不能反写 `edges.evidence_level`。
- `strength_kind='share'` 必须有证据；没有 share 不能均分。
- risk metric 必须有 `model_version`、`inputs_fingerprint` 和 provenance。
- alert candidate 不等于正式通知，也不能自动 approve review。

### Monitoring Layer

| 表                     | 作用                                      |
| ---------------------- | ----------------------------------------- |
| `source_health`        | source registry 的运行健康状态            |
| `source_policies`      | source 级 cadence / jitter / retry 配置   |
| `source_check_targets` | 具体公司/来源/配置的监控目标              |
| `source_check_jobs`    | durable worker job / outbox               |
| `source_change_events` | 文档新增、变化、失败、退化等 source event |

契约：

- 持续监控使用 Postgres-backed `source_check_jobs`，不引入 pg-boss。
- job 必须支持 lease、retry/backoff、dead 状态和可审计错误。
- `source_policies` 是外部可配置的统一监控参数入口。
- `next_check_at` 未提供表示不改变运行态；显式 `null` 才清空。
- source event 只说明来源变化，不直接写 fact edge。

### Calibration Layer

| 表                               | 作用                               |
| -------------------------------- | ---------------------------------- |
| `edge_calibration_labels`        | fact edge gold label               |
| `edge_calibration_runs`          | precision / reliability bucket     |
| `edge_calibration_run_items`     | calibration run 明细               |
| `observation_calibration_labels` | observation usefulness labels      |
| `ranking_calibration_labels`     | recursive research target 排序标签 |

契约：

- calibration 只评估方法和阈值，不能自动 rewrite facts。
- 未校准 score 不能解释为真实概率。
- ranking label 不证明关系存在。

## Read Contracts

以下不是数据库 truth schema，但属于稳定消费契约：

| Contract                        | 来源 package       | 作用                          |
| ------------------------------- | ------------------ | ----------------------------- |
| `WorkbenchModel`                | `workbench-export` | 前端、host app、AI 的主读模型 |
| `ScbomDocument`                 | `@scbom/spec`      | 厂商中立供应链交换格式        |
| `CompanyCard` / `ComponentCard` | `card-builder`     | 公司/组件摘要 DTO             |
| `CompanyChainViewModel`         | `chain-view`       | 链路图 read model             |
| `research-pack` outputs         | `research-pack`    | 目录化研究报告和 JSON         |
| OpenAPI route contract          | `apps/api`         | Gate 8 API 契约               |

规则：

- read DTO 不能复用 DB Row。
- Markdown 只是可读渲染，不是正式 machine contract。
- research-pack backlog、execution queue、readiness answer、source target coverage 都是只读规划/状态输出，不是 evidence，也不授权写 fact edge。

## SCBOM v0.0.1

SCBOM（Supply Chain Bill of Materials）是独立维护的开放交换格式，canonical source 是 `BCAutumn/scbom-spec` 的 `v0.0.1` Git tag / GitHub Release；npm `@scbom/spec` 只是可选分发渠道。SupplyStrata 在本仓库中通过 pinned git dependency 消费它，并作为参考实现导出 `ScbomDocument`。

| SCBOM 对象     | SupplyStrata 来源                            | 规则                                                                     |
| -------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| `entity`       | `WorkbenchModel.companies` + chain endpoint  | 没有全球标识时使用显式 producer namespace 的本地 id，不能伪装成 LEI/FIGI |
| `evidence`     | `WorkbenchModel.evidences`                   | 必须带 source URL、cite text、locator、fingerprint、provenance           |
| `relationship` | `WorkbenchModel.edges`                       | 必须有 evidence ref；没有可导出 evidence 时拒绝导出                      |
| `observation`  | `chain_segments[semantic_layer=observation]` | 结构上带 `does_not_assert_relationship: true`，不能被当作 fact edge      |
| `unknown`      | `WorkbenchModel.unknown_items`               | 一等对象；scope 指向可导出的对象，否则回到 root entity                   |
| `change`       | `WorkbenchModel.changes` 的非 risk 事件      | 只导出中立 audit change；risk metric change 不进入 SCBOM                 |

不进入 SCBOM：claim fusion 内部态、review queue、attention queue、risk metric、source*check job、运行态策略和任何 `supplystrata*\*` 私有字段。`evidence_level` 可作为 producer vocabulary assessment 输出，但 SCBOM schema 不把 SupplyStrata 的五级体系硬编码成唯一标准。

community-pack 的 canonical 数据文件是一行一个完整 `ScbomDocument` 的 JSONL。manifest 记录 pack version、生成时间、license、source instance fingerprint、SCBOM schema version、object counts 和每个数据文件的 sha256；loader 必须先校验 manifest 与文件完整性，再把对象标记为 community-pack baseline。

## GraphStore / Neo4j

Neo4j 只保存当前态查询所需节点和关系：

```text
(:Entity {entity_id, kind, canonical_name, display_name, primary_country, status})
[:BUYS_FROM | SUPPLIES_TO | USES_FOUNDRY | ... {edge_id, component_id, evidence_level, confidence, validity}]
```

规则：

- 只投影 `validity='current'` 的事实边。
- 完整 evidence、claim、unknown、risk、audit 信息必须回 Postgres 读。
- GraphStore 失败不回滚本地 cache；可以重试或 rebuild。

## Object Storage

默认 layout：

```text
data/raw/<source_adapter_id>/<entity_or_unknown>/<year>/<month>/<sha256>.<ext>
```

规则：

- `storage_key` 是相对路径。
- `bytes_sha256` 是内容哈希。
- 原始数据不进入公开仓库。

## Migration Rules

- 当前 schema 起点是 `0001_current_schema_baseline`；新库只需要应用 baseline。
- 已有本地库如果已经跑完历史 `0001_entity_core` 到 `0031_research_runs`，迁移器会补记 baseline marker，避免重复执行旧 DDL。
- baseline 之后的 DDL 只通过新 migration 变更。
- baseline 之后已发布的 migration 不回写修改。
- 新表/字段必须同步本文的分层地图。
- 终态保护、幂等键、唯一约束和 provenance 字段优先在 SQL 层表达。
- schema 改动必须跑 type-check、unit test、dep-check 和 format check。

## 删除策略

| 数据              | 策略                          |
| ----------------- | ----------------------------- |
| evidence          | 不删；只能 supersede          |
| edges             | 不删；只能 deprecate          |
| documents         | 不删；只能标记 skipped/failed |
| entity_master     | 不删；只能 merged/deprecated  |
| review_candidates | rejected 后仍保留             |
| change_records    | 永不删                        |
| raw bytes         | 仅在合规要求或本地清理时删除  |
