# Output Spec — 系统输出规格

MVP 阶段对外的"产品"就是几种**结构化卡片**和它们的 Markdown 渲染。本文档定义这些卡片的契约。任何前端、报告、API、CLI 都必须按这里的 schema 输出。

所有 schema 用 TypeScript / zod 风格表达；落地在 `packages/core/src/output-schemas.ts`。

## 通用字段

```ts
interface Provenance {
  source_type: SourceType;            // 见 glossary.md
  source_name: string;                // e.g. "NVIDIA FY2025 Form 10-K"
  source_url: string;                 // 必填
  source_date: string;                // ISO date
  fetched_at: string;                 // ISO datetime
  evidence_text: string;              // 原文片段, >= 30 chars
  evidence_locator?: string;          // page 12 / section 1A.Risk Factors
}

interface EvidenceRef {
  evidence_id: string;                // EV-000123
  evidence_level: 1 | 2 | 3 | 4 | 5;
  confidence: number;                 // 0..1
  is_inferred: boolean;
  extraction_method: "rule" | "llm" | "manual" | "hybrid";
  last_verified_at: string;
}
```

任何输出中出现"事实性陈述"的位置，必须挂至少一个 `EvidenceRef`，否则不允许出现。

---

## 卡片 1：Company Card（公司供应链卡片）

输入：公司名 / ticker / CIK
输出：该公司**已知一级上游**与**未知项**。

```ts
interface CompanyCard {
  entity_id: string;                  // ENT-000045
  canonical_name: string;             // "NVIDIA Corporation"
  aliases: string[];                  // 已知别名
  identifiers: {
    cik?: string;
    lei?: string;
    isin?: string[];
    ticker?: string[];
  };
  generated_at: string;

  directly_disclosed_upstream: SupplyEdge[];   // Level 4-5
  inferred_upstream: SupplyEdge[];              // Level 1-3 (默认隐藏)
  downstream_customers: SupplyEdge[];           // 反向边

  unknown_map: UnknownItem[];          // 必填，不能为空
  recent_changes: ChangeRecord[];      // 最近 N 天内的变化
  open_questions: string[];            // 研究员标记的待解决问题
}

interface SupplyEdge {
  edge_id: string;
  relation: RelationType;              // BUYS_FROM / USES_FOUNDRY ...
  counterparty_id: string;
  counterparty_name: string;
  component?: string;                  // "memory" / "wafer" / "PCB"
  evidence: EvidenceRef[];             // 至少 1 条
  primary_provenance: Provenance;      // 最强的那条原文证据
  validity: "current" | "historical" | "deprecated";
  effective_period?: { from?: string; to?: string };
}
```

### Markdown 渲染（CLI 默认）

```
# NVIDIA Corporation [ENT-000045]

Aliases: NVIDIA, 英伟达, NVDA
CIK: 1045810  |  Ticker: NVDA  |  LEI: ...

## Directly disclosed upstream (Level 4-5)

- USES_FOUNDRY → TSMC                   [Level 5, conf 0.95]
  Source: NVIDIA FY2025 10-K (2025-02-26)
  "We utilize foundries such as TSMC and Samsung..."
  Evidence: EV-000101

- BUYS_FROM (memory) → SK Hynix         [Level 5, conf 0.93]
  Source: NVIDIA FY2025 10-K (2025-02-26)
  Evidence: EV-000102

...

## Inferred upstream (Level 1-3) — hidden by default

(use `--include-inferred` to show)

## Unknown map

- Exact HBM allocation per quarter
- Customer-specific GPU shipment quantities
- Specific shipping routes / carriers
- Contract pricing
- Internal capacity reservation with TSMC

## Recent changes (last 30 days)

(no high-confidence changes)
```

---

## 卡片 2：Component Card（组件链条卡片）

```ts
interface ComponentCard {
  component: string;                   // "HBM" / "advanced packaging (CoWoS)"
  taxonomy_path: string[];             // ["semiconductor", "memory", "DRAM", "HBM"]
  generated_at: string;

  known_suppliers: SupplyEdge[];       // who supplies this component
  known_consumers: SupplyEdge[];       // who buys this component
  demand_drivers: string[];            // textual, must cite evidence
  supply_constraints: string[];        // textual, must cite evidence
  public_price_signals: PriceSignal[]; // 例：TrendForce 公开新闻摘录
  related_macro_signals: MacroSignal[];

  unknown_map: UnknownItem[];
}

interface PriceSignal {
  description: string;
  direction: "up" | "down" | "stable" | "mixed";
  magnitude_text?: string;             // "+58~63% QoQ"
  observation_window: string;
  source: Provenance;
  is_full_database: false;             // MVP 阶段恒为 false：免费数据没有完整价格库
}
```

---

## 卡片 3：Evidence Card（证据卡片）

```ts
interface EvidenceCard {
  evidence_id: string;
  edges: { edge_id: string; relation: string; subject: string; object: string }[];
  evidence_level: 1 | 2 | 3 | 4 | 5;
  confidence: number;
  is_inferred: boolean;
  extraction_method: "rule" | "llm" | "manual" | "hybrid";
  llm_model?: string;
  llm_prompt_hash?: string;
  reviewer?: string;
  reviewed_at?: string;
  provenance: Provenance;
  superseded_by?: string;              // 后续证据 ID
  notes?: string;
}
```

证据卡片必须可以脱离图谱独立查看。这是审计与可追溯性的核心。

---

## 卡片 4：Unknown Map（未知地图）

```ts
interface UnknownMap {
  scope: { type: "company" | "component" | "topic"; id: string; name: string };
  generated_at: string;
  items: UnknownItem[];
  data_gap_summary: {
    no_public_disclosure: string[];     // 法律/合同上就不公开
    obtainable_but_paid: string[];      // 商业数据库才有
    obtainable_with_effort: string[];   // 努力一下能拿到，待办
    obtainable_inference: string[];     // 可以推断但精度不够
  };
}

interface UnknownItem {
  question: string;                    // "What is NVIDIA's exact HBM allocation per CSP?"
  why_unknown: string;                 // 为什么我们不知道
  blocking_data_source?: string[];     // 拿到哪些源能解锁
  status: "open" | "in_research" | "resolved" | "abandoned";
  proxies?: string[];                  // 不直接能知道，但可以从哪些代理变量推断
}
```

未知地图是本系统的**特色输出**。不能为空。如果一份卡片的 unknown_map 是空的，说明研究员没有诚实评估——这是反模式。

---

## 卡片 5：Change Record（变化记录）

```ts
interface ChangeRecord {
  change_id: string;
  detected_at: string;
  scope: { type: "company" | "component" | "edge"; id: string };
  change_type:
    | "new_edge"
    | "edge_supersession"
    | "evidence_level_changed"
    | "alias_added"
    | "facility_added"
    | "filing_filed";
  before?: unknown;
  after?: unknown;
  evidence: EvidenceRef[];
}
```

任何边的修改必须落 ChangeRecord，且不允许物理删除（用 `validity = "deprecated"` 软失效）。

---

## 卡片 6：Research Report（研究报告）

报告 = 上面卡片的有序组合 + 文字段落。

```ts
interface ResearchReport {
  report_id: string;
  title: string;
  scope: string;
  generated_at: string;
  sections: ReportSection[];
}

interface ReportSection {
  heading: string;
  body_markdown: string;          // 任何陈述句必须 cite EV-xxx
  embedded_cards: (CompanyCard | ComponentCard | UnknownMap | ChangeRecord)[];
}
```

报告输出**只允许**两种格式：Markdown（人读）+ JSON（机读）。MVP 不出 PDF（避免引入 PDF 渲染栈）。

---

## CLI 命令清单（MVP 必备）

```
supplystrata company <name|cik|ticker> [--depth 1|2] [--format markdown|json] [--include-inferred]
supplystrata component <name>           [--format markdown|json]
supplystrata evidence <evidence_id>     [--format markdown|json]
supplystrata unknown-map <scope> <id>   [--format markdown|json]
supplystrata changes --since <ISO_date> [--scope <id>]
supplystrata edge <edge_id>
supplystrata search <query>             # 简单全文搜索
supplystrata preview nvidia             # 无数据库解析预览，适合嵌入式/桌面端
```

非 MVP 命令：

```
supplystrata report build <topic>       # Phase 3
supplystrata graph export --format gexf # Phase 3
```

## 输出原则（不可妥协）

1. **任何"事实性陈述"必须可一跳到原始证据**。Markdown 输出中的 `EV-xxx` 必须可被解析；JSON 输出中的 `evidence_id` 必须能在 `evidence` 表中找到。
2. **所有日期 ISO 格式 + 时区**。
3. **所有 IDs 强类型**（`ENT-`, `EV-`, `EDGE-`, `DOC-`, `CHK-`, `CHG-`, `REV-`, `REJ-`, `PND-`, `UNK-`, `ALIAS-`）。
4. **不允许悄悄失败**。如果某条边的证据缺失，CLI 应当报错，而不是省略。
5. **JSON schema 必须自带版本号**（`schema_version: "1.0.0"`），后续修改 schema 必须 bump。
