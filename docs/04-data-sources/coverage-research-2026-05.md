# Data Coverage Research — 2026-05

本文记录 2026-05 的免费/公开数据源覆盖研究，用来指导下一批 connector 的优先级。核心原则不变：

```text
官方披露源补事实边。
宏观、贸易、能源、物流、商品、矿产源补 observation。
新闻、采购、BOL 只进 lead / review，不直接进事实图。
```

## 当前覆盖快照

`supplystrata sources catalog` 当前显示：

| 类别                   | 数量 |
| ---------------------- | ---- |
| 总 source              | 31   |
| `implemented`          | 2    |
| `preview`              | 10   |
| `scoped`               | 16   |
| `planned`              | 2    |
| `manual_only`          | 1    |
| 已注册可执行 connector | 8    |

可执行 connector 当前覆盖：

| source           | connector                     | 输出层      |
| ---------------- | ----------------------------- | ----------- |
| `sec-edgar`      | `sec-company-filings`         | edge/claim  |
| `tsmc-ir`        | `official-html-disclosure`    | signal/edge |
| `samsung-ir`     | `official-html-disclosure`    | signal/edge |
| `skhynix-ir`     | `official-html-disclosure`    | signal/edge |
| `asml-ir`        | `official-html-disclosure`    | signal/edge |
| `census-trade`   | `trade-flow-observation`      | observation |
| `osh`            | `facility-search`             | observation |
| `worldbank-pink` | `commodity-price-observation` | observation |

## 下一批优先级

### 1. USGS MCS：原材料 supply observation

**建议优先级：最高，下一步直接做。**

USGS Mineral Commodity Summaries 2025 官方 data release 提供 CSV 表，覆盖 90+ 种非燃料矿产的美国 salient statistics 和世界产量/储量数据，许可为 CC0。它可以把 `MAT-SILICON / MAT-COPPER / MAT-INDIUM / MAT-RARE-EARTHS` 从“材料暴露”推进到可复现 `MINERAL_SUPPLY_OBSERVATION`。

官方参考：

- `https://www.usgs.gov/publications/mineral-commodity-summaries-2025`
- `https://www.usgs.gov/data/us-geological-survey-mineral-commodity-summaries-2025-data-release`

边界：

- 只能证明国家/商品级 supply context。
- 不能生成 `Company -> Mine`、`Company -> Country` 或 `Company -> Smelter` 事实边。
- 适合进入 ComponentCard / ChainView 的 observation lane。

建议 connector：

```text
source_adapter_id: usgs-mcs
target_kind: mineral-supply-observation
required config:
  mineral: string
  period: YYYY
optional:
  material_id
  component_id
  scope_kind
  scope_id
```

### 2. DART-KR：Samsung / SK Hynix 官方披露事实边

**建议优先级：最高，但排在 USGS 之后。**

OpenDART 官方开发者指南提供 corp code、disclosure list、document download 等接口。对 SupplyStrata 来说，DART-KR 是把 NVIDIA 10-K 单边披露变成交叉验证的关键源，尤其是 Samsung Memory / Samsung Foundry / SK Hynix 的监管披露。

官方参考：

- `https://engopendart.fss.or.kr/guide/detail.do?apiGrpCd=DE001&apiId=AE00001`
- `https://opendart.fss.or.kr/intro/infoApiList.do`
- `https://opendart.fss.or.kr/api/list.json`
- `https://opendart.fss.or.kr/api/corpCode.xml`

边界：

- 需要免费 API key。
- 韩文披露优先；英文材料可能滞后。
- HWP 文档先不做，MVP 子集只处理 HTML/XML/PDF 可解析路径。
- 对 `Samsung` 必须保留 Memory / Foundry / Electronics / Display / SDI 层级，不做粗合并。

建议 connector：

```text
source_adapter_id: dart-kr
target_kind: company-filings
required config:
  corp_code: string
  entity_id: string
  report_types: string[]
  start_date: YYYYMMDD
  end_date: YYYYMMDD
optional:
  last_only
  limit
```

### 3. EDINET：日本官方披露事实边

**建议优先级：高，DART 后做。**

EDINET API v2 官方规格支持 documents list 和文档下载。它适合覆盖 Tokyo Electron、Sony、Murata、Shin-Etsu、Renesas、Ibiden 等日本半导体/电子供应链节点，用于官方披露事实边与实体/子公司上下文。

官方参考：

- `https://disclosure2dl.edinet-fsa.go.jp/guide/static/disclosure/WEEK0060.html`
- `https://disclosure2dl.edinet-fsa.go.jp/guide/static/disclosure/download/ESE140206.pdf`
- `https://api.edinet-fsa.go.jp/api/v2/documents.json`

边界：

- 需要处理日文文档和 XBRL/PDF 两种路径。
- 第一版只做 documents list + PDF/XBRL ZIP 保存 + normalized text，不急着做复杂 XBRL。
- 事实边规则必须比普通 IR 更严格，避免把客户/竞争/合作关系误升为供应链关系。

### 4. IEA Critical Minerals Dataset：长期供需情景 observation

**建议优先级：中高，USGS 后做。**

IEA Critical Minerals Dataset 是免费数据产品，许可 CC BY 4.0，提供 Critical Minerals Data Explorer 背后的 supply / demand 数据。它适合给材料层补长期供需情景，不适合生成公司级边。

官方参考：

- `https://www.iea.org/data-and-statistics/data-product/critical-minerals-dataset`
- `https://www.iea.org/data-and-statistics/data-tools/critical-minerals-data-explorer`

边界：

- 场景数据不能当事实边。
- 适合 `CRITICAL_MINERALS_DEMAND_OBSERVATION` 或先复用 `MINERAL_SUPPLY_OBSERVATION` 的 `attrs.scenario`。
- 必须保留 IEA attribution。

### 5. EIA / FRED / NOAA AIS：能源与物流 observation

**建议优先级：中。**

EIA API v2 可获取电力、天然气、油品等能源数据；FRED 可获取宏观时间序列；NOAA AccessAIS 可按区域和时间下载美国水域 AIS point data，并提供交通模式/船舶数量可视化。这三类源价值很大，但不该在事实边还没厚起来前优先。

官方参考：

- EIA API v2: `https://www.eia.gov/opendata/documentation.php`
- FRED API: `https://fred.stlouisfed.org/docs/api/fred`
- NOAA AccessAIS: `https://coast.noaa.gov/digitalcoast/tools/ais.html`

边界：

- EIA/FRED 进入 energy / macro observations。
- AIS 进入 port / route observations。
- AIS 不能证明货主、订单、承运合同或公司级路线。

## 战略排序

下一步建议按这个顺序：

```text
1. usgs-mcs connector
   目标：把材料层从 taxonomy 变成 MINERAL_SUPPLY_OBSERVATION。

2. dart-kr connector
   目标：把 Samsung / SK Hynix / LG / Samsung SDI 等韩国节点的官方披露纳入事实边和交叉验证。

3. edinet connector
   目标：覆盖日本半导体设备、材料、电子元件公司。

4. iea-critical-minerals connector
   目标：补长期矿产供需情景 observation。

5. eia/fred/noaa-ais connector
   目标：补能源/宏观/物流 lane；不碰事实边。
```

## 不建议下一步做的事

- 不建议先做新闻/GDELT：线索多但噪声高，容易污染方向。
- 不建议先做 NOAA AIS 深分析：没有公司货主归属，必须等 route observation 和港口 taxonomy 更稳定。
- 不建议先让 LLM 自动抽事实边：官方披露和 observation 覆盖还没厚到足以约束它。
- 不建议把 USGS / IEA / WorldBank 的材料数据画成供应链事实边：它们是公开观测，不是关系证据。
