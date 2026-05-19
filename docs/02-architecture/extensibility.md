# Extensibility — 如何扩展系统

"高内聚低耦合"的检验标准是：**接入第二个数据源、加第二种关系、加第二种语言时，不需要改主路径代码**。本文给出几种常见扩展场景的标准操作。

## 扩展场景 1：接入一个新数据源

例：要接入 UN Comtrade（Phase 3，MVP 通过后）。

### 1.1 选择归属位置

不要默认“一个数据源一个 package”。先判断它属于哪种情况：

| 情况                                           | 推荐位置                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| HTML snapshot / 公司 IR / 简单官方网页         | `source-workflows` 内新增 feature，复用 `source-adapter-runtime` |
| 与已有官方披露源同生命周期、同依赖             | 扩展已有 source feature                                          |
| 有独立复杂依赖、独立发布价值或明显不同生命周期 | 才新建独立 package                                               |
| 只产生 observation / lead 的宏观源             | 新增 connector + normalizer，不进入 fact pipeline                |

如果确实需要独立 package，可以使用下面结构：

```
packages/sources/un-comtrade/
├── package.json
├── README.md                            必填：来源 / ToS / rate limit / 已知盲区
├── src/
│   ├── index.ts                         export adapter
│   ├── adapter.ts                       implements SourceAdapter
│   ├── plan.ts                          产生 FetchTask
│   ├── fetch.ts                         拿原始字节
│   ├── normalize.ts                     标准化
│   └── types.ts                         本数据源专属类型
└── tests/
    ├── fixtures/                        保存几份真实 API 响应
    └── adapter.test.ts
```

### 1.2 实现 SourceAdapter

```ts
export const unComtradeAdapter: SourceAdapter<...> = {
  id: "un-comtrade",
  tier: "P1",
  description: "UN Comtrade — country-level trade flows by HS code",
  tos_url: "https://comtradeplus.un.org/...",
  rate_limit: { requests: 1, per_seconds: 1 },
  plan, fetch, normalize,
};
```

HTML snapshot 类来源（公司 IR、年报网页、新闻稿网页）优先用 `defineHtmlSnapshotAdapter()`：

```ts
import { loadEnv } from "@supplystrata/config";
import { createFsSnapshotStore, defineHtmlSnapshotAdapter, type AdapterContext } from "@supplystrata/source-adapter-runtime";

export const companyIrAdapter = defineHtmlSnapshotAdapter<CompanyIrInput>({
  id: "company-ir",
  tier: "P0",
  description: "Company official investor relations pages",
  tos_url: "https://example.com/investors",
  rate_limit: { requests: 1, per_seconds: 3 },
  sourceLabel: "Company IR",
  storagePrefix: "company-ir/example",
  async *plan(input) {
    yield {
      task_id: `company-ir-${input.year}`,
      url: annualReportUrl(input.year),
      expected_format: "html",
      hint: { entity_id: input.entityId, document_type: "annual_report", period: `${input.year}-12-31` }
    };
  },
  async normalize(raw) {
    return normalizeHtmlDocument({ raw, documentType: "annual_report" });
  }
});

export function createCompanyIrAdapterContext(): AdapterContext {
  const env = loadEnv();
  return {
    userAgent: env.SEC_USER_AGENT,
    now: () => new Date(),
    snapshotStore: createFsSnapshotStore(env.OBJECT_STORE_FS_BASE)
  };
}
```

这个工厂统一处理限速、超时抓取、缓存回退、sha256、对象存储落盘和 `RawDocument` 元数据，避免新 adapter 复制旧 adapter 的实现细节。宿主应用可以传入自己的 `snapshotStore`，不需要使用本地文件系统。

### 1.3 在 source registry 注册

`packages/pipeline/src/registry.ts`：

```ts
import { unComtradeAdapter } from "@supplystrata/source-un-comtrade";
type RegisteredSourceAdapter = SourceAdapter<unknown, unknown, unknown>;

export const sourceRegistry: Record<string, RegisteredSourceAdapter> = {
  ...,
  "un-comtrade": unComtradeAdapter,
};
```

### 1.4 写法律/ToS 评估

在 [docs/09-risks-compliance/legal-tos.md](../09-risks-compliance/legal-tos.md) 里加一条记录。

### 1.5 加抽取规则（如果产生新关系语义）

在 `packages/relation-extractor/rule/` 里加一条：

```ts
export const tradeFlowMacroExtractor: RelationExtractor = {
  id: "trade.macro.country-flow",
  priority: 30,
  relation_types: ["TRADE_FLOW"],
  extract: async function* (doc, ctx) {
    /* ... */
  }
};
```

并在 [evidence-model.md](../03-data-model/evidence-model.md) 里给该来源类型一个等级映射（Comtrade 单独使用一般 Level 2-3）。

### 1.6 测试与文档

- adapter 单元测试（fixture-based，至少 5 条）
- 在 [04-data-sources/source-registry.md](../04-data-sources/source-registry.md) 表格里加一行
- 写一份 README 到 `packages/sources/un-comtrade/README.md`

### 1.7 PR 模板要求

- 必须包含 `tests/fixtures/` 真实样本
- 必须列明已知盲区与 false-positive 风险
- 必须更新 source-registry 文档

**主路径代码不变**：pipeline / scorer / graph-builder 不动。

### 1.8 接入新的供应商名单 PDF

如果新来源是品牌或公司公开的 supplier list / supplier responsibility PDF，不要复制 `apple-suppliers` 的表格解析逻辑。标准做法是：

1. 新建 `packages/sources/<buyer>-suppliers/`，只负责 URL、ToS、缓存路径和 source-specific header/footnote 规则。
2. PDF 文本提取复用 `@supplystrata/parsers-pdf`。
3. 固定宽度表格候选解析复用 `@supplystrata/supplier-list`。
4. 输出统一的 review CSV 字段：`buyer_entity_id / buyer_name / supplier_name / location_text / country_or_region / source_row_text / normalized_record_text / relation_hint / facility_relation_hint / source_adapter_id`。
5. 所有候选默认 `needs_review=true`，人工确认前不进入 Postgres / Neo4j。

这样 MVP 用 Apple 做测试样例，但系统语义仍是“任意 buyer 的官方供应商名单半自动候选流”。

## 外部实体源扩展

OpenCorporates / Companies House 这类源不产生供应链边，而是产生 `EntitySourceCandidate`。实现约束：

- adapter 独立放在 `packages/sources/<adapter-id>`，只负责官方 API 查询、限速元数据、原始 JSON 落对象存储和候选标准化
- 公共候选结构在 `@supplystrata/entity-source`，供 CLI、pipeline、未来桌面端 agent 复用
- pipeline 暴露 `lookupEntitySourceCandidates`，返回候选列表和错误，不直接写 `entity_master`
- 真正合并 identifier / alias 必须走显式 review/import 流程，避免同名公司 false-merge

---

## 扩展场景 1.9：新增关系强度规则

关系强度不是事实边字段，新增规则时不要改 `edges` schema，也不要改 evidence scoring。

标准位置：

```text
packages/evidence-maintenance/src/index.ts
  inferEdgeStrengthDrafts()
```

规则要求：

- 输入只能是已审核或规则确认的 Level 4/5 fact edge 与 primary evidence。
- 必须能从原文 `cite_text` 中确定性解释，且文本必须命名 counterparty。
- `share` 必须有明确百分比或数值；匿名 customer concentration 只能生成 observation 或 unknown。
- `dependency / capacity / qualitative` 必须来自明确措辞，例如 single-source、capacity reservation、strategic supplier。
- 无法判断时新增或保留 explicit unknown，不允许 fallback 成默认强度。
- 新规则必须补 unit test，至少包含一个正例和一个匿名/含糊反例。

---

## 扩展场景 2：加一种新关系类型

例：要加 `OPERATES_DATA_CENTER_AT`。

### 2.1 在 core 注册

`packages/core/src/relations.ts`：

```ts
export const RELATION_TYPES = [
  "BUYS_FROM", "SUPPLIES_TO", "USES_FOUNDRY", ...,
  "OPERATES_DATA_CENTER_AT",
] as const;
export type RelationType = typeof RELATION_TYPES[number];
```

### 2.2 在 relation-model.md 写语义定义

在 [03-data-model/relation-model.md](../03-data-model/relation-model.md) 加：

- 主体类型 / 客体类型
- 必要字段（如 location）
- 例子（含正/反例）

### 2.3 加抽取器 + 评级规则

如普通规则。

### 2.4 评级规则更新

在 evidence-scorer 里加该关系类型的特殊规则（如果有）。例如：政府环评公告作为 Level 4。

### 2.5 输出 schema 不变

因为 SupplyEdge 已经 generic over `RelationType`。

---

## 扩展场景 3：加一种文档类型

例：要解析 Earnings Call Transcript。

### 3.1 注册 document_type

在 `packages/core/src/document-types.ts` 加：

```ts
export const DOCUMENT_TYPES = [..., "earnings_call_transcript"] as const;
```

### 3.2 更新 parser 路由

`packages/parsers/router.ts`：

```ts
if (doc.document_type === "earnings_call_transcript") return earningsCallParser;
```

### 3.3 加专用切分策略

Earnings call 通常以 speaker 为单位，需要专门 chunk。

### 3.4 加抽取规则

针对 Q&A section 的语言模式（如 "the largest customer accounted for X%"）。

### 3.5 评级

通常 Earnings Call 是 Level 4（管理层口头披露 + 公司官方记录）。

---

## 扩展场景 4：接入 Python sidecar

例：要用 arelle 解析完整 XBRL。

### 4.1 在 sidecars/ 起新项目

```
sidecars/xbrl-py/
├── pyproject.toml
├── README.md
├── src/main.py                          stdin/stdout JSON Lines server
└── tests/
```

### 4.2 通信协议

JSON Lines：

```
input  : { "request_id": "uuid", "op": "parse_xbrl", "path": "/abs/path/to/file" }
output : { "request_id": "uuid", "ok": true, "data": {...} }
output : { "request_id": "uuid", "ok": false, "error": {...} }
```

### 4.3 TS 端封装

`packages/parsers/xbrl/src/index.ts` 封装为 Promise API；进程管理用 `spawn` + 单例 + 健康检查。

### 4.4 失败降级

Sidecar 不可用时，TS 端不能 crash，应该：

- 标记文档 `xbrl_parse_status = "skipped_sidecar_unavailable"`
- 用降级方案（如只读 SEC company facts JSON）

---

## 扩展场景 5：加一种语言

例：处理日文 IR 文件。

### 5.1 字符串规范化

`packages/core/src/text/normalize.ts` 加 NFKC + 全角转半角。

### 5.2 EntityResolver 别名表加日文别名

`seeds/aliases.csv` 加 language="ja"。

### 5.3 抽取器加语言变体

Rule 抽取器多写一份日文模式；LLM 抽取器无需改（LLM 跨语言）。

### 5.4 验收

加 200 条 golden-set 日文样本，测量解析 / 抽取 / 实体消歧准确率。

---

## 扩展场景 6：加一个新的输出 renderer

例：要支持导出 GEXF（图谱可交换格式）给 Gephi 用。

### 6.1 在 packages/render/ 加 gexf renderer

实现 `Renderer<GraphSubset>`。

### 6.2 CLI 加命令

```
supplystrata graph export <scope> --format gexf
```

### 6.3 不需要触碰任何上游

输出层与抽取/评级/图谱完全解耦。

---

## 扩展不支持的场景（明确写出来）

| 想做                                    | 明确不支持的原因                                  |
| --------------------------------------- | ------------------------------------------------- |
| 改证据等级语义（如新增 Level 6）        | 等级是核心契约；要改必须开 ADR + 全量重评级       |
| 引入"无 cite_text 的关系"               | 系统的可信度根基；任何 PR 加这种 path 直接 reject |
| 让 source adapter 直接写 Neo4j          | 破坏数据流单向性                                  |
| 让前端直接读 Neo4j 而不过 Postgres 证据 | 失去可追溯性                                      |
| 多租户/权限隔离                         | MVP 阶段非目标，要做需要重新设计 storage layer    |

## 接入新数据源的检查清单（PR Checklist）

```
[ ] 新 package 路径正确，命名规则一致
[ ] 实现 SourceAdapter 接口完整
[ ] tos_url + rate_limit 已填
[ ] 至少 5 条 fixture 测试通过
[ ] 已在 packages/pipeline/src/registry.ts 注册
[ ] 已在 docs/04-data-sources/source-registry.md 表格更新
[ ] 已在 docs/09-risks-compliance/legal-tos.md 加条目
[ ] 已为该数据源添加证据等级映射规则（在 evidence-scorer 中）
[ ] 已在 README 中说明已知盲区与 false-positive 风险
[ ] CI: dependency-cruiser 通过（无反向依赖）
[ ] CI: type-check 通过
```
