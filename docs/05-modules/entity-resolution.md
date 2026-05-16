# Module: Entity Resolution — 实体消歧

`packages/entity-resolver`。系统的地基模块。如果消歧错了，全图都错。

## 目标

给定一段表面字符串（surface）+ 上下文，返回唯一的 `entity_master.entity_id`，或返回 `ambiguous` / `unknown` 让上层处理。

## 输入

```ts
interface ResolveInput {
  surface: string;
  language?: string;
  context?: {
    nearby_text?: string;
    document_type?: string;
    co_mentioned_entities?: string[];     // 同 chunk 中已解析的其他实体
    inferred_country?: string;            // 文档来自哪个国家/语言
    industry_hint?: string;               // 推断的行业
  };
  identifiers?: {
    cik?: string;
    lei?: string;
    isin?: string;
    ticker?: string;
  };
}
```

## 输出

```ts
type ResolveStatus = "resolved" | "ambiguous" | "unknown";

interface ResolveResult {
  status: ResolveStatus;
  entity_id?: string;
  confidence: number;                       // 0..1
  candidates?: { entity_id: string; confidence: number; reason: string }[];
  needs_human_review: boolean;
}
```

`ambiguous`：找到 ≥ 2 个候选，且彼此置信度差 < 0.15 → 不能裁决。
`unknown`：没有任何 alias 命中（surface 是新名字）。

## 算法（按优先级）

### Step 1: Identifier match

如果 input 含 LEI / CIK / ISIN / Ticker 中任一：

- 在 entity_master.identifiers 里精确查找
- 命中 → `status = "resolved"`, `confidence = 1.0`
- 不命中 → 继续

不允许 "差不多 ticker" 模糊匹配。

### Step 2: Strict alias match

```
alias_norm = NFKC(lower(strip(surface)))
```

在 `entity_alias.alias_norm` 上精确匹配。

- 0 命中 → 走 Step 3
- 1 命中 → resolved, confidence 0.95
- 多命中 → 多候选，进 Step 4 上下文消歧

### Step 3: Fuzzy alias match

- 编辑距离 ≤ 2 的别名候选（且原 surface 长度 ≥ 6）
- 输出候选集（最多 5 个），confidence 上限 0.75
- 候选 = 0 → `unknown`，落 `pending_entities`

### Step 4: Context disambiguation

对 Step 2/3 给出的多个候选：

```
score(candidate) =
    base_match_confidence
  + 0.20 if context.inferred_country == candidate.primary_country
  + 0.15 if any(co_mentioned_entities) is known related to candidate (via existing edges)
  + 0.10 if context.industry_hint matches candidate.industry
  + 0.10 if document_type is candidate's IR (e.g. NVIDIA 10-K → ENT-NVIDIA)
  - 0.20 if candidate.status != "active"
```

排序后：

- 最高分 - 次高分 ≥ 0.15 → `resolved` 用最高分候选
- 否则 → `ambiguous`，返回完整候选列表

### Step 5: LLM fallback (可选，受 ADR 控制)

仅当：

- `ambiguous` 且全部候选 confidence ≥ 0.5
- 且开关 `LLM_RESOLVER_ENABLED` 打开

调用 LLM：

```
prompt: |
  在以下上下文中，"<surface>" 最可能指哪一个实体？

  上下文：
  <nearby_text>

  候选：
  1. <canonical_name> (id, country, industry, brief)
  2. ...

  请输出 JSON:
  {
    "chosen_index": 0..N or null (如果都不像),
    "rationale": "...",
    "evidence_in_context": "<引用上下文中的具体证据>"
  }
```

约束：

- LLM 输出**必须** cite context 中的具体片段
- 任何无 cite 的 chosen_index → 直接拒绝（fallback 到 ambiguous）
- LLM 选定的 confidence 不会高于 0.85
- 始终 `needs_human_review = true`

## 必须 hard-code 的特殊规则

下面这些实体的消歧规则必须写死，不依赖通用算法：

### "Samsung"

- 默认 → `ambiguous`（拒绝直接 link 到任何 specific 实体）
- 如果 `nearby_text` 含 "memory" / "DRAM" / "NAND" / "HBM" → ENT-SAMSUNG-MEMORY
- 如果含 "foundry" / "wafer" / "process node" → ENT-SAMSUNG-FOUNDRY
- 如果含 "Galaxy" / "smartphone" / "TV" → ENT-SAMSUNG-ELEC（消费电子，但不进首阶段研究范围）
- 如果是公司层财报 / 法人事项 → ENT-SAMSUNG-ELEC（母公司）

### "Foxconn" / "Hon Hai" / "鸿海"

- 默认 → ENT-FOXCONN（即 Hon Hai Precision Industry，母公司）
- 如果 nearby 含 "industrial internet" / "FII" / "工业互联网" → ENT-FOXCONN-FII
- 如果含 "Wisconsin" / "Ohio" / "Mt. Pleasant" → ENT-FOXCONN-US（美国厂，独立法人）

### "Apple"

- 默认 → ENT-APPLE（NASDAQ: AAPL）
- 如果是供应链报告中作为采购方 → ENT-APPLE
- 如果是欧洲税务议题 → 提示走 Apple 子公司（开曼 / 爱尔兰），但 MVP 不展开

### "TSMC"

- 默认 → ENT-TSMC（母公司，2330.TW / TSM）
- 如果 nearby 含 "Arizona" → ENT-TSMC-ARIZONA
- 如果含 "JASM" / "Kumamoto" → ENT-JASM
- 子公司用 OWNS_SUBSIDIARY 与母公司连接

## API

```ts
interface EntityResolver {
  resolve(input: ResolveInput): Promise<ResolveResult>;
  registerAlias(alias: string, entityId: string, evidence: Provenance): Promise<void>;
  split(entityId: string, newCanonicals: NewEntitySpec[]): Promise<SplitResult>;
  merge(loserId: string, winnerId: string, reason: string, evidence: Provenance): Promise<MergeResult>;
}
```

`split` / `merge` 是高风险操作：

- 必须配 `migrate_edges = true`：把所有受影响的 edges 重新指向新实体
- 必须落 ChangeRecord
- 必须 PR 操作（不允许在生产 CLI 直接跑）

## 训练数据

### Golden Set（必备）

`tests/golden/entity-resolver/`：

- 至少 200 条 `(surface, context, expected_entity_id)` 样本
- 覆盖：
  - 主要公司中英文别名各 5 条
  - Foxconn 系 / Samsung 系 / TSMC 系等易错实体各 10 条
  - 与无关同名实体的混淆案例（如 "Apple" 在 Apple Inc / Apple Hospitality REIT 之间）

### CI

- 每次构建跑 golden set
- 任意一条 regression 直接 fail
- 准确率必须维持在 ≥ 99%

## Pending Entities 流程

```
1. resolver returns "unknown" → 写 pending_entities
2. 同 surface 出现 occurrence_count++
3. 当 occurrence_count >= 3 时，进 review queue
4. review 决定：
   a. 创建新实体（走 PR 修 seeds 或 CLI 命令）
   b. 合并到已有实体（add alias）
   c. reject（垃圾字符串 / 通用词）
```

当前 MVP 已落地外部实体源导入的第一条路径：

```
entity lookup <surface>
  → review enqueue entity-source <surface>
  → review approve
  → review apply
  → entity_master / entity_alias
  → pending_entities(surface) 标记 resolved
```

也已落地 curated seed 的闭环路径：

```
修改 seeds/entities.csv + seeds/aliases.csv
  → admin seed
  → retry review apply
  → pending_entities(surface) 标记 resolved
```

这条路径用于 `3M` 这类高频、低歧义、适合项目内维护的桥接实体。它不是 Apple 专用逻辑：只要 alias 进入通用 seed，DB resolver 和 CSV resolver 都会按同一规则命中。

实现约束：

- lookup 结果只是候选，不自动写库
- apply 前检查外部 identifier 是否已经属于其它实体
- apply 前检查候选 alias 是否已经属于其它实体
- 冲突时 review candidate 变成 `blocked`，由人工处理 false-merge / false-split
- seed 修复只能补事实型实体和别名；有歧义的 surface 仍应保留在 `pending_entities`，通过 registry/review 决策

## 反模式

| 反模式                         | 危害                     |
| --------------------------- | ---------------------- |
| 在 resolver 中调 LLM 但忘了要求 cite | 容易引入幻觉                 |
| 用 "包含 substring" 匹配         | 严重 false-merge          |
| Fuzzy 匹配阈值过宽               | 不同公司被合并                 |
| ambiguous 时静默选第一个候选         | 系统失去自知之明                |
| 不区分 Samsung 母公司/部门          | 半导体相关边全部错挂              |
