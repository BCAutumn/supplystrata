# Source ROI Matrix — 数据源投入产出排序

本文从产品经理视角评估数据源优先级。排序不是“哪个数据源有趣”，而是：

```text
接入成本 × 单位输入产出的边数 × 证据等级 × 法律风险 × 是否服务 v0.2 用户
```

## 总结

v0.2 的数据源优先级：

```text
1. Apple Supplier List
2. SEC 10-Q / 8-K
3. SEC 10-K 泛化到更多核心节点
4. Entity resolver 数据源和 golden set
5. DART-KR
6. apps/research-preview 消费 source health / changes
```

仍暂缓：

```text
Comtrade / EIA / FRED / NOAA AIS / GDELT
```

这些源很重要，但对 v0.2 默认事实边贡献低，应该先等 observation schema、source connector 契约和 ChainView 契约稳定。Census Trade 与 World Bank Pink Sheet 已作为 observation-only connector 接入；下一步 observation 源优先补 USGS MCS。

## ROI 表

| 数据源                             | 当前状态                                          | 接入成本 | 边产出                           | 等级上限 | 法律风险 | v0.2 ROI |
| ---------------------------------- | ------------------------------------------------- | -------- | -------------------------------- | -------- | -------- | -------- |
| SEC EDGAR 10-K                     | implemented                                       | 低       | 高，约 5-15 条/Tier-1 公司       | 5        | 极低     | 极高     |
| SEC EDGAR 10-Q / 8-K               | adapter 已支持 plan/fetch/normalize，monitor 未接 | 低       | 中，适合变化监控                 | 5        | 极低     | 极高     |
| Apple Supplier List                | preview/review 流程已有                           | 低       | 极高，设施候选多                 | 4        | 极低     | 极高     |
| DART-KR                            | scoped                                            | 中       | 中-高，Samsung/SK Hynix 交叉验证 | 4-5      | 极低     | 高       |
| EDINET                             | scoped/未列入 v0.2 P0                             | 中       | 中，日本供应链节点               | 4-5      | 极低     | 中高     |
| TSMC/Samsung/SK hynix/ASML IR 网页 | preview                                           | 中       | 低，多为 signal                  | 4        | 低       | 低到中   |
| OpenCorporates / Companies House   | preview                                           | 中       | 0 条供应边，但支撑实体解析       | n/a      | 极低     | 必备支撑 |
| UN Comtrade / Census / USITC       | Census preview；其余 scoped                       | 中       | 0 公司边，只 observation         | 2-3      | 极低     | Phase 3  |
| EIA / FRED / World Bank            | World Bank preview；其余 scoped                   | 低       | 0 公司边，只背景                 | 2-3      | 极低     | Phase 3  |
| USGS / IEA / RMI / EU CRMA         | scoped                                            | 中       | 0 公司边，组件/原材料背景        | 2-3      | 低       | Phase 3  |
| NOAA AIS / 港口数据                | scoped                                            | 高       | 0 公司边，route observation      | 2        | 低       | Phase 3+ |
| ImportYeti / BOL                   | manual only                                       | 低到中   | 推断边，但噪声高                 | 3        | 中       | 仅手工   |
| GDELT / SAM.gov / TED              | scoped                                            | 低       | lead 为主                        | 1-2      | 低       | Phase 3+ |

## 关键判断

### Apple Supplier List 要提前

它是当前最短路径：

```text
PDF / supplier list
  -> review candidates
  -> facility candidates
  -> MANUFACTURES_AT / OPERATES_FACILITY
  -> 50+ Level 4 facility edges
```

这比先接宏观源更能证明系统的核心价值。

### SEC 10-Q / 8-K 要提前

Source monitor 的产品价值是“今天有什么变了”。只跑 10-K 意味着一年才有一次主披露。10-Q / 8-K 是更合适的变化入口。

v0.2 验收目标：

```text
NVIDIA 最新 1 份 10-Q 可 plan/fetch/normalize
NVIDIA 最近若干份 8-K 可 plan/fetch/normalize
source_change_events 能看到 DOCUMENT_NEW / DOCUMENT_CHANGED
至少 1 条边或 claim 因新文件产生变化事件
```

### DART-KR 是高 ROI 的交叉验证源

当前 NVIDIA 10-K 给出的 memory/foundry 边主要来自买方自披露。若要真正做 cross-source corroboration，Samsung / SK Hynix 的监管披露比普通 IR 网页更有价值。

### 宏观和物流源先不急

Comtrade、EIA、NOAA AIS 很重要，但它们不能直接回答公司级关系。observation schema 已经落地后，接入顺序要继续按“是否能服务二级/三级链路”排序：USGS MCS 优先于 EIA/FRED/NOAA AIS。

## v0.2 接入顺序

1. Apple Supplier List facility review/apply。
2. SEC 10-Q / 8-K plan/fetch/normalize。
3. Generic SEC rule pack 复用到更多核心节点。
4. EntityResolver golden set。
5. ComponentCard / Research Workbench 消费上述结果。
6. USGS MCS，把材料层 planned target 变成 runnable observation。
7. DART-KR 作为 P1 事实边交叉验证源。
