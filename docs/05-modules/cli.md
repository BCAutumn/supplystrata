# Module: CLI — 命令行接口

`apps/cli`。MVP 阶段对外的**唯一**接口。

当前实现按职责拆分：

- `main.ts`：只创建 `Command` 实例并注册命令模块，避免入口文件继续膨胀。
- `commands/db-admin.ts`：数据库迁移、seed、evidence trace 回填。
- `commands/pipeline-preview.ts`：ingest / pipeline / preview 相关命令。
- `commands/sources-changes.ts`：source registry、source health、source policy、changes timeline。
- `commands/entity-review.ts`：entity lookup / pending entity / review queue。
- `commands/graph-dq-cards.ts`：graph、data quality、company / chain / component / evidence / unknown-map 卡片。
- `cli-utils.ts`：`--format` / `--limit` 等参数解析、JSON/Markdown 输出、Postgres pool 生命周期。
- `preview-render.ts`：NVIDIA / Apple supplier preview 和研究报告渲染。
- `entity-render.ts` / `review-render.ts` / `source-render.ts`：各自领域的展示层。

约束：未来的 TypeScript + Canvas 研究工作台、桌面端或 agent 产品要复用 packages 能力，不能把业务判断写进 CLI render 层。

## 设计原则

1. **结构化输出优先**：默认 `--format` 至少支持 `markdown` 和 `json`。
2. **不在 CLI 输出里夹杂业务逻辑**：CLI 只调用 packages，不做转换。
3. **可脚本化**：所有命令支持 `--quiet`，错误退出码非 0。
4. **可重现**：所有命令幂等（除非显式 mutation），同一命令多次运行结果一致（modulo 数据变化）。

## 命令树

```
supplystrata
├── db
│   ├── migrate
│   └── backfill-evidence-trace [--limit]
├── admin
│   └── seed
├── ingest
│   └── sec-edgar --cik <cik> [--entity] [--types]
├── pipeline
│   └── nvidia
├── preview
│   ├── nvidia [--format]
│   ├── apple-suppliers [--format] [--limit]
│   ├── sec-edgar --cik <cik> [--entity] [--types] [--format]
│   └── report
│       └── nvidia [--format] [--lang]
├── sources
│   ├── list [--format]
│   ├── status [--format]
│   ├── sync
│   ├── health [--format]
│   ├── due [--limit] [--format]
│   └── policy
│       └── sync --file <path>
├── changes [--since] [--scope] [--type] [--source] [--attention-only] [--limit] [--format]
├── company <ref> [--format]
├── component <name> [--format]
├── evidence <id> [--format]
├── chain <company> [--depth] [--format]
├── unknown-map <company-query> [--format]
├── entity
│   ├── lookup <query> [--source all|opencorporates|companies-house] [--jurisdiction] [--limit] [--format]
│   └── pending
│       ├── list [--status pending|resolved|all] [--limit] [--format]
│       ├── show <PND-id> [--format]
│       └── lookup <PND-id> [--source all|opencorporates|companies-house] [--jurisdiction] [--limit] [--format]
├── review
│   ├── stats
│   ├── next
│   ├── show <id>
│   ├── approve <id>
│   ├── reject <id> [--reason]
│   ├── apply <id>
│   ├── apply-approved [--reviewer] [--limit] [--format]
│   └── enqueue
│       ├── apple-suppliers
│       └── entity-source <query> [--source] [--jurisdiction] [--limit]
├── graph
│   ├── rebuild
│   └── check [--format]
└── dq
    └── run [--format]
```

## 主要命令规格

### supplystrata preview

无数据库预览路径，用来检查抓取、解析、抽取和评分，不写 Postgres / Neo4j：

```bash
supplystrata preview nvidia --format markdown
supplystrata preview sec-edgar --cik 0001045810 --entity ENT-NVIDIA --types 10-K --format markdown
supplystrata preview sec-edgar --cik 0001045810 --entity ENT-NVIDIA --types 10-Q --format markdown
supplystrata preview sec-edgar --cik 0001045810 --entity ENT-NVIDIA --types 8-K --format markdown
supplystrata preview apple-suppliers --format csv
```

`--types` 支持逗号分隔的 `10-K,10-Q,20-F,8-K`。SEC adapter 内部也支持 `limit` 计划多份最近 8-K task，供后续 source monitor 调度层复用；当前 CLI preview 仍只消费第一个 task。

### supplystrata company `<ref>`

```
ref         可以是 ticker / cik / lei / entity_id / 别名
--depth N   默认 1（一级上游）；2 = 二级
--format    markdown (默认) | json
--include-inferred       是否包含 Level 1-3 边（默认否）
--lang en|zh             仅影响 markdown 渲染
```

返回：CompanyCard（[output-spec.md](../01-product/output-spec.md)）。

退出码：

- 0：成功
- 2：实体不存在
- 3：歧义（返回候选列表）
- 1：其他错误

### supplystrata component `<name>`

```
name        组件 ID、组件名或别名（如 "COMP-MEMORY" / "memory" / "HBM"）
--format    markdown | json
```

返回 ComponentCard：known_suppliers、known_consumers、evidence_edges、source_coverage、unknown_map。它只读取 `components` taxonomy 与图谱边，不绑定 Apple / NVIDIA。

### supplystrata chain `<company>`

```
company     公司名、别名、ticker 或 entity_id
--depth N   默认 2，最大 5
--format    markdown | json
```

返回 chain-first upstream view。它沿 Level 4-5 的 `BUYS_FROM` / `USES_FOUNDRY` / `SUPPLIES_TO` / `MANUFACTURES_AT` 边递归展开，默认不展示 Level 1-3 推断边。

JSON 输出消费 `@supplystrata/chain-view` 的 `CompanyChainViewModel`，每段都有 `semantic_layer`。当前支持 `edge`、`claim`、`observation`、`lead`、`unknown` 分层；observation / lead / unknown 是上下文 segment，不带 `evidence_level`，不改变事实边语义，也不进入 Neo4j fact edge。

### supplystrata claims build

```
--min-level 4|5
--limit N
--generated-by <id>
--format markdown | json
```

从已验证事实边生成 claim 层。它只扫描 current、非 inferred、有 primary evidence 的 Level 4/5 边；重复运行会更新同一个确定性 claim，不会产生重复结论。

### supplystrata evidence `<id>`

```
返回 EvidenceCard。
若 evidence 已 superseded，输出 base 卡片 + supersession chain。
```

### supplystrata unknown-map `<scope> <id>`

```
scope: company | component | topic
id   : 对应 ID
```

返回 UnknownMap。

### supplystrata changes

```
--since YYYY-MM-DD       默认 7 天前，也可传 ISO datetime
--scope <scope>           可选，company:<id> / entity:<id> / edge:<id> / source:<id>
--type <change_type>      可选，支持 change_records.change_type 或 source_change_events.event_type
--source <adapter-id>     可选，按 source_adapter_id 过滤
--attention-only          只看需要研究员关注的变化
--limit N                 默认 50
--format markdown | json
```

返回 ChangeRecord + source_change_events 合并后的 timeline。Markdown 默认分成 `Requires attention` 与普通 `Timeline`；JSON 保留结构化字段，供未来 TypeScript + Canvas 工作台消费。

示例：

```bash
supplystrata changes --since 2026-05-01 --format markdown
supplystrata changes --scope company:ENT-NVIDIA --format json
supplystrata changes --source sec-edgar --attention-only
```

### supplystrata review

人工 review 是所有不应自动入图候选的入口。当前已落地：

```
supplystrata review enqueue apple-suppliers
supplystrata review enqueue entity-source <query> [--source all|opencorporates|companies-house] [--jurisdiction] [--limit]
supplystrata review stats
supplystrata review next
supplystrata review show <REV-id>
supplystrata review approve <REV-id> --reviewer <name> [--reason "..."]
supplystrata review reject <REV-id> --reviewer <name> --reason "..."
supplystrata review apply <REV-id> --reviewer <name>
supplystrata review apply-approved --reviewer <name> [--limit N] [--format markdown|json]
```

`approve` 只代表研究员同意候选进入下一步，不等于已经写图。`apply` 会按 candidate kind 分流：

- `supplier_list_row`：生成两条受控关系：buyer `BUYS_FROM` supplier，以及 supplier `MANUFACTURES_AT` facility。apply 前会先做实体解析和证据评分；如果 supplier 还没进入实体库，候选会变成 `blocked`，同时写入 `pending_entities`，不会生成脏边。只有 buyer / supplier 都能解析，并且 facility 实体能由已审核行稳定创建时，才交给 `GraphBuilder.apply()`。
- `entity_source_candidate`：把外部登记源候选写入 `entity_master` / `entity_alias`，并把同 surface 的 `pending_entities` 标记为 resolved。写入前会检查 identifier / alias 是否已经属于其它实体，冲突时 blocked。

如果实体是高频且低歧义的 curated seed，比如 `3M`，也可以先补 `seeds/entities.csv` / `seeds/aliases.csv`，再执行 `supplystrata admin seed` 和原 review 的 `apply`。supplier list apply 成功后会关闭同 surface 的 pending entity。`blocked` 候选允许人工补完实体后重试；`apply-approved` 批处理仍只扫描 `approved`，不会自动重试所有 blocked 项。

`review apply` 的返回值里会带 `apply_results[].graph_sync`。`synced` 表示 Neo4j 当前态已经同步；`failed` 表示 Postgres 真相存储已经写入成功，但 Neo4j 物化视图没有同步成功，应执行 `supplystrata graph rebuild`。返回值只保留结构化的 `apply_results`，不再维护旧的单边 `apply_result` 字段。

`review apply-approved` 是批处理工具，只扫描 `status='approved'` 的候选，不会自动 approve `pending` 候选。每条候选仍然走同一个 `applyApprovedReviewCandidate()` 严格路径：无法解析实体会变成 `blocked`，写图异常会进入 `error`，Neo4j 同步失败会体现在单条结果的 `apply_results[].graph_sync`。

### supplystrata graph check

检查 Neo4j 当前态是否与 Postgres 真相存储的投影计数一致：

```bash
supplystrata graph check --format markdown
supplystrata graph check --format json
```

`synced` 表示节点数和当前边数一致；`out_of_sync` 或 `unreachable` 时应先排查 Neo4j，再运行 `supplystrata graph rebuild`。

### supplystrata entity lookup `<query>`

外部实体源候选查询。当前用于 OpenCorporates / UK Companies House，目的是帮 review/import 决策补 identifier 和别名，不直接修改 `entity_master`。

```bash
supplystrata entity lookup "ARM HOLDINGS" --source companies-house --limit 5 --format markdown
supplystrata entity lookup "3M" --source opencorporates --jurisdiction us_mn --format json
```

配置：

- `OPEN_CORPORATES_API_TOKEN`：OpenCorporates 官方 API token
- `COMPANIES_HOUSE_API_KEY`：UK Companies House API key

输出里每个候选都带 `external_id`、管辖区、注册号、状态、地址、历史名/别名和 provenance。CLI 不会自动合并，避免把同名公司误并到已有实体。

要把 lookup 结果进入人工导入队列：

```bash
supplystrata review enqueue entity-source "3M" --source opencorporates --jurisdiction us_mn
supplystrata review next
supplystrata review approve <REV-id> --reviewer <name> --reason "matched official registry"
supplystrata review apply <REV-id> --reviewer <name>
```

### supplystrata entity pending

查看 resolver / apply 阶段留下的未解析实体 surface：

```bash
supplystrata entity pending list --status pending --limit 25
supplystrata entity pending show PND-...
supplystrata entity pending lookup PND-... --source opencorporates --jurisdiction us_mn
```

`pending lookup` 只根据 pending surface 发起外部实体源查询，不自动 enqueue。研究员确认候选方向后，再执行 `review enqueue entity-source "<surface>" ...`。

### supplystrata search `<query>`

简单全文搜索：

- entity 名 / 别名
- evidence cite_text
- chunk text（仅返回元信息，不展示原文段落）

实现使用 Postgres tsvector（MVP 阶段）。

## 状态码与错误

| 退出码 | 含义               |
| ------ | ------------------ |
| 0      | 成功               |
| 1      | 通用错误           |
| 2      | 资源不存在         |
| 3      | 歧义 / 多候选      |
| 4      | 校验失败（参数错） |
| 5      | 网络 / 上游错误    |
| 6      | 数据完整性错误     |
| 7      | 权限 / 法律边界    |

错误消息走 stderr；正常输出走 stdout，方便管道。

## 输出格式约定

### markdown

- 默认包含 EV-xxx / EDGE-xxx / ENT-xxx 的 inline 引用
- ID 用反引号包：`EV-000123`
- 每个 section 用 `## ` 开头
- 不输出无意义的装饰（不要 emoji，不要 ASCII art）

### json

- 严格符合 schema_version
- 输出顶层带 `schema_version` 字段
- 字段顺序按 schema 文档（提高 diff 可读性）
- 未知项一律是 null（不省略字段）

## 可观测性

每条命令记录结构化日志（pino）：

```
{ level:"info", cmd:"company", args:{...}, duration_ms:..., status:"ok" }
```

`--verbose` 提升日志等级到 debug。
`--quiet` 静默 stderr 上的非关键日志。

## 测试

- 黑盒 CLI 测试（基于已 seed 的本地 db）
- 输出 snapshot 测试
- 退出码测试

## 不做的事

- **不**实现交互式 REPL（增加复杂度而无价值）
- **不**自动安装依赖
- **不**直接连远端只读副本（避免泄露）
- **不**支持自动 update（手工 git pull）
