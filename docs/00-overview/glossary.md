# Glossary — 术语表

按字母序。本术语表只收录在本仓库内部有特定含义的词。

| 术语 | 定义 |
| --- | --- |
| **ADR** | Architecture Decision Record。架构决策的不可变记录文档。 |
| **AIS** | Automatic Identification System。船舶自动识别系统。NOAA 提供美国水域 AIS 数据。 |
| **BOL** | Bill of Lading。海运提单。美国进口 BOL 是 ImportYeti 等工具的核心数据。 |
| **CIK** | Central Index Key。SEC 给每个 filer 分配的唯一 ID。 |
| **entity_master** | 系统中所有实体的权威主表。公司、业务部门、设施、产品、组件等外部对象进入系统前必须先映射到 `entity_master.entity_id`。 |
| **confidence** | 0-1 浮点数。某条边在当前证据下的置信度估计。和 `evidence_level` 不同：等级是离散的来源类型分级，confidence 是综合打分。 |
| **CSP** | Cloud Service Provider。AWS / Azure / GCP / Oracle Cloud 等。 |
| **evidence** | 一条具体证据记录。包含来源文档、原文片段、抓取时间、抽取方法等。 |
| **evidence_level** | 1-5 离散等级。详见 [evidence-model.md](../03-data-model/evidence-model.md)。 |
| **edge** | 图谱中的一条关系。一条 edge 必须 ≥1 条 evidence 才能存在。 |
| **HBM** | High Bandwidth Memory。AI 加速器关键组件，主要供应商为 SK Hynix、Samsung、Micron。 |
| **HS Code** | Harmonized System Code。国际通用的商品分类编码。Comtrade、Census 数据按 HS code 组织。 |
| **inferred edge** | `is_inferred = true` 的边。必须标注推断方法、不确定性原因。 |
| **ingestion** | 把原始数据源拉取到本地（含原始 HTML/PDF/JSON 落盘）的过程。 |
| **LEI** | Legal Entity Identifier。全球法人识别码，ISO 17442。 |
| **node** | 图谱中的一个实体。所有 node 必须可解析到 `entity_master.id`。 |
| **provenance** | 来源链。从结论 → 边 → 证据 → 文档 → URL 的完整可追溯链路。 |
| **source adapter** | 一个数据源对应的接入实现。所有 source adapter 实现统一接口（详见 [ingestion.md](../05-modules/ingestion.md)）。 |
| **tier (P0/P1/P2)** | 数据源接入优先级。P0 是 MVP 必须，P1 是 MVP 通过后的第一批扩源（默认 Phase 3），P2 是更后期或仅手工使用。 |
| **unknown map** | 一份"已知 / 部分已知 / 未知"的明确清单。系统输出必须包含。 |
| **XBRL** | eXtensible Business Reporting Language。SEC 公司 financial facts 的标准化结构化格式。 |

---

## 关系类型缩写

详细语义见 [relation-model.md](../03-data-model/relation-model.md)。

| 缩写 | 全称 |
| --- | --- |
| `BUYS_FROM` | A 从 B 采购 |
| `SUPPLIES_TO` | A 供货给 B |
| `USES_FOUNDRY` | A 使用 B 作为晶圆代工厂 |
| `USES_MEMORY` | A 使用 B 提供的存储产品 |
| `USES_COMPONENT` | A 使用 B 提供的某类组件 |
| `MANUFACTURES_AT` | A 在 B（工厂/地点）制造 |
| `CUSTOMER_OF` | A 是 B 的客户（与 SUPPLIES_TO 互逆） |
| `DEPENDS_ON` | 通用依赖（弱关系，慎用） |
| `CAPEX_LINKED_TO` | A 的 capex 与 B 强相关（如 NVIDIA 与 TSMC CoWoS 产能） |
| `PRICE_EXPOSED_TO` | A 的成本/收入与某商品价格强相关 |
| `OWNS_SUBSIDIARY` | A 是 B 的母公司或控股 |
| `ALIAS_OF` | 实体消歧用的别名关系 |

---

## 证据来源类型缩写

| 缩写 | 含义 |
| --- | --- |
| `10-K` | SEC 年报 |
| `10-Q` | SEC 季报 |
| `20-F` | 外国发行人年报 |
| `8-K` | 重大事件公告 |
| `IR` | 公司投资者关系页面（年报 / earnings call / presentation） |
| `ESG` | 公司可持续发展报告（含供应商列表） |
| `XBRL` | SEC company facts 结构化数据 |
| `BOL` | 海关 Bill of Lading |
| `COMTRADE` | UN Comtrade 国别贸易流 |
| `CENSUS_TRADE` | U.S. Census International Trade |
| `USITC` | USITC DataWeb |
| `OSH` | Open Supply Hub |
| `OC` | OpenCorporates |
| `CH_UK` | UK Companies House |
| `EIA` | U.S. Energy Information Administration |
| `FRED` | Federal Reserve Economic Data |
| `WB_PINK` | World Bank Pink Sheet |
| `USGS_MCS` | USGS Mineral Commodity Summaries |
| `NOAA_AIS` | NOAA AIS 数据 |
| `SAM` | SAM.gov 联邦合同机会 |
| `USASPEND` | USAspending.gov |
| `EU_TED` | EU TED 公共采购 |
| `GDELT` | GDELT 新闻事件 |
| `NEWS` | 一般公开新闻报道 |
| `MANUAL` | 手动录入的证据（必须填 `manual_reviewer`） |
