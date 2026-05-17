# Target Companies — 第一批研究对象

MVP 阶段的实体宇宙。这份名单是 `seeds/entities.csv` 的源头，写代码前必须冻结一次（再加新实体要走 PR）。

口径说明：下面的"核心研究节点"包含 `company` 与少量必须建模的 `business_unit`。Phase 0 的 seeds 至少锁定 25 个核心研究节点 + 30 个关联/桥接实体；MVP 出场前扩到至少 50 个关联/桥接实体。

## 选择标准

1. 公开披露质量高（有 SEC filing 或英文 IR）
2. 在 AI 算力 / 内存链上是关键节点
3. 至少有一个高置信度的上下游公开关系
4. 命名歧义可控（或可通过别名表覆盖）

## 名单（25 个核心研究节点 + 至少 50 个关联/桥接实体）

### 需求端（5）

| Name      | Ticker | CIK        | 主要披露 | 备注           |
| --------- | ------ | ---------- | -------- | -------------- |
| Microsoft | MSFT   | 0000789019 | 10-K, IR | Azure capex    |
| Amazon    | AMZN   | 0001018724 | 10-K, IR | AWS capex      |
| Alphabet  | GOOGL  | 0001652044 | 10-K, IR | GCP capex      |
| Meta      | META   | 0001326801 | 10-K, IR | AI infra capex |
| Oracle    | ORCL   | 0001341439 | 10-K, IR | OCI capex      |

### 芯片设计（3）

| Name     | Ticker | CIK        | 备注                           |
| -------- | ------ | ---------- | ------------------------------ |
| NVIDIA   | NVDA   | 0001045810 | 公开披露质量最高，作为示例公司 |
| AMD      | AMD    | 0000002488 | MI300/MI350                    |
| Broadcom | AVGO   | 0001730168 | 含 networking ASIC             |

### 晶圆代工（3）

| Name            | Ticker                     | 主要披露 | 备注                                |
| --------------- | -------------------------- | -------- | ----------------------------------- |
| TSMC            | TSM (ADR)                  | 20-F, IR | 月度营收                            |
| Samsung Foundry | (Samsung 005930.KS 子部门) | DART, IR | 与 Memory 部门同集团但需建独立 node |
| Intel           | INTC                       | 10-K, IR | Intel Foundry                       |

### 内存（3 家公司，至少 4 个 node）

| Name                         | Ticker           | 备注                                                                      |
| ---------------------------- | ---------------- | ------------------------------------------------------------------------- |
| SK Hynix                     | 000660.KS        | DART + 英文 IR                                                            |
| Micron                       | MU               | 10-K                                                                      |
| Samsung Memory               | (Samsung 子部门) | 与 Foundry 区分为独立 node                                                |
| Samsung Electronics (parent) | 005930.KS        | 桥接实体，不计入 25 个核心研究节点；OWNS_BUSINESS_UNIT → Foundry / Memory |

### 半导体设备（4）

| Name              | Ticker | 备注     |
| ----------------- | ------ | -------- |
| ASML              | ASML   | 20-F, IR |
| Applied Materials | AMAT   | 10-K     |
| Lam Research      | LRCX   | 10-K     |
| KLA               | KLAC   | 10-K     |

### 组装 / 服务器 ODM / OEM（7）

| Name              | Ticker  | 备注                                  |
| ----------------- | ------- | ------------------------------------- |
| Foxconn (Hon Hai) | 2317.TW | 别名重灾区，详见 entity-resolution.md |
| Quanta Computer   | 2382.TW | AI server ODM                         |
| Wistron           | 3231.TW | AI server ODM                         |
| Inventec          | 2356.TW |                                       |
| Supermicro        | SMCI    | 10-K                                  |
| Dell Technologies | DELL    | 10-K                                  |
| HPE               | HPE     | 10-K                                  |

### 测试封装（1，参考用，不计入 25 个核心研究节点）

| Name     | Ticker | 备注                   |
| -------- | ------ | ---------------------- |
| Fabrinet | FN     | NVIDIA 10-K 已直接点名 |

## 关联法人（≥ 50 个，部分举例）

每个上面公司的子公司、合资公司、关键工厂法人都要进 `entity_master`。这一步不能偷懒。举几个易错例：

```
Hon Hai Precision Industry Co., Ltd. (parent, 2317.TW)
├── Foxconn Industrial Internet Co., Ltd. (FII, 601138.SS)
├── FIH Mobile Limited (2038.HK)
├── Hongfujin Precision Industry (Shenzhen) Co., Ltd.
├── Foxconn Assembly LLC (US)
├── Foxconn Ohio (entity for Wisconsin/Ohio plants)
└── ...
```

```
Samsung Electronics Co., Ltd. (parent, 005930.KS)
├── Samsung Semiconductor (Memory Business)
├── Samsung Foundry (formerly System LSI sibling)
├── Samsung Display
├── Samsung Austin Semiconductor LLC
└── ...
```

```
Taiwan Semiconductor Manufacturing Company Limited (parent, 2330.TW / TSM)
├── TSMC North America
├── TSMC Arizona Corporation
├── TSMC Japan (JASM)
├── TSMC Europe B.V.
├── Vanguard International Semiconductor (associate, 5347.TWO)
└── ...
```

## 别名清单（节选）

完整清单维护在 `seeds/aliases.csv`，下面是必须先入仓的高频别名。

| canonical_id | alias                              | language |
| ------------ | ---------------------------------- | -------- |
| ENT-FOXCONN  | Foxconn                            | en       |
| ENT-FOXCONN  | Hon Hai                            | en       |
| ENT-FOXCONN  | Hon Hai Precision Industry         | en       |
| ENT-FOXCONN  | 鴻海                               | zh-Hant  |
| ENT-FOXCONN  | 鸿海                               | zh-Hans  |
| ENT-FOXCONN  | 富士康                             | zh-Hans  |
| ENT-NVIDIA   | NVIDIA                             | en       |
| ENT-NVIDIA   | NVIDIA Corporation                 | en       |
| ENT-NVIDIA   | 英伟达                             | zh-Hans  |
| ENT-NVIDIA   | 輝達                               | zh-Hant  |
| ENT-TSMC     | TSMC                               | en       |
| ENT-TSMC     | Taiwan Semiconductor Manufacturing | en       |
| ENT-TSMC     | 台積電                             | zh-Hant  |
| ENT-TSMC     | 台积电                             | zh-Hans  |
| ...          | ...                                | ...      |

注意：`Samsung` 单独这个词在不同上下文里可能指：

- Samsung Electronics（集团母）
- Samsung Foundry（晶圆部门）
- Samsung Memory（内存部门）
- Samsung Display
- Samsung SDI（电池）

**默认禁止**把孤立 "Samsung" 直接 link 到任何一个具体节点。需要在抽取时根据上下文消歧（详见 [entity-resolution.md](../05-modules/entity-resolution.md)）。

## 显式排除

下列实体在 MVP 阶段**不**进 entity_master：

- 任何只在新闻里出现一次、没有官方网站的"小公司"
- 任何没有独立法人编号、只是产品代号的"实体"（如 "H100"、"MI300"——它们是 product，不是 entity）
- 任何不能确定地理国家归属的实体

如果在抽取过程中遇到上述情况，进 `pending_entities` 队列，等手动审核。
