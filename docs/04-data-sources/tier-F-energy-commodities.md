# Tier F — 能源 / 商品 / 原材料

新能源、数据中心、半导体制造的底层约束。本层数据**全部**作为 macro / commodity signals，不进图谱边（除非 explicit ADR）。

## F.1 U.S. EIA (`eia`)

### 用途

- 美国能源 / 电力 / 天然气 / 石油 / 煤
- 月度 / 年度 / 地理细分
- 对数据中心 / 工厂能耗背景非常重要

### 接入

- 公开 API：`https://api.eia.gov/v2/...`
- 需要 API key（免费）
- JSON

### 用法

- 数据中心地区电网容量与价格背景
- LNG / NG 价格作为冶炼 / fab 成本 proxy
- 不直接进图谱

## F.2 FRED (`fred`)

### 用途

- St. Louis Fed 维护的宏观经济时间序列
- 利率 / GDP / CPI / 商品 / 房价 / 雇佣等
- 部分港口与运价数据（Cass Freight Index 等聚合）

### 接入

- 公开 API（需 key）
- JSON / CSV

### 用法

- 宏观背景
- 行业景气背景
- 不进图谱

## F.3 World Bank Pink Sheet (`worldbank-pink`)

### 用途

- 月度商品价格（能源、金属、农产品）
- 全球公开，准官方
- 含黄金、铝、铜、镍、原油、天然气、棕榈油等

### 接入

- XLSX 月度文件
- 公开下载

### 用法

- 锂、镍、钴、铜价格背景（电池 / 新能源链）
- 铜价格背景（数据中心电力建设）
- 不进图谱

## F.4 USGS Mineral Commodity Summaries (`usgs-mcs`)

### 用途

- 90+ 种矿产年报
- 全球产量 / 储量 / 主要生产国
- 战略性矿产清单

### 接入

- 静态 PDF + CSV
- 年度发布

### 用法

- 锂 / 钴 / 镍 / 稀土等矿产基本面
- 主要矿产生产国 → 节点级 macro signal
- 不直接生成图谱边

## F.5 公司月度营收（亚洲常见）

- TSMC、UMC、联发科等台湾公司有月度营收公告
- 部分韩国公司也有
- 是需求侧的高频 proxy

### 接入

- 各公司 IR adapter（属于 Tier A）
- 解析后存入 `signals` 表，关联到 entity

### 用法

- ComponentCard 中 `demand_drivers` 引用
- 与 Comtrade 趋势对照
- 不直接生成图谱边

## F.6 行业新闻稿（如 TrendForce、DigiTimes 公开版本）

### 用途

- 公开价格趋势报道（如 DRAM 合约价 / NAND 合约价 / HBM 供给紧张）
- 行业事件叙事

### 接入

- **不**做自动抓取（多数有 ToS 限制）
- MVP 通过 `manual evidence add` 录入选定文章片段
- 必填 source URL + 作者 / 媒体 + 发布日期

### 用法

- 进 `public_price_signals` 与 `demand_drivers`
- evidence_level 上限 2
- `is_full_database = false` 字段必填，明示我们不是订阅数据库

### 反模式

- "TrendForce 说 Q2 涨 60%，所以 SK Hynix 业绩一定好" —— 不要做这种因果推断
- 价格信号不能下沉到公司层

## 价格数据的现实约束

> **真正的高价值价格数据（DRAM 合约价、HBM 分配价、CoWoS 月度成交、GPU 租赁价、服务器交期）几乎全部在付费数据库里。**

MVP 阶段对此的态度：

- 不假装拥有完整价格库
- 仅引用公开新闻稿中的片段
- 在 ComponentCard 上明确 `is_full_database = false`
- unknown_map 写明"具体合约价格未知"

## 信号表（与图谱独立）

```sql
CREATE TABLE macro_signals (
  signal_id      TEXT PRIMARY KEY,
  category       TEXT NOT NULL,       -- "energy" | "commodity" | "trade_flow" | "industry_price" | "macro" | "company_revenue"
  scope_kind     TEXT,                -- "country" | "region" | "company" | "component"
  scope_id       TEXT,
  metric         TEXT NOT NULL,       -- "price_usd_per_ton", "monthly_revenue_twd", ...
  value          DOUBLE PRECISION,
  text_value     TEXT,                -- 当 value 不适用时
  unit           TEXT,
  period         TEXT NOT NULL,       -- "2026-04" | "2026-Q2" | "2026"
  source         JSONB NOT NULL,      -- Provenance
  is_full_database BOOLEAN NOT NULL DEFAULT FALSE,
  evidence_level SMALLINT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_macro_signals_scope ON macro_signals(scope_kind, scope_id);
CREATE INDEX idx_macro_signals_metric ON macro_signals(metric);
```

任何 Tier F 数据都进入这张表；图谱不直接消费。
