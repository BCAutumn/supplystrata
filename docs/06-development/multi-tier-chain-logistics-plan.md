# Multi-tier Chain & Logistics Plan — 多级供应链、原材料与运输追踪计划

本文回答一个核心产品问题：SupplyStrata 要如何从当前的一级供应商图，扩展到二级、三级、最上游原材料与运输链路，同时不牺牲证据可信度。

结论很明确：

> 下一步不能为了把图画满而直接追到矿山和船。正确路线是先建立 `edge / observation / lead / unknown` 四层模型，把可证实的链路、宏观观测、物流信号和未知边界分开。

## 1. 目标形态

长期目标不是只回答：

```text
NVIDIA buys memory from SK Hynix.
```

而是回答：

```text
AI accelerator
  -> chip designer
  -> foundry / memory / packaging / EMS
  -> substrate / chemicals / equipment / energy / logistics
  -> smelter / refinery / mine / recycled material
  -> country / port / shipping lane / policy exposure
```

但每一层的证据强度不同，不能混在同一张事实图里。

## 2. 四层数据语义

### Layer A：Graph edge

可以默认展示给用户的事实边。

条件：

- 有公司官方、监管文件、官方供应商名单或同等级证据。
- 有明确 subject / relation / object / component。
- 有 cite_text，且 cite_text 是原文子串。
- 对外默认只展示 Level 4/5。

例子：

```text
NVIDIA -BUYS_FROM(memory)-> SK Hynix
NVIDIA -USES_FOUNDRY(wafer)-> TSMC
Apple Supplier List -MANUFACTURES_AT-> Supplier facility candidate
```

### Layer B：Observation

可量化或可复现的观测信号，但不能单独证明公司间关系。

来源：

- UN Comtrade / Census Trade / USITC。
- NOAA AIS / 港口 dashboard。
- EIA / FRED / World Bank Pink Sheet。
- USGS Mineral Commodity Summaries。
- IEA Critical Minerals Data Explorer。

例子：

```text
Korea -> US, HS code group, monthly import value
Port of Los Angeles vessel dwell proxy
Lithium / nickel / cobalt global production and reserve signal
electricity price near a manufacturing region
```

这些进入 `trade_observations`、`port_observations`、`commodity_observations`、`energy_observations`，不直接进 `edges`。

### Layer C：Lead

值得研究的线索，但默认不能进入图谱。

来源：

- 新闻、招聘、政府采购、论坛、博客。
- 公开但非权威的行业价格报道。
- BOL 手工摘录中的单条记录。

例子：

```text
某公司招聘 advanced packaging engineer
某港口出现疑似相关 HS code 进口上升
某新闻称某供应商扩产
```

这些进入 `lead_observations` 或 `hypothesis_queue`，等待官方或多源证据确认。

### Layer D：Unknown

用户最需要知道但公开来源暂时无法确认的部分。

例子：

```text
具体采购量
具体合同价格
具体 HBM allocation
具体船上货物归属
具体矿山到冶炼厂的绑定关系
```

Unknown 不是失败，而是产品能力。每个 CompanyCard / ComponentCard / ChainView 都必须展示 unknown boundary。

## 3. 推荐链路深度顺序

不要一开始就追到矿山。对 AI compute / memory 这个测试域，建议顺序是：

### Step 1：一级官方边继续扩容

目标：

- 把 25 个核心研究节点跑满。
- SEC / IR / DART / EDINET 优先。
- 拿到更多 `BUYS_FROM`、`USES_FOUNDRY`、`SUPPLIES_TO`、`MANUFACTURES_AT`。

验收：

- Level 4/5 边达到 Phase 2 的 100 条。
- 每条边能跳到 evidence。

### Step 2：组件 taxonomy 扩展

先把“供应链追踪对象”建好，而不是急着抓更多源。

优先组件：

```text
memory
HBM
DRAM
NAND
wafer
advanced packaging
substrate
ABF substrate
server assembly
optical module
power module
cooling
EUV lithography
photoresist
specialty gas
copper
aluminium
nickel
cobalt
lithium
graphite
rare earths
```

组件节点要支持：

- parent / child taxonomy。
- material / intermediate / component / equipment / service 分类。
- 可在图上作为 chain depth 的中间层。

### Step 3：设施层

设施层是从公司链走向实体世界的关键。

优先：

- Apple Supplier List 的 supplier/location。
- Open Supply Hub 的 facility / contributor / processing_type。
- 公司 ESG / sustainability report 中的工厂、冶炼厂、供应商地理。

规则：

- facility 地理事实可以较高置信。
- facility 与 buyer 的供应关系必须更谨慎。
- OSH 第三方贡献默认 observation/candidate；官方 supplier list 交叉确认后才允许升级。

### Step 4：原材料与冶炼/精炼层

原材料不是直接连到 NVIDIA，而是连到 ComponentCard。

优先：

- USGS Mineral Commodity Summaries：矿产产量、储量、主要生产国。
- IEA Critical Minerals Data Explorer：关键矿物需求与供应情景。
- RMI facility lists：金、钽、锡、钨、钴、铜、镍、锌、银、锂等冶炼/精炼/处理设施。
- EU Critical Raw Materials Act：关键原材料政策、风险、战略项目背景。

规则：

- `Country -> mineral` 默认是 commodity observation。
- `smelter/refiner -> mineral` 可以是 facility/component relation candidate。
- `Company -> mine/refiner` 只有官方报告或注册文件支持时才进 graph。
- 不能从“某国是主要产地”推出“某公司从该国采购”。

### Step 5：运输与港口层

运输很重要，但它最容易被误读。

优先：

- U.S. Census International Trade API 的 port / HS / vessel / air 维度。
- NOAA AccessAIS 的 vessel traffic / vessel count / time period / area。
- 港口公开 dashboard。
- 航运公司 schedule / port call 公告。
- ImportYeti 仅手工摘录，不做 adapter。

规则：

- AIS 不知道货物，不能推出“这艘船上有某公司产品”。
- Port/HS flow 是 route observation，不是公司边。
- BOL 单条记录默认 lead；至少多条独立记录 + 非货代识别 + 时间连续性 + 产品描述一致，才可能进入 inferred edge，而且必须 review。

## 4. 数据模型增量

建议新增或明确以下模型，不急着全部实现：

```text
component_taxonomy_edges
facility_observations
trade_observations
commodity_observations
energy_observations
port_observations
route_observations
lead_observations
chain_segments
chain_views
```

`chain_segments` 是关键抽象：

```ts
interface ChainSegment {
  segment_id: string;
  chain_id: string;
  from_kind: "company" | "facility" | "component" | "country" | "port" | "vessel" | "mineral";
  from_id: string;
  to_kind: "company" | "facility" | "component" | "country" | "port" | "vessel" | "mineral";
  to_id: string;
  semantic_layer: "edge" | "observation" | "lead" | "unknown";
  relation?: string;
  component_id?: string;
  evidence_ids: string[];
  observation_ids: string[];
  unknown_ids: string[];
}
```

这样前端可以画一条完整链，但每一段都知道自己是事实边、观测、线索还是未知，不会把弱信号伪装成事实。

## 5. 物流推断升级门槛

物流数据只有满足下面条件，才允许从 observation/lead 升级为 inferred edge：

```text
[ ] 至少 6 条独立 BOL 或官方物流证据
[ ] 时间窗口连续，不是孤立一次
[ ] importer / consignee / shipper 不是已知货代或贸易商
[ ] 产品描述与 component taxonomy 能稳定匹配
[ ] 港口/国家/设施路径与已知供应链上下文一致
[ ] 人工 review 通过
[ ] evidence_level <= 3
[ ] is_inferred = true
[ ] default output hidden unless --include-inferred
```

任何一条不满足，就继续留在 observation 或 lead。

## 6. UI/产品影响

正式前端不能只画一种边。它需要四种视觉语义：

```text
solid edge
  Level 4/5 graph edge，默认展示。

dashed edge
  inferred edge 或 observation link。

thin grey route
  logistics/port/trade flow observation。

orange boundary
  unknown / unverified / confidential segment。
```

CompanyGraph 展示公司事实边；ComponentGraph 展示组件上下游和原材料暴露；RouteView 展示港口/运输观测；UnknownMapPanel 解释不能知道的部分。

## 7. 下一批 PR 顺序

### PR A：Chain depth contract

新增 `chain_view` 输出契约，不改变现有 graph-builder。

验收：

- `CompanyCard` 可以附带 `chain_segments`。
- 每个 segment 明确 `semantic_layer`。
- 静态 HTML 可以从同一 JSON 画多层链。

### PR B：Component taxonomy expansion

扩充组件/原材料 taxonomy。

当前落地：

- `seeds/components.csv` 已从 8 个基础组件扩展到 wafer / HBM / advanced packaging / ABF substrate / EUV lithography / photoresist / specialty gases / PCB / power / cooling 等二三级研究对象。
- `@supplystrata/component-context` 提供组件上游研究 catalog。它把一级 fact edge 上的 component 展开成二三级 `lead` segment，例如 `wafer -> EUV lithography / silicon wafer / photoresist / specialty gases`，`manufacturing services -> PCB / power supply / cooling / export route`。
- 这些 segment 是 research lead，不是 graph fact edge；不会进入 `edges`，不会拿 evidence_level，也不会污染 Level 4/5 事实图。
- `@supplystrata/source-plan` 把这些 lead 映射到免费/公开数据源，并标明 `edge / observation / lead / entity` 输出层。二/三级链路可以规划去查 SEC/DART/EDINET、OSH、Comtrade/Census、NOAA AIS、USGS/EIA 等源，但 Comtrade/AIS/USGS 仍然只能产出 observation，不能直接产出公司级事实边。Apple Supplier List 这类公司专属来源必须带公司上下文才会进入计划。

验收：

- [x] AI compute / memory 相关组件能形成父子层级。
- [x] `memory -> HBM / DRAM`、`wafer -> silicon wafer / EUV / photoresist / specialty gases`、`advanced packaging -> substrate / interposer` 可查询。
- [x] 二/三级组件 lead 能生成对应免费数据源计划。
- [ ] `raw materials -> lithium/nickel/cobalt/copper/rare earths` 可查询。

### PR C：Observations schema

先建 observation 表，不接外部 adapter。

验收：

- trade / commodity / energy / port / route observations 有统一 provenance。
- observations 不会被 graph-builder 当成 edge。

### PR D：Facility candidates

接入或准备接入 Apple Supplier List 与 OSH 的 facility candidate 流。

验收：

- facility 可以显示在链图上。
- 未 review 的 facility relation 不进入默认 graph。

### PR E：Logistics manual evidence

先做手工物流证据录入，不做抓取。

验收：

- ImportYeti / BOL 手工片段可入 lead_observations。
- 自动标记 `freight_forwarder_risk`。
- 默认不出现在 Level 4/5 图谱。

### PR F：Raw-material observation adapter

优先 USGS MCS，再考虑 IEA / RMI。

验收：

- ComponentCard 能显示矿产级背景。
- 不生成公司级供应边。

## 8. 明确不做

- 不用国家级贸易数据生成公司级供应边。
- 不用 AIS 推断具体货物归属。
- 不把矿产主要生产国直接连到公司采购。
- 不因为图上好看就自动补二级/三级边。
- 不把 Level 1-3 默认展示成事实链。

## 9. 参考来源

- USGS Mineral Commodity Summaries：年度矿产数据，覆盖 90+ 矿产和材料。<https://www.usgs.gov/centers/national-minerals-information-center/mineral-commodity-summaries>
- IEA Critical Minerals Data Explorer：关键矿物需求/供应情景与公开数据。<https://www.iea.org/data-and-statistics/data-tools/critical-minerals-data-explorer>
- Open Supply Hub API：facility、contributors、processing type 等设施维度。<https://info.opensupplyhub.org/resources/api-documentation>
- U.S. Census International Trade API：月度贸易、HS、port、vessel/air value 等维度。<https://www.census.gov/data/developers/data-sets/international-trade.html>
- NOAA AccessAIS：按区域和时间下载美国水域 AIS 船舶交通数据。<https://coast.noaa.gov/digitalcoast/tools/ais.html>
- RMI facility lists：矿产冶炼/精炼/处理设施列表。<https://www.responsiblemineralsinitiative.org/facilities-lists/indicators/>
- EU Critical Raw Materials Act：关键原材料政策、监控、压力测试与供应链韧性。<https://single-market-economy.ec.europa.eu/sectors/raw-materials/areas-specific-interest/critical-raw-materials/critical-raw-materials-act_en>
