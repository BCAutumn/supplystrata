# Module Design — 模块拆分与接口契约

"高内聚低耦合"必须落到接口上才有意义。下面给出 MVP 的包划分与每个包对外暴露的接口契约。一切细节调整必须保持这些接口稳定。

## Monorepo 包结构

使用 pnpm workspaces。决议见 [ADR-004](../10-decisions/ADR-004-monorepo-structure.md)。

```
supplystrata/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── docker-compose.yml
├── docs/                                   # 本目录
├── seeds/
│   ├── entities.csv
│   ├── aliases.csv
│   ├── components.csv
│   └── hs-codes.csv
├── data/
│   ├── raw/                                # 原始 PDF/HTML/JSON
│   └── tmp/
├── packages/
│   ├── core/                               # 纯领域类型 / IDs / 领域纯函数
│   ├── config/                             # 环境变量 schema / .env 显式加载
│   ├── observability/                      # Logger 接口与 pino 默认实现
│   ├── db/                                 # DatabaseStore 接口 + Postgres adapter + query repositories
│   ├── component-context/                  # 组件上游研究 catalog；只产 lead，不产事实边
│   ├── source-plan/                        # 二/三级链路的免费数据源规划；只产计划，不抓取/落库
│   ├── graph-store/                        # GraphStore 接口；图投影后端的稳定边界
│   ├── graph/                              # Neo4j GraphStore adapter
│   ├── object-store/                       # 抽象的对象存储（本地FS / MinIO）
│   ├── source-adapter-spec/                # SourceAdapter 接口契约
│   ├── source-adapter-runtime/             # source adapter 限速、fetch、缓存与 snapshot 工厂
│   ├── source-connectors/                  # source check target runner 注册与配置校验
│   ├── source-management/                  # 数据源统一管理面：registry + connector + 用户配置校验
│   ├── source-workflows/                   # 具体免费源的抓取/预览/监控 connector 编排
│   ├── parsers/
│   │   ├── html/
│   │   ├── pdf/
│   │   ├── xbrl/                           # Phase 0-2 读 company facts；Phase 3 起包装 Python sidecar
│   │   ├── csv/
│   │   └── excel/
│   ├── entity-resolver/
│   ├── relation-extractor/
│   │   ├── rule/
│   │   ├── llm/
│   │   └── corroborator/
│   ├── evidence-scorer/
│   ├── evidence-maintenance/             # evidence trace / intelligence context 等 truth-store 维护 use-case
│   ├── signal-extractor/                   # 官方披露 signal 抽取；不写图、不评级
│   ├── observation-extractor/              # 官方披露 observation 草稿；不写图、不产事实边
│   ├── observation-store/                  # observation / lead 幂等写入边界
│   ├── graph-builder/
│   ├── llm-bridge/
│   ├── pipeline/                           # normalized document engine；source-check 队列已在 monitor/workflows 层
│   ├── sources/
│   │   ├── sec-edgar/
│   │   ├── company-ir/
│   │   ├── apple-suppliers/
│   │   ├── opencorporates/
│   │   └── companies-house/
│   ├── runtime-profile/                    # 无 Docker / 嵌入式运行形态的纯判断模型
│   └── render/                             # markdown / json 输出
├── apps/
│   ├── cli/                                # supplystrata 命令
│   └── worker/                             # 常驻 source-check worker；复用 source-workflows，不写业务规则
└── sidecars/
    └── xbrl-py/                            # Python: arelle / sec-api 适配
```

每个 `packages/*` 都有独立 `package.json`、独立 `tsconfig.json`、独立 README。包不是越细越好：只有当一个模块有清晰的发布边界、独立依赖、独立生命周期或需要被宿主 app 单独消费时，才保持独立 package。薄壳包、只做一两个函数转发的包、同一业务 domain 内高度共同变更的包，应优先合并到同一 domain package 的 feature 目录中。

## 包合并策略

当前 `packages/` 数量已经偏多，后续重构按下面规则收敛：

| 候选                                                                 | 处理方向                                                                                            | 原因                                                                                                       |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `packages/sources/asml-ir` / `samsung-ir` / `skhynix-ir` / `tsmc-ir` | 已合并到 `packages/source-workflows/src/official-ir-adapters.ts`                                    | 原包都是薄 HTML snapshot adapter 壳，依赖相同、生命周期相同、只被 official IR workflow 消费                |
| `source-connectors` / `source-management` / `source-workflows`       | 保留短期边界，后续评估合并为 `source-workflows` 下的 `features/connectors` 与 `features/management` | 三者都服务“可配置数据源管理”，共同变更概率高                                                               |
| `observation-store` / `observation-extractor`                        | 暂不合并                                                                                            | 一个是写入边界，一个是抽取规则；生命周期不同                                                               |
| `chain-view` / `chain-view-builder`                                  | 暂不合并                                                                                            | `chain-view` 必须保持纯 DTO，builder 可依赖 DB；这是有意防腐                                               |
| `graph-store` / `graph`                                              | 暂不合并                                                                                            | `graph-store` 是可插拔接口，`graph` 是 Neo4j adapter                                                       |
| `research-pack` / `workbench-export`                                 | 暂不合并                                                                                            | 前者是研究目录产物编排，后者是稳定 JSON 契约                                                               |
| `evidence-maintenance`                                               | 暂保留独立，后续观察是否并入 `db` 的 maintenance feature 或 research workflow                       | 目前承载可重复维护任务，会写 intelligence / risk 派生上下文但不写事实边；与只读 card/research 输出职责不同 |

轻量审计结论：

- 必须保留独立：`graph-store` / `graph`，因为前者是 port、后者是 Neo4j adapter；`chain-view` / `chain-view-builder`，因为前者是纯 DTO、后者可依赖 DB；`workbench-export` / `research-pack`，因为前者是稳定 JSON 契约，后者是研究目录编排；`render`，因为它必须保持纯格式化。
- 已完成第一轮合并：四个官方 IR HTML adapter 包 `sources/asml-ir`、`sources/samsung-ir`、`sources/skhynix-ir`、`sources/tsmc-ir` 已收敛到 `source-workflows` 的 official IR adapter 文件。外部仍使用 `tsmc-ir`、`samsung-ir`、`skhynix-ir`、`asml-ir` adapter id 和 `official-html-disclosure` connector 契约，避免影响监控目标、source plan 和 research-pack 输出。
- 可以继续观察合并：`source-connectors` / `source-management` / `source-workflows` 都围绕 source domain 的连接器、配置和运行编排，后续可收敛到 `source-workflows/features/connectors` 与 `source-workflows/features/management`，但需要等 official IR 薄包合并稳定后再动，避免一次重构跨太多边界。
- 暂不建议合并：`observation-store` / `observation-extractor`，一个是写入边界，一个是抽取规则；`evidence-maintenance` / `db`，前者包含维护编排和方法学规则，后者应保持 repository / migration 边界。

合并包前必须先做依赖检查和调用点盘点，避免把原本清晰的 port / adapter 边界揉成新的上帝包。

## 依赖方向（必须严格遵守）

```
core   ← 几乎所有 package（纯类型/纯函数，无顶层 IO 副作用）
config ← 需要读取环境变量的基础设施包显式消费
observability ← pipeline / graph-builder 等执行层显式消费
db     ← 仅 pipeline / repos 消费方；执行层依赖 DatabaseStore，不直接依赖 pg.Pool
graph-store ← graph-builder / pipeline 消费；只包含接口，不绑定 Neo4j
graph  ← CLI graph 命令消费；当前内置 Neo4j adapter
parsers/* ← sources/* 与 relation-extractor 消费
sources/* ← source-workflows 消费；不得被 pipeline 直接消费
relation-extractor ← pipeline 消费
signal-extractor ← source-workflows / preview 消费；只产出官方披露 signal，不写入事实图
observation-extractor ← pipeline 消费；只产官方披露 observation draft，不写库、不写图
observation-store ← pipeline / 后续 source monitor 消费；只写 observations / lead_observations
source-plan ← CLI / 后续 workbench 消费；读取 source-registry + component-context + 调用方传入的 target profile official source hints，只输出 source plan
source-connectors ← source-workflows 消费；集中注册 source check target runner，不抓源、不写库
source-management ← CLI / 后续 host app 消费；读取 source-registry + source-connectors 能力，只做 catalog 与配置校验
evidence-maintenance ← CLI / research-pack 消费；只做 truth-store 维护编排，可写 evidence 派生字段、edge_strength、edge_freshness、unknown、risk_views/risk_metrics、risk metric semantic changes、edge calibration runs、alert_candidates，不写 fact edge；alert 状态维护留在 db repository，因为它是 alert 自身生命周期，不属于信号生成规则
card-builder ← apps/cli / 后续 API 消费；负责从 DbClient 组装 CompanyCard / ComponentCard / ChainCard / EvidenceCard / UnknownMap DTO
workbench-export ← CLI / research-pack / 后续 host app 消费；组装稳定 Workbench JSON 契约，包含事实边、claim、evidence、unknown、source health、changes、attention queue、review queue 摘要和派生 intelligence context；`review_queue` 只读，不修改 review 状态、不写事实边
research-pack ← CLI / 后续 host app 消费；编排已有 truth-store 数据，导出 workbench、cards、source plan、quality report、question/observation/official-disclosure readiness、investigation backlog 和 filtered corroboration source plan，不抓新源、不写事实边；official-disclosure readiness 可接收显式 target node set，也会自动选择内置 `ai-compute-memory.v0` 研究 target profile，让 Gate 1 核心节点覆盖按目标清单衡量，而不是按当前 pack 可见节点猜测；逐 expected source 覆盖会把 profile 期待来源拆成已覆盖、已同步/可同步、仅计划、connector 可用但未接线、registry 已登记但未实现、未映射等状态；`official-disclosure-signal-correlation` 是 research-pack 内部纯算法模块，只把 review-only 官方 signal 和 edge-level corroboration queue 做确定性关联提示，不读库、不写 review、不把 signal 升级成 corroboration；corroboration-source-plan 只把逐 edge 二源检查 target 过滤成 source-management 可消费的标准 source-plan 子集，不运行 adapter、不生成事实；profile expansion candidates 只进 backlog/review，不写事实边
runtime-profile ← CLI / 后续 host app 消费；只评估 preview / snapshot / truth store / graph projection 运行形态，不读文件、不连数据库
entity-resolver  ← pipeline / sources / extractor / graph-builder 消费
evidence-scorer  ← graph-builder 消费
llm-bridge ← relation-extractor/llm + entity-resolver 消费
render ← apps/cli / 后续 API 消费；只把 DTO 渲染成 Markdown 或 JSON，不查库、不抓源、不做业务判断
```

**禁止反向依赖**。例如 `core` 不能依赖 `db`、`sources/*` 不能直接依赖 `graph`。`graph-builder` 只能依赖 `graph-store` 接口，不能依赖具体 Neo4j adapter。
CI 里加 dependency-cruiser 校验。

`core` 必须保持纯净：不得读取 `.env`、不得实例化 logger、不得封装网络请求、不得访问文件系统。配置读取放在 `@supplystrata/config`；日志放在 `@supplystrata/observability`；source 抓取工具放在 `@supplystrata/source-adapter-runtime` 的 adapter 运行时层。

`db` 的包入口只做稳定 re-export，内部按职责拆分：`client` 负责 `DatabaseStore` 接口、Postgres adapter 与 migration 调用，`seed` 负责 CSV seed 与必要的数据回填，`documents` 负责 normalized document / chunk / review queue 写入，`pending` 负责待解析实体，`query` 负责边、证据、unknown map 的只读查询。新增仓储函数必须优先落在对应职责文件中，避免重新膨胀成单文件数据库工具箱。

`pipeline` 是 normalized document engine：它接收已经标准化的 `NormalizedDocument`，调用 extractor/scorer/resolver/graph-builder，记录文档 observation，并把官方披露 observation draft 交给 `observation-store` 幂等写入。内部按职责拆分：`run.ts` 处理 normalized document 到事实边的纵向链路，`document-observations.ts` 处理文档监控和 observation 入库，`citation-location.ts` 负责把候选证据精确映射到唯一持久化 chunk。pipeline 不直接依赖 `sources/*`，也不直接维护具体数据源的抓取、预览、实体 registry 查询、Apple Supplier List enqueue 或 source check connector registry。

`source-workflows` 是具体免费/公开源的 use-case 编排层：SEC EDGAR 纵向切片、Apple Supplier List review enqueue、GLEIF / Companies House / OpenCorporates entity lookup、官方 IR preview、OpenDART disclosure list monitor、EDINET daily filings monitor、Census / OSH source check connector 都放在这里。这里的文件和 adapter id 表示“来源发布方或来源类别”，不是“被研究公司”。例如 `apple-suppliers` 是 Apple 官方 Supplier List 这个特殊 PDF 来源；研究 NVIDIA、AMD、Tesla 或任意上市公司时，入口仍应是 `entity resolver -> source-plan -> SEC/监管披露/company IR discovery -> review/backlog`，不能新增 `nvidia-suppliers.ts`、`tesla-suppliers.ts` 这类公司专属工作流。GLEIF 是跨市场法人标识锚点，先作为 entity-source feature 放在 `source-workflows`，不新增薄包；DART / EDINET / TWSE / HKEX 这类监管源优先复用同一条 source-check 骨架和统一 target config 契约，而不是各自重做实体消歧或调度分支。它可以依赖 `sources/*`、`source-connectors` 和 `pipeline`，但只把标准化文档交给 pipeline 内核；`runDueSourceChecks()` 只负责 enqueue / claim `source_check_jobs` 并分发 connector，持续监控 cadence / jitter / retry/backoff 只能来自 source policy config，后续常驻 worker 也复用这条路径。新增 Open Supply Hub、Comtrade 等源时应扩展 `source-workflows` 或独立 feature workflow 包，而不是改 `pipeline`。

`source-plan` 是二/三级链路扩源的边界：它把 `component-context` 里的上游 lead 映射到 `source-registry` 里的免费/公开数据源，并标明 `edge / observation / lead / entity` 输出层与自动化策略。它也可以消费 research target profile 传入的官方源 hints，把已有 SEC CIK 或已注册官方 IR connector 转成 node-specific runnable target suggestions；没有 target config 或 connector 的来源只能停留为 coverage gap。profile 是研究目标和验收锚点，不是每家公司一套代码；如果用户输入任意上市公司，后端应优先从 entity / registry / regulator metadata 推导可运行 target，缺口进入 backlog，而不是要求用户手写 profile 或让开发者新增公司文件。它不抓取、不解析、不写 Postgres，也不允许把 Comtrade/AIS/能源/新闻这类弱源升级成事实边。

`source-connectors` 是 source monitoring 执行层的分发边界：它只定义 `SourceCheckConnector`、connector key、target config 校验和 unsupported target 错误。具体源例如 SEC EDGAR 在 `source-workflows` 侧提供 connector 实现；`sources check` 和 `run-due` 都只走 connector registry，不在 CLI 或调度入口继续写 `if source_adapter_id === ...`。以后新增 DART、EDINET、OSH、Comtrade 等免费源时，应新增 connector 并注册，而不是改 CLI 或调度主循环。

`source-management` 是统一数据源管理面：它把 `source-registry` 的权威来源清单、`source-connectors` 的可运行 target kind、connector 声明的 `target_config` 字段契约、外部 `source policy` 配置校验收口到一个纯模块。它不抓取、不写库、不读取环境变量；CLI、未来 TS 桌面端或 agent 宿主可以先调用它展示“哪些源可配置、哪些字段必填、哪些只登记未实现、哪些需要 key、哪些只能手工”，再决定是否同步到 Postgres。用户自定义 source policy 必须先通过这个模块校验，避免把不存在的 source/target 或字段错误的 target_config 写进调度表。

`evidence-maintenance` 是 truth-store 维护型 use-case 层。第一版包含 evidence trace backfill、edge intelligence refresh 和 single-source disposition unknown materialization。它可以消费 `db` repository，并按方法学写入 `edge_strength_estimates`、`edge_freshness` 和 explicit unknown；`official-disclosure-readiness` 产生的 `proposed_unknown` 只有通过这里的受控用例、且默认确认目标 edge 仍为 `current` 后，才会落到 `unknown_items`。它不得写 `edges`、不得提升 `evidence_level`、不得把 LLM / observation / lead 结果包装成事实关系。CLI 只能作为薄入口调用它，`research-pack` 可以在导出前调用它让研究输出带上最新派生上下文。

`apps/worker` 是常驻后台进程入口。当前只运行 source-check worker loop：解析运行参数、连接 `DatabaseStore`、处理 SIGINT/SIGTERM，并循环调用 `source-workflows.runDueSourceChecks()`。它不得重新实现 due target 查询、connector 分发、retry/backoff 或 alert 规则；这些能力必须留在 domain/use-case package 中，保证 CLI、worker 和未来宿主 app 共享同一条业务路径。

`relation-extractor/rule` 的 counterparty / component 识别模式放在 `patterns.ts`。新增公司、组件、制造服务供应商时优先扩展模式数据；只有新增一种抽取语义时才修改主抽取流程。

`data-quality` 通过 `DATA_QUALITY_RULES` 注册规则。全局规则和实体专用规则分组注册，避免在 `runDataQualityChecks()` 中继续堆业务特例。

`card-builder` 负责把 `DbClient`、chain-view-builder、query helpers 聚合成稳定 card DTO，例如 `loadCompanyCard()`、`loadComponentCard()`、`loadChainCard()`、`loadEvidenceCard()`、`loadUnknownMap()`。它是 CLI、后续只读 API 与工作台之间的 use-case 层，允许依赖 `db`，但不得依赖具体图后端。

`render` 只负责把已经聚合好的 card/view model 渲染成 Markdown 或 JSON。它不得接收 `DbClient`，不得 import `db` / `pg` / graph backend，也不得承载查询、抓取或业务判断。CLI 必须显式调用 `card-builder` 后再调用纯 formatter，例如 `renderCompanyCard(model, format)`。迁移到 API / TypeScript + Canvas 工作台时，可以复用同一批 DTO，而不是复用 Markdown renderer。

## 关键接口契约

### 1. SourceAdapter（最重要，决定能不能扩展）

所有数据源必须实现这一个接口。`packages/source-adapter-spec/src/index.ts`：

```ts
export interface SourceAdapter<TFetchInput, TRawDoc, TNormalizedDoc> {
  readonly id: string; // "sec-edgar", "tsmc-ir"
  readonly tier: "P0" | "P1" | "P2";
  readonly description: string;
  readonly tos_url: string; // 该数据源 ToS 链接
  readonly rate_limit: { requests: number; per_seconds: number };

  /** 计划本次要抓什么 */
  plan(input: TFetchInput, ctx: AdapterContext): AsyncIterable<FetchTask>;

  /** 抓取一个具体任务的原始字节 */
  fetch(task: FetchTask, ctx: AdapterContext): Promise<RawDocument<TRawDoc>>;

  /** 把原始字节标准化为系统通用文档；必须产出 text + chunks，不允许只返回元数据壳 */
  normalize(raw: RawDocument<TRawDoc>, ctx: AdapterContext): Promise<NormalizedDocument>;
}

export interface FetchTask {
  task_id: string;
  url: string;
  params?: Record<string, unknown>;
  expected_format: "html" | "pdf" | "json" | "csv" | "xbrl" | "excel";
  hint?: { entity_id?: string; document_type?: string; period?: string };
}

export interface RawDocument<TBody = unknown> {
  doc_id: string; // DOC-uuid
  source_adapter_id: string;
  url: string;
  fetched_at: string;
  bytes_sha256: string;
  storage_key: string; // 在对象存储中的 key
  body: TBody; // 解析前的中间表示，可选
  metadata: Record<string, unknown>;
}

export interface NormalizedDocument {
  doc_id: string;
  source_adapter_id: string;
  document_type: string; // "10-K", "earnings_call", "supplier_list"
  primary_entity_id?: string; // 已解析的目标实体
  language: string; // "en", "zh-Hans", "ko"
  fetched_at: string;
  source_date?: string; // 文档自身的发布日期
  text: string; // 清洗后的全文
  chunks: DocumentChunk[]; // 已切分
  tables?: ParsedTable[]; // 表格抽取
  attachments?: { storage_key: string; mime: string }[];
}

export interface DocumentChunk {
  chunk_id: string;
  text: string;
  locator: string; // 页码/章节/csspath
  embedding?: number[]; // 可选
}
```

约束：

- adapter **不直接**写入 Postgres / Neo4j；写入由 pipeline 统一处理
- adapter **不直接**解析关系或写实体主表；实体消歧由 entity-resolver / review apply 阶段处理
- adapter 的 `normalize()` 必须返回完整 `NormalizedDocument`。HTML / PDF / text 用 parser 包清洗切块；结构化 JSON 源也要生成可审计文本摘要和 chunks。
- adapter **必须**声明 `rate_limit`，并通过 `@supplystrata/source-adapter-runtime` 的 `createRateLimitedSourceAdapter()` 导出统一限速后的实例；pipeline / source monitor 不再各自实现限速。
- adapter 原始响应落盘必须通过 `AdapterContext.snapshotStore` 或 adapter definition 显式注入；source adapter 不直接依赖具体对象存储实现。默认本地开发使用 `createFsSnapshotStore(env.OBJECT_STORE_FS_BASE)`，宿主 App 可以替换为自己的存储。
- HTML snapshot 类数据源优先使用 `@supplystrata/source-adapter-runtime` 的 `defineHtmlSnapshotAdapter()`，避免每个 IR/官网源重复实现 fetch、缓存回退、sha256、落盘和 `RawDocument` 组装。单个 adapter 只声明 URL 计划、source metadata、storage prefix 和 normalize 策略。
- 非 HTML 源使用 `@supplystrata/source-adapter-runtime` 的 `persistRawDocumentSnapshot()` 统一完成 sha256、落盘和 `RawDocument` 组装；adapter 自己只保留鉴权、URL、storage key 规则和 metadata。这样后续接 DART / EDINET / AIS / procurement 时不会复制同一段原始文档持久化逻辑。

### 2. EntityResolver

`packages/entity-resolver/src/index.ts`：

```ts
export interface EntityResolver {
  /** 给定字符串与上下文，返回最可能的实体 ID 与匹配置信度 */
  resolve(input: ResolveInput): Promise<ResolveResult>;

  /** 注册新别名（必须带证据） */
  registerAlias(alias: string, entityId: string, evidence: Provenance): Promise<void>;

  /** 显式拆分错误合并 */
  split(entityId: string, newCanonicals: NewEntitySpec[]): Promise<SplitResult>;
}

export interface ResolveInput {
  surface: string; // 原始字符串
  language?: string;
  context?: {
    // 强烈推荐填
    nearby_text?: string;
    document_type?: string;
    co_mentioned_entities?: string[];
    inferred_country?: string;
    industry_hint?: string;
  };
  identifiers?: { cik?: string; lei?: string; isin?: string; ticker?: string };
}

export interface ResolveResult {
  status: "resolved" | "ambiguous" | "unknown";
  entity_id?: string;
  confidence: number; // 0..1
  candidates?: { entity_id: string; confidence: number; reason: string }[];
  needs_human_review: boolean;
}
```

约束：

- 当 `status === "ambiguous"` 时，调用方**必须**入 review queue，不允许猜
- `unknown` 时入 `pending_entities` 表

### 3. RelationExtractor

```ts
export interface RelationExtractor {
  readonly id: string; // "rule.sec.official-supply-chain"
  readonly priority: number; // 大者先跑
  readonly relation_types: RelationType[];

  extract(doc: NormalizedDocument, ctx: ExtractorContext): AsyncIterable<CandidateRelation>;
}

export interface CandidateRelation {
  subject_resolve: ResolveInput; // 主体（待解析）
  object_resolve: ResolveInput; // 客体（待解析）
  relation: RelationType;
  component?: string;
  cite_text: string; // 原文片段 (>= 30 chars)
  cite_locator: string; // page / section
  validity?: { from?: string; to?: string };
  extractor_id: string;
  raw_evidence_level_hint: 1 | 2 | 3 | 4 | 5;
  raw_confidence_hint: number;
  llm_meta?: { model: string; prompt_hash: string };
}
```

约束：

- 抽取器**只**负责提候选；不写图、不评级（评级在下一步）
- 候选必须挂 `cite_text` —— 没有原文片段一律拒收
- `raw_evidence_level_hint` 是抽取器认为的等级，scorer 可以下调，但不可上调

### 4. EvidenceScorer

```ts
export interface EvidenceScorer {
  score(candidate: CandidateRelation, doc: NormalizedDocument, options?: EvidenceScoringOptions): Promise<ScoringResult>;
}

export interface EvidenceScoringOptions {
  reviewed?: { reviewer: string; reviewed_at: string };
}

export interface ScoringResult {
  evidence_level: 1 | 2 | 3 | 4 | 5;
  confidence: number;
  is_inferred: boolean;
  needs_review: boolean;
  rationale: string; // 简短说明为什么打这个等级
}
```

约束：

- LLM 抽取的候选默认 `needs_review = true`
- 调用方不能手动覆盖 scorer 输出的 `needs_review`；人工审核路径必须通过 `EvidenceScoringOptions.reviewed` 交给 scorer 自己清除 review 标记。
- 评级公式必须可重现（输入相同输出相同），不允许引入时间因素

### 5. GraphBuilder

```ts
export interface GraphBuilder {
  apply(approved: ApprovedCandidate): Promise<ApplyResult>;
  applySqlInTransaction(client: DbTxClient, approved: ApprovedCandidate): Promise<Omit<ApplyResult, "graph_sync">>;
  deprecate(edgeId: string, reason: string, evidence: Provenance): Promise<void>;
  rebuild(): Promise<{ nodes: number; edges: number }>;
}

export interface ApprovedCandidate {
  candidate: CandidateRelation;
  scoring: ScoringResult;
  approved_by: "auto" | { reviewer: string; reviewed_at: string };
}

export interface ApplyResult {
  edge_id: string;
  evidence_id: string;
  change_id: string;
  is_new_edge: boolean;
  graph_sync: { status: "synced" } | { status: "failed"; error_message: string };
}
```

约束：

- 图谱中**不允许物理删除**边；只能 `validity = "deprecated"` + 写 ChangeRecord
- 对相同 `subject + object + relation + component` 的多条 evidence，应当聚合到同一条 edge
- `GraphBuilder.apply()` 适合单条候选；需要把多条 reviewed edge 和 review 状态作为一个原子操作提交时，业务层必须在外层事务里调用 `applySqlInTransaction()`，提交后图投影走 deferred/outbox。
- `applySqlInTransaction(client, approved)` 会把同一个 `DbTxClient` 传给 `EntityResolver.resolve()`，实体解析查询和 edge/evidence 写入共享同一事务快照；不得在同一条应用边流程里混用外部 pool resolver。

### 6. ObjectStore

```ts
export interface ObjectStore {
  put(key: string, body: Uint8Array | NodeJS.ReadableStream, meta?: Record<string, string>): Promise<void>;
  get(key: string): Promise<NodeJS.ReadableStream>;
  exists(key: string): Promise<boolean>;
  url(key: string, expiresInSeconds?: number): Promise<string>;
}
```

MVP 默认实现是本地文件系统（`data/raw/<key>`）。生产可换 MinIO / S3。

### 7. Renderer

```ts
export interface Renderer<T> {
  format: "markdown" | "json";
  render(data: T, opts?: RenderOptions): string;
}

export interface RenderOptions {
  include_inferred?: boolean;
  language?: "en" | "zh";
  schema_version: string;
}
```

约束：

- JSON 输出必须严格符合 [output-spec.md](../01-product/output-spec.md) 的 schema
- Markdown 输出必须保留 EV-xxx / EDGE-xxx 引用，使其可在 IDE / Notion 中跳转

## 包之间禁用的事

| 禁止                                                 | 原因                      |
| ---------------------------------------------------- | ------------------------- |
| `sources/*` 直接读写 Postgres                        | 所有写都过 pipeline       |
| `relation-extractor` 直接调 Neo4j                    | 抽取器只产候选            |
| 任何 package 直接 `import` LLM SDK                   | 必须通过 `llm-bridge`     |
| 任何 package 直接 `process.env.NEO4J_URI` 读环境变量 | 必须通过 `core/config`    |
| 任何 package 自己造 `EV-xxx` ID                      | ID 工厂在 `core/ids`      |
| 在抽取器里写人工 review 业务                         | review 队列由 pipeline 管 |

## 测试边界

- 每个 source adapter 必须有 fixture-based 单元测试（以保存好的原始 HTML/PDF/JSON 做输入）
- Entity Resolver 必须有 golden-set（至少 200 条手工标注的 surface→entity_id）
- Relation Extractor 每条规则必须配至少 3 条 positive + 3 条 negative 样本
- GraphBuilder 必须有"重建"测试：从 Postgres 全量重建 Neo4j，结果与之前一致

详见 [testing-strategy.md](../06-development/testing-strategy.md)。
