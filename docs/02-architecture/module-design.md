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
│   ├── db/                                 # Postgres schema / migration / documents / query repositories
│   ├── graph/                              # Neo4j adapter
│   ├── object-store/                       # 抽象的对象存储（本地FS / MinIO）
│   ├── source-adapter-spec/                # SourceAdapter 接口契约
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
│   ├── signal-extractor/                   # 官方披露 signal 抽取；不写图、不评级
│   ├── graph-builder/
│   ├── llm-bridge/
│   ├── pipeline/                           # 编排；Phase 3 起再接 pg-boss 队列
│   ├── sources/
│   │   ├── sec-edgar/
│   │   ├── company-ir/
│   │   ├── apple-suppliers/
│   │   ├── opencorporates/
│   │   └── companies-house/
│   └── render/                             # markdown / json 输出
├── apps/
│   ├── cli/                                # supplystrata 命令
│   └── worker/                             # 后台抽取 worker
└── sidecars/
    └── xbrl-py/                            # Python: arelle / sec-api 适配
```

每个 `packages/*` 都有独立 `package.json`、独立 `tsconfig.json`、独立 README。

## 依赖方向（必须严格遵守）

```
core   ← 几乎所有 package（纯类型/纯函数，无顶层 IO 副作用）
config ← 需要读取环境变量的基础设施包显式消费
observability ← pipeline / graph-builder 等执行层显式消费
db     ← 仅 pipeline / repos 消费方
graph  ← 仅 graph-builder / render 消费方
parsers/* ← sources/* 与 relation-extractor 消费
sources/* ← pipeline 消费
relation-extractor ← pipeline 消费
signal-extractor ← pipeline / preview 消费；只产出官方披露 signal，不写入事实图
entity-resolver  ← pipeline / sources / extractor / graph-builder 消费
evidence-scorer  ← graph-builder 消费
llm-bridge ← relation-extractor/llm + entity-resolver 消费
render ← apps/cli 消费
```

**禁止反向依赖**。例如 `core` 不能依赖 `db`、`sources/*` 不能直接依赖 `graph`。
CI 里加 dependency-cruiser 校验。

`core` 必须保持纯净：不得读取 `.env`、不得实例化 logger、不得封装网络请求、不得访问文件系统。配置读取放在 `@supplystrata/config`；日志放在 `@supplystrata/observability`；source 抓取工具放在 `@supplystrata/source-adapter-spec` 的 adapter 工具层。

`db` 的包入口只做稳定 re-export，内部按职责拆分：`client` 负责连接与 migration 调用，`seed` 负责 CSV seed 与必要的数据回填，`documents` 负责 normalized document / chunk / review queue 写入，`pending` 负责待解析实体，`query` 负责边、证据、unknown map 的只读查询。新增仓储函数必须优先落在对应职责文件中，避免重新膨胀成单文件数据库工具箱。

`pipeline` 只做编排：抓取、标准化、调用 extractor/scorer/resolver/builder、记录 source observation。官方披露 signal 抽取放在 `@supplystrata/signal-extractor`，供应链事实关系抽取放在 `relation-extractor`。pipeline 不直接维护公司名单、组件名单或行业启发式。

`relation-extractor/rule` 的 counterparty / component 识别模式放在 `patterns.ts`。新增公司、组件、制造服务供应商时优先扩展模式数据；只有新增一种抽取语义时才修改主抽取流程。

`data-quality` 通过 `DATA_QUALITY_RULES` 注册规则。全局规则和实体专用规则分组注册，避免在 `runDataQualityChecks()` 中继续堆业务特例。

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
- adapter **必须**声明 `rate_limit`，并通过 `createRateLimitedSourceAdapter()` 导出统一限速后的实例；pipeline / source monitor 不再各自实现限速。
- HTML snapshot 类数据源优先使用 `defineHtmlSnapshotAdapter()`，避免每个 IR/官网源重复实现 fetch、缓存回退、对象存储落盘和 `RawDocument` 组装。单个 adapter 只声明 URL 计划、source metadata、storage prefix 和 normalize 策略。

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
  score(candidate: CandidateRelation, doc: NormalizedDocument): Promise<ScoringResult>;
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
- 评级公式必须可重现（输入相同输出相同），不允许引入时间因素

### 5. GraphBuilder

```ts
export interface GraphBuilder {
  apply(approved: ApprovedCandidate): Promise<ApplyResult>;
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
