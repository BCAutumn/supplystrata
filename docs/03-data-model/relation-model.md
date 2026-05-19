# Relation Model — 关系模型

关系是图谱的"边"。设计原则：**关系类型尽量少而正交**。宁可少一类关系不抽，也不要多一类语义重叠的关系把图谱搞乱。

关系模型只负责表达“关系是否有证据存在”。关系强度、供应集中度、时间衰减和风险传播不直接塞进 `relation` 枚举，必须走 [intelligence-methodology.md](./intelligence-methodology.md) 定义的 strength / freshness / risk view。

## MVP 关系清单

只在 MVP 中实际写入图谱的关系类型：

| relation             | 主体         | 客体          | 语义                  | 关键字段        |
| -------------------- | ------------ | ------------- | --------------------- | --------------- |
| `BUYS_FROM`          | company / BU | company / BU  | A 从 B 采购组件/产品  | `component`     |
| `SUPPLIES_TO`        | company / BU | company / BU  | A 向 B 供货           | `component`     |
| `USES_FOUNDRY`       | company / BU | company / BU  | A 使用 B 作为晶圆代工 | `process_node?` |
| `USES_COMPONENT`     | company / BU | component     | A 使用某抽象组件类    | `note`          |
| `MANUFACTURES_AT`    | company      | facility      | A 在某设施制造        | `product?`      |
| `OWNS_SUBSIDIARY`    | company      | company       | A 持有 B（独立法人）  | `stake_pct?`    |
| `OWNS_BUSINESS_UNIT` | company      | business_unit | A 持有内部业务部门    |                 |
| `IS_A`               | product      | component     | 产品归属于组件大类    |                 |
| `OPERATES_FACILITY`  | company      | facility      | A 运营某设施          |                 |

不进图谱的内部关系：

- `facility.geo` 直接表达设施地理归属，MVP 不单独建 `LOCATED_IN` 边。
- 别名关系由 `entity_alias` 表表达，MVP 不建 `ALIAS_OF` 边。

`BUYS_FROM` 与 `SUPPLIES_TO` 互逆，但**两者都允许并存**（见下面"双向同时存在"）。

## 非 MVP 关系（后期可能加入）

| relation                | 何时考虑 | 说明                                    |
| ----------------------- | -------- | --------------------------------------- |
| `CUSTOMER_OF`           | Phase 3  | SUPPLIES_TO 的语义子集，不一定需要      |
| `DEPENDS_ON`            | Phase 3+ | 通用依赖；语义弱，慎用                  |
| `CAPEX_LINKED_TO`       | Phase 3+ | A 的 capex 对 B 有强关联（推断）        |
| `PRICE_EXPOSED_TO`      | Phase 3+ | A 的成本/收入受某商品价格驱动           |
| `IMPORTS_FROM`          | Phase 3  | 海关数据驱动；总是带 `is_inferred=true` |
| `TRADES_HS_CODE`        | Phase 3  | 国家 - HS 代码贸易流量                  |
| `TRANSPORTS_FOR`        | Phase 3  | 承运商 - 货主                           |
| `CALLS_PORT`            | Phase 3  | 船舶 - 港口                             |
| `OWNS_VESSEL`           | Phase 3  | 船东                                    |
| `POWERED_BY_GRID_OF`    | Phase 4  | 设施 - 电网/能源源                      |
| `EXPOSED_TO_REGULATION` | Phase 4  | 实体 - 政策/法规                        |

任何新关系类型必须：

1. 写入 [glossary.md](../00-overview/glossary.md)
2. 在本文件加表格行 + 完整定义
3. 给出主客体合法 Kind
4. 给出 evidence_level 默认映射
5. 配至少一个抽取器和测试样本
6. 开 ADR（如果会引入图谱遍历语义变化）

## 边的核心字段

```ts
interface Edge {
  edge_id: string; // EDGE-uuid
  subject_id: string; // entity_master.id
  object_id: string;
  relation: RelationType;
  component?: string; // 人类可读兼容字段
  component_id?: string; // 优先引用 components.component_id
  component_specificity?: "explicit" | "inferred" | "unspecified";
  attrs: Record<string, unknown>; // 关系特定属性
  evidence_ids: string[]; // 至少 1 条
  primary_evidence_id: string; // 主证据
  evidence_level: 1 | 2 | 3 | 4 | 5; // 取所有证据的 max
  confidence: number; // 综合得分
  is_inferred: boolean;
  validity: "current" | "historical" | "deprecated";
  effective_period?: { from?: string; to?: string };
  first_observed_at: string;
  last_verified_at: string;
  created_at: string;
  updated_at: string;
  deprecated_reason?: string;
  superseded_by_edge_id?: string;
}
```

字段约束：

- `evidence_level` 取该边所有 evidence 的最高 level（不是平均）
- `confidence` 是综合分（见 [confidence-scoring.md](./confidence-scoring.md)）
- 一条边只有"deprecated"或"current"，不允许逻辑删除以外的删除
- `attrs` 可以保存原始关系属性，但不能保存不可追溯的风险结论；风险派生结果应进入 `risk_views` / `risk_metrics`

## 关系强度不是关系类型

不要为了表达“强供应商”“核心客户”“瓶颈节点”新增一堆关系类型。正确做法：

```text
BUYS_FROM + edge_strength_estimates
SUPPLIES_TO + customer_concentration observation
USES_FOUNDRY + capacity/dependency strength
```

这样事实层保持稳定，风险层可以独立演进。

## 主体/客体合法类型矩阵

| relation             | subject 合法 kinds     | object 合法 kinds                     |
| -------------------- | ---------------------- | ------------------------------------- |
| `BUYS_FROM`          | company, business_unit | company, business_unit                |
| `SUPPLIES_TO`        | company, business_unit | company, business_unit                |
| `USES_FOUNDRY`       | company, business_unit | company, business_unit (foundry 业务) |
| `USES_COMPONENT`     | company, business_unit | component                             |
| `MANUFACTURES_AT`    | company                | facility                              |
| `OWNS_SUBSIDIARY`    | company                | company                               |
| `OWNS_BUSINESS_UNIT` | company                | business_unit                         |
| `IS_A`               | product                | component                             |
| `OPERATES_FACILITY`  | company                | facility                              |

抽取器输出不符合此矩阵的候选 → pipeline 在送入 scorer 前拒收，并落 `extraction_rejections`。

## 双向是否同时建？

`A BUYS_FROM B` 与 `B SUPPLIES_TO A` 在语义上互逆。

**实施规则**：

- 默认只存 `BUYS_FROM` 方向（消费方为 subject）
- 查询时由 graph builder 在 Neo4j 中提供视图，使得查 "B 的下游" 也能命中
- 例外：当原文明确以"B 向 A 供货"的方式披露时（如 supplier press release），先按 `SUPPLIES_TO` 方向抽，最后由 builder 归一为 `BUYS_FROM`。规范化逻辑在 graph-builder 中

## 关系的 attrs 字段示例

```jsonc
// USES_FOUNDRY
{ "process_node": "5nm", "product_family": "H100" }

// BUYS_FROM
{ "component": "HBM3e", "stack_size_gb": 24, "qualified_supplier": true }

// MANUFACTURES_AT
{ "product": "advanced packaging (CoWoS)", "starting_year": 2024 }

// OWNS_SUBSIDIARY
{ "stake_pct": 100.0, "transaction_type": "wholly_owned" }
```

`attrs` 必须遵循一份 zod schema（按 relation 分发）。MVP 阶段只为 `BUYS_FROM / USES_FOUNDRY / OWNS_SUBSIDIARY` 写严格 schema；其他用宽松 schema。

## 关系的去重与聚合

唯一键：

```
UNIQUE (subject_id, object_id, relation, COALESCE(component_id, ''), COALESCE(component, ''), COALESCE(effective_period, ''))
```

同一对实体在同一关系上不同的 `component` 应当是不同 edge：

```
NVIDIA -BUYS_FROM(memory)→ Samsung Memory
NVIDIA -BUYS_FROM(HBM)   → Samsung Memory
```

这两条不要合并。`memory` 是父概念，`HBM` 是子概念。只有原文明确出现 HBM / High Bandwidth Memory 等具体词时，才允许把 `component_id` 设为 `COMP-HBM`；普通 memory 披露只能落到 `COMP-MEMORY`，`component_specificity = "unspecified"`。

## Effective Period（关系的时间有效性）

很多关系是有"开始 / 结束"的：

- `OWNS_SUBSIDIARY` 在收购日开始
- `USES_FOUNDRY` 可能因迁移而停止

字段：

```ts
effective_period?: {
  from?: string;            // ISO date
  to?: string;
  asserted_in_evidence_id?: string;  // 哪条证据明确给了时间
}
```

如果原文未给明确时间，留空。

`validity` 与 `effective_period` 不是同一回事：

- `validity` = 当前是否在系统中生效（不是事实层面，是数据层面）
- `effective_period` = 关系在现实世界的时间窗

## 抽取器与关系的对应

每条边的 `extracted_by` 列表（保留在 evidence 中）告诉我们：

- 哪个抽取器抽出来的
- 是 rule 还是 llm
- 跨多少独立证据

边的强度的衡量之一是"被多少独立来源抽出"。这个数字会作为 confidence 因子之一。

## 反例（什么不该建关系）

- 同一公司不同部门的内部转移（除非有外部市场化合同）
- 公司"提到"另一公司但无业务往来（如风险因素一节里随手提到 `competitors include X, Y`）
- 公司"考虑过"某关系但未签订（"plans to qualify", "is exploring"）
- LLM "猜"出来但无 cite_text 的关系

抽取器必须能自动过滤这些反例。

## 关系的可视化默认（Phase 3 之后）

- 每种 relation 默认颜色 / 边宽
- evidence_level 影响边的不透明度
- is_inferred 用虚线
- deprecated 边默认隐藏

输出层（[output-spec.md](../01-product/output-spec.md)）已经定义这些约定。
