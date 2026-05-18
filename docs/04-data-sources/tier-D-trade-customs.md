# Tier D — 贸易与海关数据

价值高但极易误读。本层数据**全部**自动标 `is_inferred = true`，evidence_level 上限通常为 3。

## D.1 UN Comtrade (`un-comtrade`)

### 用途

- 全球国家间月度 / 年度贸易流
- 按 HS code 分类
- 按贸易模式（进口 / 出口）分类

### 接入

- Comtrade+ API：免费 key 后每日 500 calls，单次 ≤ 100K records
- JSON / CSV
- 严格遵守限速

### 数据特点

- **国家级**，不是公司级
- 同一 HS code 下可能有多种产品
- 数据有滞后（通常 1-3 个月）
- 部分国家数据缺失 / 修订

### 抽取

不进图谱直接生成边。生成 **macro signals**：

```ts
interface TradeFlowSignal {
  reporter_country: string; // ISO2
  partner_country: string; // ISO2
  hs_code: string;
  trade_flow: "import" | "export";
  period: string; // YYYY-MM 或 YYYY
  value_usd?: number;
  qty?: number;
  qty_unit?: string;
  source: Provenance;
}
```

存在 `signals` 表，与图谱独立。在 ComponentCard 中作为 `related_macro_signals` 引用。

### 反模式

- "用 Comtrade 推断 公司 A → 公司 B 的供应"——禁止。Comtrade 没有公司维度
- "从 HS code 直接推断产品" —— HS code 是粗分类，不能作为产品标识

## D.2 U.S. Census International Trade (`census-trade`)

### 用途

- 美国月度进出口
- 按贸易伙伴 / HS code / 运输方式
- USA-Trade Online 数据集

### 接入

- 公开 API；当前实现要求配置免费 `CENSUS_API_KEY`，避免无 key 限制和运行时行为漂移。
- JSON
- `@supplystrata/sources-census-trade` 已接入第一版 `imports/hs` 与 `exports/hs` 月度数据；`source_check_targets.target_kind = trade-flow-observation` 会写入 `TRADE_FLOW_OBSERVATION`。
- API key 只在抓取请求中附加，不写入 `source_url` / document provenance。

### 与 Comtrade 区别

- 仅美国视角，但更细
- 提供运输方式（vessel / air / rail / truck）
- 提供 港口级数据（部分）

### 用法

- Macro signal 同上
- 港口级数据 + AIS（Tier E）可作为 logistics 背景
- 禁止直接从 Census Trade 生成公司级 `BUYS_FROM` / `SUPPLIES_TO` 边；它只能支持组件、国家、港口或路线层面的观测。

### Component-HS taxonomy 正式接入

`@supplystrata/component-context` 维护 `patterns/trade-taxonomy.json`，把组件映射到可复用的贸易代理码和材料暴露：

```text
COMP-MEMORY -> HS 854232 -> TRADE_FLOW_OBSERVATION
COMP-SILICON-WAFER -> HS 381800 / 280461 -> TRADE_FLOW_OBSERVATION
COMP-POWER-SUPPLY -> HS 850440 -> TRADE_FLOW_OBSERVATION
```

这些映射全部带 `proxy_only=true`。含义是：

- 可以回答“这个组件附近有哪些公开贸易流信号？”
- 可以生成 `source_check_targets` 的 `census-trade / trade-flow-observation` 配置建议。
- 可以写入 ComponentCard / ChainView 的 observation lane。
- 不能生成公司级事实边，不能推出“某公司从某国家采购某组件”。

CLI 示例：

```bash
pnpm cli sources plan \
  --component COMP-MEMORY \
  --depth 3 \
  --trade-month 2025-12 \
  --trade-country 5800 \
  --trade-directions imports,exports
```

输出里的 `suggested_check_targets` 可以复制进 source policy 配置，或由后续统一 source-management UI 生成。

## D.3 USITC DataWeb (`usitc-dataweb`)

### 用途

- 美国官方贸易统计 + 关税
- HTS（10 位）级别
- 进口商 / 国家 / 产品组合查询

### 接入

- 网页查询 + CSV 导出
- 部分功能有 API
- 注册账号（免费）

### 用法

- 与 census-trade 互相佐证
- 查询关税变化（关税战时期对供应链的影响）
- 不直接生成图谱边

## D.4 ImportYeti（**手工录入，不做 adapter**）

### 状况

- 提供搜索式 BOL（美国海运提单）
- 包含买家 / 供应商 / 港口 / 重量 / HS code 等字段
- ToS 明确禁止抓取 / 自动化

### MVP 处理方式

```
不做 ImportYeti 自动 adapter。
研究员可以手工搜索 + 复制证据 → 通过 supplystrata manual evidence 命令录入。
录入时必须填：
  - 完整 cite_text
  - 原始 BOL 主键（如 ImportYeti URL，或 BOL number）
  - 至少 6 条独立 BOL 才能 generate edge
  - source_type = "BOL"
  - is_inferred = true
  - 警告字段：is_freight_forwarder_risk = true|false
```

详细法律风险见 [09-risks-compliance/legal-tos.md](../09-risks-compliance/legal-tos.md)。

## D.5 美国 CBP Vessel Manifest 公开数据（背景）

- CBP 法律允许 importer / consignee / shipper 申请保密
- 即使能拿到原始数据，也存在系统性盲区
- MVP 不直接接入；通过 ImportYeti / Panjiva 等聚合平台手工查询时已经隐含使用了

## 通用注意事项

### Freight forwarder 与 trader 噪声

很多 BOL 上的 "buyer" 实际是货代或贸易公司，不是真正的最终消费方。这导致：

- 看似 "Apple 进口某产品"，可能其实是 Apple 的物流伙伴在进口
- "Importer X 长期向 Supplier Y 进口" 可能其实是同一货代在多个客户间分摊

抽取规则必须：

- 维护一份"已知货代/贸易公司"名单（手工 + OpenCorporates 数据）
- 命中时降低 confidence、显式标 `freight_forwarder_risk = true`

### HS code 多义性

- 同一 HS code 可能涵盖多个完全不同的产品
- 不能根据 HS code 简单推断"这是 GPU"
- 必须配合 product description（BOL 自由文本）做联合判断

### 时滞

- BOL 数据通常滞后 30-90 天
- Comtrade 滞后 1-3 个月
- 系统中存的 evidence `source_date` 必须是数据所对应的期，不是抓取时间

### 数据完整性

- CBP 保密条款导致数据缺口
- 部分国家不报告或滞后报告 Comtrade
- 系统输出必须明示这些缺口

## 进入 Phase 3 的接入顺序

```
1. un-comtrade
2. census-trade
3. usitc-dataweb（CSV）
4. import-yeti（手工流程）
```

每接一个，先做 macro-signal 表，再视情况开放 BOL 推断边（Phase 3）。
