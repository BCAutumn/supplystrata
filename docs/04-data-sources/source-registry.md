# Source Registry — 数据源总表

每个数据源在系统中以 `source_adapter_id` 为唯一键。本文是该键的权威清单。新增/删除数据源必须 PR 修改本表。

## 优先级定义

- **P0**：MVP 必须接入
- **P1**：MVP 通过后的第一批扩源（默认 Phase 3）
- **P2**：更后期接入或仅手工使用

## 总表

| source_adapter_id | tier | 数据源                        | 主要拿到什么                              | 默认证据等级范围 | 接入方式             | ToS / 法律           | 状态        |
| ----------------- | ---- | -------------------------- | ----------------------------------- | -------- | ---------------- | ------------------ | --------- |
| `sec-edgar`       | P0   | SEC EDGAR                  | 10-K / 10-Q / 20-F / 8-K / company facts | 4-5      | 官方 REST API      | 公开 + UA 必填          | implemented |
| `company-ir`      | P0   | 公司 IR 官网（多 adapter 子项）     | 年报 / earnings / presentation         | 4-5      | 受控 HTTP，单页解析     | 各家网站 ToS 各异         | planned   |
| `tsmc-ir`         | P0   | TSMC IR                    | 年报 / 月度营收 / 财报                       | 4-5      | HTTP + PDF       | 公开                 | preview |
| `samsung-ir`      | P0   | Samsung IR                 | 年报 / IR materials                    | 4-5      | HTTP + PDF       | 公开                 | preview |
| `skhynix-ir`      | P0   | SK Hynix IR                | Earnings release / IR transcripts    | 4-5      | HTTP + PDF       | 公开                 | preview |
| `asml-ir`         | P0   | ASML IR                    | 年报 / quarterly                       | 4-5      | HTTP + PDF       | 公开                 | preview |
| `apple-suppliers` | P0   | Apple Supplier List + 报告    | 供应商名单（含工厂地点）                        | 4        | 半自动 PDF + 校验      | 公开                 | preview |
| `opencorporates`  | P0   | OpenCorporates             | 全球公司实体 / 别名                          | 用于 entity-resolution | 官方 API + token（限速） | 公开 + 注明来源           | preview |
| `companies-house` | P0   | UK Companies House         | 英国公司登记                              | 用于 entity-resolution | 官方 API + key      | OGL v3              | preview |
| `seed-entities`   | P0   | 项目内 curated seed CSV       | 核心公司 / 高频供应商 / ticker / CIK / alias       | 用于 entity-resolution | 手工维护 + 官方来源校验      | 仅存事实标识             | implemented |
| `dart-kr`         | P1   | 韩国 DART                    | Samsung / SK Hynix 韩文披露              | 4-5      | API              | 公开                 | scoped    |
| `un-comtrade`     | P1   | UN Comtrade                | 国家-商品贸易流（HS code）                    | 2-3      | API（限速）           | 注册 + 限速             | scoped    |
| `census-trade`    | P1   | U.S. Census International Trade | 美国进出口（月度）                           | 2-3      | API              | 公开                 | scoped    |
| `usitc-dataweb`   | P1   | USITC DataWeb              | 美国官方贸易/关税                           | 2-3      | API/CSV          | 公开                 | scoped    |
| `eia`             | P1   | U.S. EIA                   | 能源 / 电力 / 油气数据                       | 2-3 (背景信号) | API              | 公开 + UA             | scoped    |
| `fred`            | P1   | FRED (St. Louis Fed)       | 宏观经济时间序列                            | 2-3 (背景信号) | API              | 公开                 | scoped    |
| `worldbank-pink`  | P1   | World Bank Pink Sheet      | 商品价格月度数据                            | 2-3 (背景信号) | XLSX 下载           | 公开                 | scoped    |
| `usgs-mcs`        | P1   | USGS Mineral Commodity Summaries | 矿产基本面                              | 2-3 (背景信号) | PDF + CSV         | 公开                 | scoped    |
| `osh`             | P1   | Open Supply Hub            | 全球生产设施                             | 3-4      | API              | 公开                 | scoped    |
| `noaa-ais`        | P2   | NOAA AccessAIS / bulk      | 美国水域 AIS 船舶                          | 2 (背景信号)  | 下载 / 区域选择          | 公开                 | scoped    |
| `sam-gov`         | P2   | SAM.gov Contract Opportunities | 美国联邦采购机会                           | 2-3      | API              | 公开                 | scoped    |
| `usaspending`     | P2   | USAspending.gov            | 美国联邦合同 / 拨款                          | 2-3      | API              | 公开                 | scoped    |
| `eu-ted`          | P2   | EU TED                     | 欧洲公共采购                             | 2-3      | API              | 公开                 | scoped    |
| `gdelt`           | P2   | GDELT                      | 全球新闻事件                            | 1-2 (线索)  | API/BQ            | 公开                 | scoped    |
| `manual`          | P0   | 手动录入                       | 任何无法/不便自动化的证据                       | by case  | CLI 命令            | n/a                | planned   |
| `import-yeti`     | -    | ImportYeti                  | 美国 BOL 搜索                            | 3        | **不做自动抓取**；仅手工录入 + manual | ToS 严禁自动化         | not adapter |

`status` 取值：

- `implemented`：已进入可落库/可运行主链路
- `preview`：已进入无数据库预览链路，但还没有完整 review/apply 主链路
- `planned`：MVP 范围内
- `scoped`：已规划但未接入
- `experimental`：试用中
- `deprecated`：弃用
- `rejected`：审视后明确不接

## 各数据源的细节文档

每层都有独立文档，含字段映射、限速、已知盲区、错误码处理：

- [tier-A-disclosures.md](./tier-A-disclosures.md) — sec-edgar / company-ir / dart-kr / apple-suppliers
- [tier-B-entity-resolution.md](./tier-B-entity-resolution.md) — opencorporates / companies-house
- [tier-C-facility-data.md](./tier-C-facility-data.md) — osh / apple-suppliers (作为 facility 视角)
- [tier-D-trade-customs.md](./tier-D-trade-customs.md) — un-comtrade / census-trade / usitc-dataweb / import-yeti（手工）
- [tier-E-shipping-logistics.md](./tier-E-shipping-logistics.md) — noaa-ais / port dashboards
- [tier-F-energy-commodities.md](./tier-F-energy-commodities.md) — eia / fred / worldbank-pink / usgs-mcs
- [tier-G-procurement-news.md](./tier-G-procurement-news.md) — sam-gov / usaspending / eu-ted / gdelt

## 默认证据等级映射

evidence-scorer 根据 source_adapter_id 设默认上限：

```
sec-edgar           → 5
dart-kr             → 5
company-ir (10-K-equivalent annual) → 5
company-ir (presentations / investor day)  → 4
apple-suppliers     → 4
osh                 → 3 (供应商-设施关系)
un-comtrade         → 2 (国别趋势)
census-trade        → 2
usitc-dataweb       → 2
import-yeti (manual)→ 3 (≥6 重复 BOL)
eia / fred / wb / usgs → 2 (背景信号)
noaa-ais            → 2 (背景信号)
sam-gov / usaspending / eu-ted → 2-3 (具体合同 → 3)
gdelt               → 1
manual              → by reviewer (默认 4，需要 cite 原文)
```

抽取方法是 LLM 时仍按 [evidence-model.md](../03-data-model/evidence-model.md) 中"LLM 上限 4"规则降级。

## Rate Limit 默认值

如果数据源未明确说明，按下面默认：

| 类型             | 默认 rate                  |
| -------------- | ------------------------ |
| 美国政府 API（无 key） | 1 req/s, 含 UA            |
| 美国政府 API（有 key） | 5 req/s, 视 API 文档而定      |
| 公司 IR / 静态 PDF  | 1 req/3s，且加随机抖动           |
| 第三方付费/限频 API   | 严格按 docs；有 retry-after 必看 |

实际值在每个 adapter README 里写死。

## 接入 checklist（PR 必须包含）

详见 [extensibility.md](../02-architecture/extensibility.md)。简版：

```
[ ] 在本文件加一行
[ ] 在 packages/sources/<id>/README.md 写明：limits、ToS、字段、已知盲区
[ ] tos_url 实测可访问
[ ] fixture 测试 ≥ 5
[ ] evidence-scorer 默认等级映射加 case
[ ] legal-tos.md 加条目
[ ] data-licenses.md 加条目（如果是新许可）
```

## 数据源退役

如某数据源失效（API 停服、ToS 收紧、质量下降）：

1. 标 status = `deprecated`
2. 已抽取的 evidence 不删，但新文档不再 fetch
3. 在 ChangeRecord 中记一条系统层面的变更
4. 评估对图谱的影响（哪些边只剩单一来源）
