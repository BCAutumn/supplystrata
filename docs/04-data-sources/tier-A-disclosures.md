# Tier A — 公司官方披露

最高优先级，也是 MVP 的命脉。本层定义 P0 数据源的接入细节。

## A.1 SEC EDGAR (`sec-edgar`)

### 用途

- 美国上市公司 / ADR 的 10-K / 10-Q / 20-F / 8-K
- XBRL company facts（仅 JSON 接口；完整 XBRL 留 Phase 3）
- 全文索引

### 接入方式

- **submissions API**：`https://data.sec.gov/submissions/CIK<10-digit>.json`
- **company facts API**：`https://data.sec.gov/api/xbrl/companyfacts/CIK<10-digit>.json`
- **filing 文档列表**：基于 submissions JSON 构造 URL
- **filing 全文 HTML**：`https://www.sec.gov/Archives/edgar/data/<CIK_int>/<accession_no_dashes>/<filename>`

已落地的 source-check target：

- `sec-edgar/sec-company-filings`：抓取 10-K / 10-Q / 20-F / 8-K HTML，进入 document pipeline。
- `sec-edgar/sec-company-facts`：抓取 companyfacts JSON，解析结构化财报指标并写入 `FINANCIAL_METRIC_OBSERVATION`；示例 policy 已覆盖 NVIDIA / AMD / Micron / Intel / Microsoft 五家公司。不解析 PDF，不生成事实边，不用总收入 tag 伪造 segment revenue。

### 强制要求

- HTTP `User-Agent` 必须带可联系的邮箱（SEC 要求）
- 限速：≤ 10 req/s（保守用 5 req/s）
- 不得绕过 robots.txt
- 不得订阅 RSS 时高频轮询（建议 ≥ 5 分钟一次）

### 解析重点

| 文件类型 | 重点段落                                                                        |
| -------- | ------------------------------------------------------------------------------- |
| 10-K     | Item 1 Business、Item 1A Risk Factors、Item 7 MD&A、Item 8 Financial Statements |
| 10-Q     | MD&A、Notes（特别是 segment / customer concentration）                          |
| 20-F     | Item 4 Information on the Company、Item 5 Operating and Financial Review        |
| 8-K      | Item 1.01 (Material Definitive Agreement)、Item 8.01 (Other Events)             |

### 抽取规则示例

```
rule: "10k.foundry-disclosure"
pattern: /\butili[zs](?:e|es?|ed|ing)\s+(?:foundr(?:y|ies))\s+such\s+as\s+([A-Z][\w\.\- &]+(?:,\s+[A-Z][\w\.\- &]+)*\s*(?:and\s+[A-Z][\w\.\- &]+)?)/i
emits: USES_FOUNDRY edges
evidence_level_hint: 5
```

```
rule: "10k.memory-purchase"
pattern: /\bpurchase[s]?\s+memory\s+(?:from|including)\s+([A-Z][\w\.\- &]+(?:,\s+[A-Z][\w\.\- &]+)*\s*(?:and\s+[A-Z][\w\.\- &]+)?)/i
emits: BUYS_FROM(memory)
evidence_level_hint: 5
```

LLM 兜底跑在没被 rule 命中的"风险因素"段落里，提取候选关系。

### 已知盲区

- **客户匿名化**：`Customer A`、`one customer accounted for X% of revenue` —— 这种披露无法解析为具体实体；做法：进 unknown_map 并记录百分比
- **未来语气**：`we plan to` / `we are evaluating` —— 必须降级到 evidence_level 2
- **风险列表式列举**：`competitors include TSMC, Samsung` —— 不是供应关系；rule 必须区分语境

### 限制

- SEC 不覆盖韩国（Samsung、SK Hynix）的全部披露 → 用 DART 补
- 8-K 触发的事件性披露需要单独 adapter 子流程

## A.2 公司 IR 官网（统称 `company-ir`）

### 设计

`company-ir` 是一个**逻辑** source family。当前已实现的官方 IR HTML adapter 收敛在 `source-workflows` 的 official IR 能力内，避免为每个只含 URL/normalize/context 的薄壳单独建包：

```
packages/source-workflows/src/
├── official-ir-adapters.ts
├── official-ir-checks.ts
└── previews.ts
```

每家 IR 网站结构不同；不写"通用 IR 抓取器"。每家仍保留独立 adapter id、URL 规则和限速，但生命周期相同的薄实现放在同一 feature 内维护。

### 共同模式

- 落地页通常有 "Annual Reports / Quarterly / Presentations" 几个区块
- 文件多为 PDF
- 部分公司提供 RSS / press release email

### 共同要求

- 严格遵守 robots.txt（每家不一样）
- User-Agent 带项目联系方式
- 单家网站请求 ≤ 1 req/3s
- 不爬 /search 等动态接口
- 优先抓"年报 / Q 报 / Investor Day"，不抓 marketing materials

### 解析

- 标题 + 发布日期模式匹配
- PDF 解析交给 `parsers/pdf`
- 无可靠日期的文件不进 documents（避免污染时间序列）

### TSMC IR 特殊点

- 月度营收公告（中英文版）：节奏稳定，重要的需求侧 proxy
- 法说会逐字稿与 presentation：评级 4（口头披露）

### Samsung / SK Hynix 特殊点

- 部分 IR 文件韩文优先，英文延迟发布
- DART 上的英文披露通常更结构化 → 优先 DART
- 一定要注意区分 entity（Samsung Foundry vs Memory）

## A.3 韩国 DART (`dart-kr`)

### 用途

- Samsung / SK Hynix 等韩国公司披露
- 月度 / 季度 / 年度报告
- 股东大会披露

### 接入

- DART OPEN API：需注册 key
- 提供 JSON 索引 + 文档下载
- 部分文档是 PDF / HWP（韩国电子文档格式）→ MVP 仅处理 PDF / HTML 子集

### 已知盲区

- HWP 文件需要外部转换，MVP 跳过
- 英文版有时滞后 → 标 source_date 为韩文版日期

## A.4 Apple Supply Chain Reports (`apple-suppliers`)

### 用途

- 官方 Supplier List（按年发布 PDF）
- Supply Chain Innovation Reports
- Conflict Minerals Reports

### 接入

- 静态 PDF 下载
- 无 API
- 文件路径稳定但每年命名规则可能变

### 解析重点

- Supplier List 是表格：`Supplier Name | Primary Locations Where Manufacturing for Apple Occurs`
- 每行解析为：
  - 一个 entity（supplier）
  - 一组 facility（按 location 列）
  - 关系 `Apple BUYS_FROM Supplier`（component 字段空）
  - 关系 `Supplier MANUFACTURES_AT Facility`（如果 location 行能定位到具体国家/地区）

### 已知盲区

- 表格解析容易错，必须人工 review
- "Primary location" 不等于唯一 location
- "Supplier" 不一定是直接供应商；可能是 Apple 母公司层面的供应商，下层细节不公开
- 名称版本可能与 SEC / OpenCorporates 不一致 → 必须做实体消歧

### 实施

MVP 阶段采用 **半自动**：

1. 脚本下载 PDF + 提取表格 → 写入 `data/raw/apple-suppliers/<year>/...`
2. 输出一份候选 CSV
3. 研究员人工 review CSV
4. 经审核的 CSV 喂入 pipeline，生成 evidence + edges
5. evidence 标 `extraction_method = "hybrid"`

不做无人值守的全自动抽取。

实现上，Apple 不是特殊主路径。固定宽度供应商名单表格解析由通用 `@supplystrata/supplier-list` 处理，Apple adapter 只提供 buyer、URL、ToS、忽略行规则和 review 文案。未来其它官方 supplier list 应复用相同 candidate schema。

## A.5 ESG / Sustainability Reports (放在 company-ir 子项)

各家公司 ESG 报告里常有：

- Tier 1 / Tier 2 供应商概况（数量、地理分布、能源）
- 关键矿产 / 冶炼厂列表（按 RBA 标准）
- 能源使用与碳排放

MVP 阶段对 ESG 报告：

- 只抽取**实体提及**（用于 entity-resolution 增量补全别名）
- **不**自动建供应链边（ESG 报告里的"supplier"含义模糊，可能是直接 / 间接 / 一级 / 二级）
- 完整接入留 Phase 3

## 综合已知盲区与对策

| 盲区                            | 对策                                                            |
| ------------------------------- | --------------------------------------------------------------- |
| 监管文件中的 Customer A 匿名化  | 自动入 unknown_map；记录金额/百分比作为约束                     |
| 未来时态披露                    | 降级到 Level 2；不进图谱                                        |
| 韩文 / 日文 IR 文件             | MVP 优先英文版；缺英文版则跳过                                  |
| 文件版本更新（同 URL 内容变化） | 通过 sha256 检测内容变化；新版本作为 superseding evidence       |
| 表格解析错误                    | apple-suppliers 强制人工 review；其他来源采样核查（每月 50 条） |
| 公司改名 / 重组                 | 在 entity_master 加别名 + OWNS_BUSINESS_UNIT；文件之间链接不变  |
