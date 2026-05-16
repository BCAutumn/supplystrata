# Module: Parsing — 文档解析

`packages/parsers/*`。把原始字节标准化为 `NormalizedDocument` + chunks + tables。

## 子模块

```
packages/parsers/
├── html/         cheerio + 自写 readability-lite
├── pdf/          pdfjs-dist 或 unpdf
├── xbrl/         调用 Python sidecar (Phase 3) / 仅读 SEC company-facts JSON (Phase 0-2)
├── csv/          papaparse
├── excel/        xlsx
└── text/         normalize / chunk / locator 工具
```

## 通用要求

### 输入 / 输出

```
input  : RawDocument (含 storage_key)
output : { text, chunks[], tables[]?, language?, metadata }
```

不读 Postgres，不写 Postgres。

### 文本规范化

`packages/parsers/text/normalize.ts`：

- NFKC
- 全角 → 半角
- 行终止统一为 `\n`
- 去 BOM
- 多空格压缩为单空格
- 不去标点（关系抽取需要）

### Chunking

Chunking 策略（按文档类型分发）：

| document_type     | 策略                                                |
| ----------------- | ------------------------------------------------- |
| 10-K / 10-Q / 20-F | 按 Item / Section 标题切；超长 section 再按段落切，目标 1500-2500 token |
| earnings call     | 按 speaker turn 切                                  |
| supplier list (PDF) | 按表格行切（每行一个 chunk）                                |
| press release     | 整篇 + 按段落                                          |
| ESG report        | 按章节                                               |

每个 chunk 必须有：

- 稳定 `chunk_index`（重跑 parser 不会改变）
- `locator` 字段（人类可读："Item 1A. Risk Factors > Manufacturing"）
- token_count（按 cl100k_base 或类似估算）

### Locator 设计

locator 是给研究员"在原文里定位"的工具。要求：

- 对 HTML：`section path > sub-heading`
- 对 PDF：`page <n>` 或 `page <n> > paragraph <k>`
- 对表格：`table <id> > row <k>`
- 不允许 locator 为空

### 表格抽取（PDF）

简单 PDF：pdfjs-dist + 自写 row 检测
复杂 PDF：MVP 走半自动 CSV + 人工 review；Phase 3 后再评估 Python sidecar（pdfminer.six / camelot）

Apple Supplier List 用复杂路径。

## HTML Parser

### 主要工作

1. cheerio 加载
2. 删除 nav / footer / script / style / aside
3. 找主内容区（依 site-specific selector + readability fallback）
4. 拆分 sections：以 H1/H2/H3 为锚点
5. chunk 切分

### Site-specific selectors

每家 site 单独配置，避免 readability 算法误判。例如：

```ts
const SITE_RULES: Record<string, SiteRule> = {
  "www.sec.gov": { content_selector: "body", noise_selectors: [] },
  "investor.tsmc.com": { content_selector: "main, .content", noise_selectors: [".sidebar", ".cookie-banner"] },
  "www.skhynix.com": { content_selector: "#content", noise_selectors: [".gnb", ".footer"] },
  // ...
};
```

新 site 没规则时使用 readability fallback + 警告日志。

## PDF Parser

### 简单文本抽取

- pdfjs-dist：直接抽 text + 页码
- 大多数 IR 报告够用

### 复杂场景（MVP 半自动；Phase 3 可走 Python sidecar）

- 双栏 / 多栏 layout
- 表格密集（Apple Supplier List）：MVP 不追求全自动，采用脚本下载 PDF + 人工校验 CSV
- 嵌入扫描图（OCR）—— MVP 不做 OCR，跳过

### 已知问题

- PDF 字符顺序不一定按视觉顺序
- 上下标 / 页码 / 页眉页脚混入正文
- 不可见文本（白色字体）—— 解析时仍会出现

对策：

- 字符级位置感知（pdfjs 的 `transform` 矩阵）
- 启发式过滤页眉页脚（重复出现的短行）
- 必须保留页码作为 locator

## XBRL Parser

### Phase 0-2 阶段（MVP）

只用 SEC `company-facts` JSON：

```ts
fetch("https://data.sec.gov/api/xbrl/companyfacts/CIK<10digit>.json")
```

输出：财务指标时间序列。这层数据**不**直接生成关系边，但可以作为 entity 的 attrs 与时间序列信号。

### Phase 3 阶段

引入 Python sidecar (arelle)：

- 完整解析 instance + taxonomy
- 抽取 segment / customer concentration 等高价值披露
- 输出 → TS 端 → 进入抽取流程

## CSV / Excel

- papaparse 解析 CSV，强制 UTF-8 BOM 检测
- xlsx 库解析 Excel
- 输出为 `tables` 字段（含表头 + 行）

## 错误处理

- 任何 parser 抛错 → `documents.parse_status = "parse_failed"` + 写 `parse_errors`
- 不阻塞 pipeline（其它文档继续）
- Failed parse 可单独命令重跑：`supplystrata reparse --doc DOC-xxx`

## 性能

- 单文档解析目标 < 60s（不含 sidecar）
- 超时直接 abort，不让 pipeline 卡住
- 大文件（> 50MB）走 streaming，不一次加载

## 测试

- 每个 parser 至少 5 条 fixture（包含正常 / 异常 / 复杂排版）
- 输出 chunks 的快照测试（snapshot test）
- 一旦改 parser 导致 chunks 变化 → 必须显式更新 snapshot
