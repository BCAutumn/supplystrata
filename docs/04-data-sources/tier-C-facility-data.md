# Tier C — 工厂 / 设施数据

补充"公司 → 工厂 → 地理"的关系。MVP 不依赖此层，但 Phase 3 之后是必须。

## C.1 Open Supply Hub (`osh`)

### 用途

- 全球生产设施
- 品牌 / 组织 → 设施 关系
- ESG 透明度数据

### 接入

- 公开 API：`/facilities/`、`/contributors/`、`/api/...`
- 需要 API key（免费注册）
- 数据可下载，遵守归因
- 当前实现：`@supplystrata/sources-osh` 支持 facility search，`source_check_targets.target_kind = facility-search` 会保存 `facility_dataset` 文档并写入 `FACILITY_PROFILE_OBSERVATION`。
- `OSH_API_TOKEN` 只作为请求 header 使用，不写入 `source_url` / provenance。

### 字段映射

| OSH 字段                | 系统映射                                   |
| ----------------------- | ------------------------------------------ |
| `os_id`                 | facility 节点 identifier                   |
| `name`                  | canonical_name 候选                        |
| `address`               | facility.geo                               |
| `country_code`          | facility.geo.country                       |
| `contributors[]`        | edge: brand/org → facility（关系类型见下） |
| `sector`/`product_type` | facility 属性                              |

### 关系生成

- OSH 提供"哪个品牌/组织报告了哪个设施"，但**不一定**等同于"该品牌的供应商在该设施制造该品牌的产品"
- MVP 阶段：只用 OSH 做"facility 存在 + 大致地理 + 行业分类"，**不**自动生成 BUYS_FROM
- 唯一例外：Apple Supplier List 与 OSH 同时确认的供应商-设施 → 生成 MANUFACTURES_AT (evidence_level 4)
- 当前 preview connector 不会自动执行这个升级；升级必须走后续交叉验证和 review/apply。

### 已知盲区

- OSH 偏 ESG / 服装 / 消费电子，半导体 / AI 服务器覆盖不够全
- 设施名称重复频繁（多个 contributors 报告同一物理设施）→ OSH 内部用 `os_id` 去重，但仍要再次清洗
- 不告知设施的产能、技术节点等

## C.2 Apple Supplier List (作为 facility 视角)

详见 [tier-A-disclosures.md](./tier-A-disclosures.md) §A.4。

从 facility 视角看：

- 表格的"Primary locations" 列可解析为 facility（粒度通常到城市）
- 同一 supplier 可能有多个 locations，不要默认全部都为 Apple 制造
- 所有 facility 必须 link 到 supplier entity

## C.3 公司 ESG / Sustainability 报告

各家 ESG 报告里常有：

- Tier 1 supplier 数量与地理分布
- 关键矿产冶炼厂列表
- 主要工厂能源使用 / 碳排放

MVP 阶段：**只读不抽**（用于人工 review 时提供背景）。Phase 3 起视情况解析。

## C.4 RBA / Responsible Minerals 报告

- RMI 公布合规冶炼厂清单
- 用于推断锂 / 钴 / 锡 / 钨 / 钽 / 金 等矿产链路
- MVP 不接（与首阶段研究范围不重合）

## C.5 政府环评 / 工厂建设许可

- 美国各州环境署、欧盟环境部门、台湾环保署、韩国环境部、日本经产省等
- 各国接入方式高度异构
- 大型 fab / 数据中心 / 电池厂的扩建公告对供应链非常有意义
- MVP 不做；放 Phase 4

## 设施数据的图谱使用规则

- facility 节点必填字段：`country`
- facility 节点不允许跨国"大致估计"（如"Asia"），不进图谱
- facility 节点的产能、process_node 等只在原文明确给出时才填
- 设施重复合并必须基于物理坐标 + 名称 + operator entity 三者一致
