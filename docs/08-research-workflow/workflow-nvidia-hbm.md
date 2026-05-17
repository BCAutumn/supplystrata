# Research Workflow Example — NVIDIA → HBM 链

把 [vision.md](../00-overview/vision.md) 中的方法论实例化。这条链就是 MVP 的"金标准研究范例"。

## 0. 研究目标

> 把 NVIDIA 的内存供应链（HBM / DRAM / NAND）整理为带证据 / 等级 / 来源 / 时间戳 / 不确定性的图谱片段。

## 1. Step 1 — 直接披露建立 Level 5 边

### 来源

NVIDIA Form 10-K（最新一份），SEC EDGAR。

### 关键段落

- Item 1. Business — Manufacturing
- Item 1A. Risk Factors — Supply concentration

### 抽取规则命中

- `rule.sec.official-supply-chain` → `USES_FOUNDRY` (NVIDIA → TSMC) [Level 5]
- `rule.sec.official-supply-chain` → `USES_FOUNDRY` (NVIDIA → Samsung) [Level 5]
- `rule.sec.official-supply-chain` → `BUYS_FROM(memory)` (NVIDIA → SK Hynix) [Level 5]
- `rule.sec.official-supply-chain` → `BUYS_FROM(memory)` (NVIDIA → Micron) [Level 5]
- `rule.sec.official-supply-chain` → `BUYS_FROM(memory)` (NVIDIA → Samsung Memory) [Level 5]
- `rule.sec.official-supply-chain` → `BUYS_FROM(manufacturing services)` (NVIDIA 与 Foxconn / Wistron / Fabrinet 等)

实体消歧重点：

- `Samsung` 在 foundry 上下文 → `ENT-SAMSUNG-FOUNDRY`
- `Samsung` 在 memory 上下文 → `ENT-SAMSUNG-MEMORY`
- `Foxconn` → `ENT-FOXCONN`，但部分披露具体到子公司（如 Foxconn Industrial Internet）则消歧到 `ENT-FOXCONN-FII`

### 输出

新增/更新若干条 `BUYS_FROM` / `USES_FOUNDRY` / `MANUFACTURES_AT` 边，evidence 全部 Level 5。

## 2. Step 2 — 反向验证（供应商端）

### 来源

- SK Hynix Earnings Release & Conference Call（IR）
- Micron 10-K + earnings call transcript
- Samsung IR + DART 披露
- TSMC 月度营收 + 法说会

### 想找到的内容

- HBM 需求 / capacity reallocation 的口径
- Capex 与产能扩张
- 客户集中度
- 是否点名 NVIDIA / 主要客户

### 评级

- 如果 SK Hynix 公开财报中**明确**点名向 NVIDIA 供应 HBM → Level 5（双方独立交叉披露）
- 一般情况只能拿到"主要 AI 客户"等含糊措辞 → Level 4（Earnings call official）
- 但能为 SK Hynix 加 ComponentCard "HBM 需求驱动" 段落

## 3. Step 3 — 公开行业价格证据（不下沉到公司层）

### 来源

- TrendForce / DigiTimes 公开新闻稿（**手工**录入选段）
- 注意：Trendforce 完整付费数据库不在我们手里

### 用法

- 进入 ComponentCard(HBM) 的 `public_price_signals` 与 `demand_drivers`
- evidence_level 上限 2
- `is_full_database = false`
- 写明引用来源 + 日期

### 不允许

- "TrendForce 说 Q2 涨 60% → 所以 SK Hynix Q2 业绩一定好" 这种因果推断
- 把价格信号挂到 NVIDIA → SK Hynix 边上作为 confidence 调整

## 4. Step 4 — 宏观贸易流（如需）

MVP 通过之后才接入：

- UN Comtrade：韩国 / 台湾 / 日本 → 美国 半导体相关 HS code 月度趋势
- U.S. Census：美国进口端的对照
- USITC：关税层面

### 用法

- 仅作 macro_signals
- 不挂到具体公司间边
- 在 ComponentCard 引用

## 5. Step 5 — 物流 / 港口（背景）

Phase 3 之后：

- NOAA AccessAIS：洛杉矶 / 长滩 / 日本港口 vessel count 与 dwell
- 不能下到"这艘船上有 H100"

物流信号必须作为 `port_observations` / `route_observations`，除非同时满足多条独立 BOL、非货代识别、产品描述一致、时间连续性和人工 review，否则不能升级成 inferred edge。详细升级门槛见 [multi-tier-chain-logistics-plan.md](../06-development/multi-tier-chain-logistics-plan.md)。

## 5b. Step 5b — 原材料 / 冶炼 / 精炼（ComponentCard 背景）

Phase 3 之后，HBM / AI server 相关的原材料链路要先进入 ComponentCard，而不是直接连到 NVIDIA：

- USGS MCS：锂、镍、钴、铜、稀土等矿产产量、储量、主要生产国。
- IEA Critical Minerals Data Explorer：关键矿物需求和供应情景。
- RMI facility lists：冶炼/精炼/处理设施候选。
- EU Critical Raw Materials Act：政策、集中度、供应风险背景。

允许：

```text
ComponentCard(HBM) -> related raw material observations
ComponentCard(server power/cooling) -> copper / aluminium / energy observations
UnknownMap -> exact mine/refiner allocation unknown
```

不允许：

```text
NVIDIA -> mine/refiner
NVIDIA -> country mineral source
supplier -> mine
```

除非有公司官方披露、监管文件或同等级证据直接支持。

## 6. Step 6 — 形成研究图谱片段

### 输出（CompanyCard("NVIDIA", depth=2)）

```
Microsoft / Amazon / Alphabet / Meta / Oracle      [demand side]
        ↓ AI capex
NVIDIA / AMD / Broadcom                             [chip designers]
        ↓ wafers / packaging exposure
TSMC / Samsung Foundry                              [foundries]
        ↓ HBM / DRAM / NAND
SK Hynix / Micron / Samsung Memory                  [memory]
        ↓ AI server assembly
Quanta / Wistron / Foxconn / Supermicro / Dell      [server ODM/OEM]
        ↓
Data centers / cloud customers
```

每条边都带：

- evidence ID
- evidence level
- confidence
- source date
- 是否推断
- 最近验证时间

### 输出（ComponentCard("HBM")）

```
known_suppliers: SK Hynix, Samsung Memory, Micron     [Level 5 from Nvidia 10-K]
known_consumers: NVIDIA (confirmed), AMD, ...         [Level 4-5]
demand_drivers:
  - AI accelerator demand (multiple 10-K cite)
  - CSP capex announcements (cite earnings)
  - Enterprise SSD reallocation (cite TrendForce public)
public_price_signals:
  - "DRAM 合约价 Q2 预计涨 58–63%" (TrendForce, 2026-03)  [is_full_database = false]
  - ...
unknown_map:
  - NVIDIA's HBM allocation per CSP per quarter
  - Specific contract pricing
  - Supplier production capacity reservation
```

### 输出（UnknownMap("NVIDIA")）

```
NO_PUBLIC_DISCLOSURE:
  - Internal HBM allocation among customers
  - Inventory level of specific products
  - Negotiated contract prices
OBTAINABLE_BUT_PAID:
  - TrendForce full database
  - SemiAnalysis premium content
  - Bloomberg supply chain insights
OBTAINABLE_WITH_EFFORT:
  - More detailed earnings call transcripts (need to subscribe service)
  - Korean-language DART 文件 (待加 dart-kr adapter)
OBTAINABLE_INFERENCE:
  - 通过 SK Hynix capex + capacity disclosure 推断 HBM 总产能
  - 通过 TSMC 月度营收推断 advanced packaging exposure
  - 通过 BOL 数据 (Phase 3) 验证航运 fingerprint
```

## 7. Step 7 — 持续跟踪

每月：

- 重新跑 SEC adapter，看是否有新 10-K / 10-Q / 8-K
- 重跑抽取，检查是否有 superseding evidence
- review changes 流（哪些边升级 / 哪些边失效）
- 更新 unknown_map：哪些项已经 resolved

## 8. 反例：禁止做的事

- **不**把"市场流传"或"圈内人说"写入 evidence
- **不**对 Level 1 信号自动建边
- **不**因 NVIDIA 股价上涨就认为供应商关系更强
- **不**因 NVIDIA 财报大超预期就把上游边的 confidence 提升
- **不**写"建议买入 SK Hynix"等任何投资建议

这条研究链就是这样跑下来的。Phase 2 验收的核心 deliverable 之一，就是把这一份报告自动生成（除了人工 review 的 Apple Supplier List 和手工录入的行业新闻片段）。
