# Entity Model — 实体模型

实体是图谱的"节点"。模型设计的目标：精确区分不同抽象层次的"东西"（公司 vs 部门 vs 工厂 vs 港口 vs 船 vs 产品），同时保证可消歧。

## 实体分类（EntityKind）

```ts
type EntityKind =
  | "company" // 法人 (Hon Hai Precision Industry, NVIDIA Corporation)
  | "company_group" // 概念集团 (Samsung Group) —— 极少用
  | "business_unit" // 公司内部业务部门 (Samsung Foundry, Samsung Memory)
  | "facility" // 物理设施（工厂/晶圆厂/数据中心）
  | "port" // 港口
  | "vessel" // 船舶
  | "carrier" // 承运商（航运/航空）
  | "product" // 产品/SKU 抽象（NVIDIA H100, HBM3e 8GB）
  | "component" // 组件抽象（HBM, DRAM, advanced packaging）
  | "industry_node" // 行业概念节点（"AI accelerator", "wafer foundry"，用于树形分类）
  | "person" // 高管/公开人物（极少用，且谨慎）
  | "government_agency"; // 监管或采购方
```

实体之间不允许跨 Kind 直接做 `BUYS_FROM`。比如：

- `product` 不可作为 `BUYS_FROM` 的主体
- `facility` 不可作为 `OWNS_SUBSIDIARY` 的对象
- 详细见 [relation-model.md](./relation-model.md) 的"主体/客体合法类型"表

## entity_master 表的核心字段

```ts
interface EntityMaster {
  entity_id: string;                  // ENT-uuid 或 ENT-XXX (人类可读 slug)
  kind: EntityKind;
  canonical_name: string;             // 唯一权威名
  display_name: string;               // 默认展示名（可与 canonical 不同）
  language_of_canonical: "en" | "zh-Hans" | "zh-Hant" | "ja" | "ko" | ...;

  identifiers: {
    cik?: string;                      // SEC
    lei?: string;                      // ISO 17442
    isin?: string[];
    ticker?: string[];                 // 形如 ["NVDA:US", "2330:TW"]
    open_corporates_id?: string;
    companies_house_number?: string;
    duns?: string;
    ric?: string;                      // Refinitiv (避免使用，仅在已有时记录)
  };

  primary_country?: string;            // ISO 3166-1 alpha-2
  hq_location?: { country: string; region?: string; city?: string };
  industry?: string[];                 // 标签
  founded_year?: number;
  status: "active" | "deprecated" | "merged_into";
  merged_into_entity_id?: string;
  created_at: string;
  updated_at: string;
  evidence_for_existence?: string;     // 一条证明该实体存在的证据 ID（可空，对常识性大公司可不填）
}
```

字段约束：

- `entity_id` 永不复用
- `merged_into_entity_id` 仅在 status = "merged_into" 时有意义
- 一个 ticker 可能挂在多个实体（母公司 / ADR / 子公司），故 ticker 是数组

## 别名表 entity_alias

```ts
interface EntityAlias {
  alias_id: string;
  entity_id: string;
  alias: string;
  language?: string;
  alias_kind: "official" | "informal" | "abbreviation" | "translation" | "former";
  evidence_id?: string; // 别名来源的证据 ID（PR 加别名必须给）
  source_type?: "10-K" | "Wikipedia" | "manual" | "company-website" | "news";
  added_by: string;
  added_at: string;
  status: "active" | "rejected";
}
```

`alias` 不强制全局唯一，因为：

- 不同实体可能合法共享同一别名（"Samsung" 可指多个层级）
- EntityResolver 必须根据上下文消歧

但**在同一 entity_id 下别名必须唯一**（避免重复别名）。

## 业务部门（business_unit）的特别处理

Samsung 的复杂结构需要：

```
ENT-SAMSUNG-ELEC          kind=company             ticker=005930.KS
  ├─ OWNS_BUSINESS_UNIT → ENT-SAMSUNG-FOUNDRY    kind=business_unit
  ├─ OWNS_BUSINESS_UNIT → ENT-SAMSUNG-MEMORY     kind=business_unit
  ├─ OWNS_BUSINESS_UNIT → ENT-SAMSUNG-DISPLAY    kind=business_unit
  └─ OWNS_SUBSIDIARY    → ENT-SAMSUNG-AUSTIN     kind=company (法人)
```

特殊关系：

- `OWNS_BUSINESS_UNIT`：母公司持有的内部部门（不是独立法人）
- `OWNS_SUBSIDIARY`：母公司持有的独立法人

`USES_FOUNDRY` 等关系**优先指向 business_unit**（因为这是 Samsung 实际供应的部门）。如果原文只说 "Samsung"，EntityResolver 必须根据上下文消歧到具体业务单元，否则进 ambiguous。

## facility（设施）

```ts
interface Facility extends EntityMaster {
  kind: "facility";
  facility_kind: "fab" | "assembly" | "test_packaging" | "data_center" | "port_terminal" | "warehouse" | "mine";
  operator_entity_id?: string; // 谁在运营
  owner_entity_id?: string; // 谁在持有（可与 operator 不同）
  geo: { country: string; lat?: number; lng?: number; address?: string };
  process_node?: string; // 仅 fab 用，如 "5nm" / "3nm"
  capacity_text?: string; // 自由文本 + cite，不强求结构化产能
}
```

设施数据主要来自：

- Apple Supplier List（含工厂地点）
- Open Supply Hub
- 公司 ESG / sustainability 报告
- 政府环评 / 建设公告

不允许：

- 通过 BOL 推断出"工厂"实体（BOL 看到的是法人/转运点，不是工厂）

## product 与 component 的区别

```
product   = 具体可购买商品（H100 SXM、HBM3e 24GB stack）
component = 抽象组件类（HBM、DRAM、advanced packaging、wafer）
```

关系上：

- `product` 可以 `IS_A` `component`（如 HBM3e -> HBM）
- `component` 用于"在某抽象层级下，有哪些公司参与"
- MVP 阶段优先做 `component` 层；`product` 只挂少量旗舰（如 NVIDIA H100/H200/B100/GB200）

## 实体识别符的优先级

EntityResolver 解析时，identifier 命中优先级最高（等价于 Level 5）：

```
LEI > CIK > ISIN > Ticker (with country suffix) > OpenCorporates ID > Companies House Number > DUNS
```

无 identifier 时才退到 alias 字符串匹配 + 上下文消歧。

## 实体的 lifecycle

```
created → active → (renamed | reorganized | merged_into | dissolved)
                                                            ↓
                                                       deprecated
```

变更必须通过 ChangeRecord 记录。直接改 `canonical_name` 是反模式——应该开新实体或加别名。

具体规则：

- **改名（不变法人）**：加新别名（`alias_kind = "former"` 或 "current"），不改 entity_id
- **拆分**：对原实体执行 `EntityResolver.split()`，新建实体并迁移边
- **合并（同一法人重复入库）**：旧实体 status = "merged_into"，所有边迁移
- **被收购**：原实体保持 active（因为它仍是法人），只是新增 `OWNS_SUBSIDIARY` 边

## 不允许的实体造法

- 不允许 entity 名称为空字符串或纯空白
- 不允许两个 active 实体有相同的 (LEI / CIK / ISIN)
- 不允许 facility 没有地理信息（至少要 country）
- 不允许 product 没有挂到至少一个 company / business_unit（owner）
- 不允许 industry_node 进入 `BUYS_FROM` 关系（它是分类节点，不是经济主体）

## 实体审计

每月执行（运维 checklist）：

- 重复 alias 扫描（同一别名指向多个实体且无上下文区分规则）
- 孤立实体扫描（没有任何边的 entity，可能是错误录入）
- 无 evidence_for_existence 的小公司扫描
- 已合并实体下还有活动边的扫描（迁移失败）

详见 [data-quality.md](../07-operations/data-quality.md)。
