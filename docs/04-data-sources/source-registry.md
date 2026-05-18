# Source Registry — 数据源总表

每个数据源在系统中以 `source_adapter_id` 为唯一键。本文是该键的权威清单。新增/删除数据源必须 PR 修改本表。

## 优先级定义

- **P0**：MVP 必须接入
- **P1**：MVP 通过后的第一批扩源（默认 Phase 3）
- **P2**：更后期接入或仅手工使用

## 总表

| source_adapter_id       | tier | 数据源                                         | 主要拿到什么                                 | 默认证据等级范围       | 接入方式                              | ToS / 法律        | 状态        |
| ----------------------- | ---- | ---------------------------------------------- | -------------------------------------------- | ---------------------- | ------------------------------------- | ----------------- | ----------- |
| `sec-edgar`             | P0   | SEC EDGAR                                      | 10-K / 10-Q / 20-F / 8-K / company facts     | 4-5                    | 官方 REST API                         | 公开 + UA 必填    | implemented |
| `company-ir`            | P0   | 公司 IR 官网（多 adapter 子项）                | 年报 / earnings / presentation               | 4                      | 受控 HTTP，单页解析                   | 各家网站 ToS 各异 | planned     |
| `tsmc-ir`               | P0   | TSMC IR                                        | 年报 / 月度营收 / 财报                       | 4                      | HTTP + PDF                            | 公开              | preview     |
| `samsung-ir`            | P0   | Samsung IR                                     | 年报 / IR materials                          | 4                      | HTTP + PDF                            | 公开              | preview     |
| `skhynix-ir`            | P0   | SK Hynix IR                                    | Earnings release / IR transcripts            | 4                      | HTTP + PDF                            | 公开              | preview     |
| `asml-ir`               | P0   | ASML IR                                        | 年报 / quarterly                             | 4                      | HTTP + PDF                            | 公开              | preview     |
| `apple-suppliers`       | P0   | Apple Supplier List + 报告                     | 供应商名单（含工厂地点）                     | 4                      | 半自动 PDF + 校验                     | 公开              | preview     |
| `opencorporates`        | P0   | OpenCorporates                                 | 全球公司实体 / 别名                          | 用于 entity-resolution | 官方 API + token（限速）              | 公开 + 注明来源   | preview     |
| `companies-house`       | P0   | UK Companies House                             | 英国公司登记                                 | 用于 entity-resolution | 官方 API + key                        | OGL v3            | preview     |
| `seed-entities`         | P0   | 项目内 curated seed CSV                        | 核心公司 / 高频供应商 / ticker / CIK / alias | 用于 entity-resolution | 手工维护 + 官方来源校验               | 仅存事实标识      | implemented |
| `company-ir`            | P1   | 通用公司 IR 源位                               | 新公司 IR adapter 的规划占位                 | 4                      | 具体 adapter 必须单独实现             | 各公司 ToS        | planned     |
| `dart-kr`               | P1   | 韩国 DART                                      | Samsung / SK Hynix 韩文披露                  | 4-5                    | API                                   | 公开              | scoped      |
| `edinet`                | P1   | 日本 EDINET                                    | 日本上市公司监管披露                         | 4-5                    | API / 下载                            | 公开              | scoped      |
| `un-comtrade`           | P1   | UN Comtrade                                    | 国家-商品贸易流（HS code）                   | 2-3                    | API（限速）                           | 注册 + 限速       | scoped      |
| `census-trade`          | P1   | U.S. Census International Trade                | 美国进出口（月度）                           | 2                      | API + 免费 key                        | 公开              | preview     |
| `usitc-dataweb`         | P1   | USITC DataWeb                                  | 美国官方贸易/关税                            | 2-3                    | API/CSV                               | 公开              | scoped      |
| `eia`                   | P1   | U.S. EIA                                       | 能源 / 电力 / 油气数据                       | 2-3 (背景信号)         | API                                   | 公开 + UA         | scoped      |
| `fred`                  | P1   | FRED (St. Louis Fed)                           | 宏观经济时间序列                             | 2-3 (背景信号)         | API                                   | 公开              | scoped      |
| `worldbank-pink`        | P1   | World Bank Pink Sheet                          | 商品价格月度数据                             | 2-3 (背景信号)         | XLSX 下载                             | 公开              | preview     |
| `usgs-mcs`              | P1   | USGS Mineral Commodity Summaries               | 矿产基本面                                   | 2-3 (背景信号)         | PDF + CSV                             | 公开              | scoped      |
| `iea-critical-minerals` | P1   | IEA Critical Minerals Data Explorer            | 关键矿物需求 / 供应情景                      | 2-3 (背景信号)         | CSV/API/下载（以官方可用方式为准）    | 公开              | scoped      |
| `rmi-facilities`        | P1   | Responsible Minerals Initiative facility lists | 冶炼 / 精炼 / 处理设施候选                   | 2-3 (设施/原材料候选)  | CSV/XLSX/网页下载（需遵守来源条款）   | 公开 + 归因       | scoped      |
| `eu-crma`               | P1   | EU Critical Raw Materials Act                  | 关键原材料政策 / 风险 / 战略项目背景         | 2-3 (政策背景信号)     | 官方网页 / PDF                        | 公开              | scoped      |
| `osh`                   | P1   | Open Supply Hub                                | 全球生产设施                                 | 3                      | API + token                           | 公开 + 归因       | preview     |
| `noaa-ais`              | P2   | NOAA AccessAIS / bulk                          | 美国水域 AIS 船舶                            | 2 (背景信号)           | 下载 / 区域选择                       | 公开              | scoped      |
| `sam-gov`               | P2   | SAM.gov Contract Opportunities                 | 美国联邦采购机会                             | 2-3                    | API                                   | 公开              | scoped      |
| `usaspending`           | P2   | USAspending.gov                                | 美国联邦合同 / 拨款                          | 2-3                    | API                                   | 公开              | scoped      |
| `eu-ted`                | P2   | EU TED                                         | 欧洲公共采购                                 | 2-3                    | API                                   | 公开              | scoped      |
| `gdelt`                 | P2   | GDELT                                          | 全球新闻事件                                 | 1-2 (线索)             | API/BQ                                | 公开              | scoped      |
| `manual`                | P0   | 手动录入                                       | 任何无法/不便自动化的线索                    | 1-2                    | CLI 命令                              | n/a               | planned     |
| `import-yeti`           | -    | ImportYeti                                     | 美国 BOL 搜索                                | 3                      | **不做自动抓取**；仅手工录入 + manual | ToS 严禁自动化    | not adapter |

`status` 取值：

- `implemented`：已进入可落库/可运行主链路
- `preview`：已进入无数据库预览链路，但还没有完整 review/apply 主链路
- `planned`：MVP 范围内
- `scoped`：已规划但未接入
- `experimental`：试用中
- `deprecated`：弃用
- `rejected`：审视后明确不接

代码中的权威清单在 `packages/source-registry`。文档表新增任何 source 后，代码 registry 也必须同步新增，否则 CLI、source monitor 与 scorer 看不到该来源。

## Source Plan 边界

`packages/source-plan` 是二级/三级链路寻找免费数据源的统一规划层。它读取：

- `packages/component-context`：组件上游 lead，例如 `wafer -> silicon wafer / EUV / photoresist`
- `packages/source-registry`：哪些免费源存在、证据上限、自动化策略和 ToS 状态

输出只是一份计划，明确每个来源进入哪一层：

| output layer  | 含义                                    | 例子                                  |
| ------------- | --------------------------------------- | ------------------------------------- |
| `edge`        | 只有官方披露/官方供应商名单能生成事实边 | SEC、DART、EDINET、Apple Supplier     |
| `entity`      | 只做实体/设施/注册事实                  | OpenCorporates、Companies House       |
| `observation` | 宏观、贸易、物流、能源、商品背景        | Comtrade、Census、NOAA AIS、USGS      |
| `lead`        | 线索池，必须人工 review                 | SAM.gov、USAspending、GDELT、BOL 手工 |

示例：

```bash
pnpm cli sources plan --component COMP-WAFER --format markdown
pnpm cli sources plan --component COMP-MANUFACTURING-SERVICES --depth 3 --format json
pnpm cli sources plan --component COMP-MANUFACTURING-SERVICES --entity ENT-APPLE --depth 3
```

这层设计是为了避免把免费宏观源直接污染事实图谱：Comtrade/AIS/EIA/USGS 这类数据可以支持研究判断，但默认只能进入 observation；ImportYeti/BOL 只能手工进入 lead。公司专属来源也不能被通用化，例如 `apple-suppliers` 只有在计划 Apple 链路（传入 `--entity ENT-APPLE`）时才会出现，避免二/三级链路被某个测试公司硬耦合。

## 各数据源的细节文档

每层都有独立文档，含字段映射、限速、已知盲区、错误码处理：

- [tier-A-disclosures.md](./tier-A-disclosures.md) — sec-edgar / company-ir / dart-kr / apple-suppliers
- [tier-B-entity-resolution.md](./tier-B-entity-resolution.md) — opencorporates / companies-house
- [tier-C-facility-data.md](./tier-C-facility-data.md) — osh / apple-suppliers (作为 facility 视角)
- [tier-D-trade-customs.md](./tier-D-trade-customs.md) — un-comtrade / census-trade / usitc-dataweb / import-yeti（手工）
- [tier-E-shipping-logistics.md](./tier-E-shipping-logistics.md) — noaa-ais / port dashboards
- [tier-F-energy-commodities.md](./tier-F-energy-commodities.md) — eia / fred / worldbank-pink / usgs-mcs / iea-critical-minerals / rmi-facilities / eu-crma
- [tier-G-procurement-news.md](./tier-G-procurement-news.md) — sam-gov / usaspending / eu-ted / gdelt

## Source Authority Matrix

evidence-scorer 不只看 `document_type`，而是通过 `packages/source-registry` 同时读取：

- `publisher_type`：谁发布了这份材料
- `relation_authority`：这份材料能证明哪类关系
- `max_evidence_level`：来源本身的最高等级

当前已落地的映射：

| source_adapter_id                                           | publisher_type             | relation_authority | max_evidence_level | 证据边界                                                                            |
| ----------------------------------------------------------- | -------------------------- | ------------------ | ------------------ | ----------------------------------------------------------------------------------- |
| `sec-edgar`                                                 | `regulator`                | `self_disclosure`  | 5                  | 监管披露中的公司自述可到 Level 5。                                                  |
| `tsmc-ir` / `samsung-ir` / `skhynix-ir` / `asml-ir`         | `company_official`         | `self_disclosure`  | 4                  | 公司官方材料可到 Level 4；除非未来建模为同等监管文件，否则不自动升 Level 5。        |
| `apple-suppliers`                                           | `official_supplier_list`   | `facility_claim`   | 4                  | 官方供应商/设施名单，必须经过 review/apply。                                        |
| `opencorporates` / `companies-house`                        | `government_registry`      | `registry_fact`    | 4                  | 可证明注册、控制、设施等实体事实；对 `BUYS_FROM` / `SUPPLIES_TO` 只能到低等级线索。 |
| `seed-entities`                                             | `manual`                   | `registry_fact`    | 4                  | 只用于实体解析，不作为供应链关系证据。                                              |
| `manual`                                                    | `manual`                   | `lead_only`        | 2                  | 人工录入本身不是原始来源；没有 underlying official source 时只能作为线索。          |
| `import-yeti`                                               | `manual`                   | `lead_only`        | 3                  | 不做 adapter；手工摘录也只能作为低等级线索，默认需要 review。                       |
| `dart-kr` / `edinet`                                        | `regulator`                | `self_disclosure`  | 5                  | 同等监管披露可到 Level 5，但必须先实现 adapter 与 parser。                          |
| `osh` / `rmi-facilities`                                    | `official_supplier_list`   | `facility_claim`   | 3                  | 第三方/行业设施列表默认是 facility candidate；交叉验证前不自动升事实边。            |
| `un-comtrade` / `census-trade` / `usitc-dataweb`            | `macro_statistical_agency` | `macro_trend`      | 2                  | 国家/商品贸易流只能进入 observation。                                               |
| `noaa-ais` / `eia` / `fred` / `worldbank-pink` / `usgs-mcs` | `macro_statistical_agency` | `macro_trend`      | 2                  | 物流、能源、商品和矿产数据只能作为背景观测。                                        |
| `sam-gov` / `usaspending` / `eu-ted` / `gdelt`              | `regulator` 或 `news`      | `lead_only`        | 1-2                | 采购/新闻只能进入 lead/hypothesis queue。                                           |

未注册 adapter 一律按 `manual / lead_only / max_evidence_level=2` 处理；不能只因为 `document_type` 写成 `10-K` 或 `annual_report` 就获得高证据等级。新增高权威来源必须先进入 source registry。离线 fixture 若要测试 SEC 权威评分，应使用 `source_adapter_id = sec-edgar` 并把 URL / storage key 标记为 fixture 路径；测试专用 adapter id 不再在生产 registry 里短路映射。

抽取方法是 LLM 时仍按 [evidence-model.md](../03-data-model/evidence-model.md) 中"LLM 上限 4"规则降级。宏观贸易、能源、AIS、新闻和采购类来源默认进入 observations / leads，不得直接生成高等级公司供应链边。

## Rate Limit 默认值

如果数据源未明确说明，按下面默认：

| 类型                   | 默认 rate                        |
| ---------------------- | -------------------------------- |
| 美国政府 API（无 key） | 1 req/s, 含 UA                   |
| 美国政府 API（有 key） | 5 req/s, 视 API 文档而定         |
| 公司 IR / 静态 PDF     | 1 req/3s，且加随机抖动           |
| 第三方付费/限频 API    | 严格按 docs；有 retry-after 必看 |

实际值在每个 adapter README 里写死。

## 接入 checklist（PR 必须包含）

详见 [extensibility.md](../02-architecture/extensibility.md)。简版：

```
[ ] 在本文件加一行
[ ] 在 packages/sources/<id>/README.md 写明：limits、ToS、字段、已知盲区
[ ] tos_url 实测可访问
[ ] fixture 测试 ≥ 5
[ ] source-registry 增加 `publisher_type` / `relation_authority` / `max_evidence_level`
[ ] legal-tos.md 加条目
[ ] data-licenses.md 加条目（如果是新许可）
```

## 数据源退役

如某数据源失效（API 停服、ToS 收紧、质量下降）：

1. 标 status = `deprecated`
2. 已抽取的 evidence 不删，但新文档不再 fetch
3. 在 ChangeRecord 中记一条系统层面的变更
4. 评估对图谱的影响（哪些边只剩单一来源）
