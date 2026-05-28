# Overview — SupplyStrata 是什么

SupplyStrata 是一个 **local-first、证据优先、面向全球任意上市公司的供应链证据与变化监控基础设施**。

它的产品形态是 **"AI agent 的供应链数据源"**：

- 不是 SaaS 产品。
- 不是中心化运营的知识库网站。
- 不是内置 agent 的研究助手。
- 不是开源版 Bloomberg / Sourcemap。

智能层（网络搜索、综合分析、报告写作、跨域推理）由调用方的 AI agent 负责——Cursor、Claude Desktop、ChatGPT Desktop、Cline、Windsurf、自建 LangGraph / LlamaIndex 流程都可以。SupplyStrata 不和它们竞争，**给它们供货**。

```text
SupplyStrata = 开放 schema (SCBOM)
             + 全球官方源 adapter
             + 本地 workflow 引擎
             + MCP 接入面
```

## 一句话定位

```text
Local-first, evidence-first, MCP-native supply-chain intelligence backbone for AI agents.
```

## 设计哲学：四层叠加

```
┌─────────────────────────────────────────────────────────────────────┐
│  外部 AI agent (Cursor / Claude Desktop / 自建 LangGraph / ...)      │
│  ⇣ 通过 MCP                                                          │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 4: 参考客户端 — 独立包，可换、可不装                          │
│    @supplystrata/agent  — 参考 agent，用户自带 LLM provider          │
│    @supplystrata/web    — 参考前端，通过 MCP HTTP 调本机或远程       │
│    @supplystrata/cli    — 命令行入口                                 │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 3: MCP 接入面 — 唯一对外 surface                              │
│    @supplystrata/mcp    — tools / resources / prompts                │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 2: workflow + 受控 LLM helper                                 │
│    research-session、source-workflows、pipeline、graph-builder       │
│    @supplystrata/llm-helpers — 单步、必返候选、永不写事实            │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 1: 开放 schema + 数据底座                                     │
│    scbom-spec        — 独立 repo，供应链 SBOM 开放标准               │
│    component-context、source-registry — 共享世界知识                 │
│    本地 cache + 可选 community-pack baseline                         │
│    Truth 永远在官方源：SEC / DART / EDINET / TWSE / HKEX /          │
│       Companies House / GLEIF / OpenFIGI / Wikidata / 公司 IR 等     │
└─────────────────────────────────────────────────────────────────────┘
```

## 谁会用 SupplyStrata

### 1. AI agent 用户（默认形态）

在 Cursor / Claude Desktop / 自建 agent 里挂上 SupplyStrata MCP server：

```text
用户："研究 LVMH 的皮革与葡萄酒上游供应链"
  ↳ agent 调 supplystrata.resolve_company        → LEI: 969500FP1Q07I98R6P10
  ↳ agent 调 supplystrata.start_research_session → run_id
  ↳ agent 轮询 supplystrata.poll_research_run    → ready
  ↳ agent 读 supplystrata://consumer-model/...   → 结构化结果
  ↳ agent 读 supplystrata://evidence/edge/...    → 原文 + cite_text
  ↳ agent 用自己的 LLM 写报告，每段引用回 SupplyStrata 的 evidence_id
```

SupplyStrata 提供事实、证据、链条、强度、未知；
agent 负责理解、网络搜索补充、综合、报告生成。

### 2. 集成方 / 内部平台

在自家产品里嵌入供应链证据查询。拉取 community-pack 作为 warm cache，按需通过 MCP 触发增量 source check。

### 3. 不接 agent 的研究员

走 `@supplystrata/cli` 或参考前端做本地调研。前端本身是 MCP HTTP 的可视化封装，**不在 workflow 之外另写业务规则**。

## 核心承诺

| 承诺                     | 含义                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------- |
| **Local-first**          | 每个用户的本地实例就是完整 SupplyStrata。删本地 DB 也能从官方源重建。                 |
| **Evidence-first**       | 每条事实关系必须能追到 evidence、document、source URL 和 cite text。                  |
| **Truth lives upstream** | 数据库是 cache + audit ledger，不是 truth store。truth 永远在官方源。                 |
| **Open schema**          | SCBOM 是独立标准，SupplyStrata 是参考实现，不是格式所有者。                           |
| **MCP-native**           | 唯一接入面是 MCP；agent、前端、集成方走同一组 tool / resource。                       |
| **LLM opt-in**           | 内置 LLM 调用全部 opt-in、单步、必返候选、不写事实。                                  |
| **No agent in core**     | 核心不内置 agent；参考 agent 是独立包，可换可不装。                                   |
| **No silent crawl**      | 仅访问声明过的官方目录与官方源；不做搜索引擎抓取、不做反爬虫绕过、不做 ToS 灰色路径。 |
| **Global by default**    | 不依赖任何预置的公司 seed CSV；任意上市公司从官方 registry 现查现建。                 |

## 核心数据生成顺序

```text
[1] company query  (LVMH / MC.PA / 969500FP1Q07I98R6P10 / 路易威登)
       ↓
[2] universal identity bootstrap
       本地 cache → GLEIF / OpenFIGI / Wikidata → 各国官方目录
       (US: SEC, KR: DART, JP: EDINET, TW: TWSE, HK: HKEX,
        UK: Companies House, EU: 各国 OAM, ...)
       ↓
[3] dynamic profile derive  (LLM helper, plan-context only, 不写事实)
       读取公司公开简介 → 输出 expected upstream components / source targets
       ↓
[4] source plan & routing  (按国家 / 行业 / dynamic profile)
       ↓
[5] source checks  (官方源 fetch + 归档 + sha256)
       ↓
[6] normalize & parse  (HTML / PDF / JSON / XBRL)
       ↓
[7] extract  (rule extractors + 受控 LLM helper)
       → 候选 edge / observation / unknown
       ↓
[8] evidence-gated promote  (auto / opt-in review)
       L5 rule + 官方源 → 自动写入
       LLM 抽取 / 弱源 / 单一来源 → 留作 candidate，由调用 agent 决定
       ↓
[9] SupplyStrata 输出 — 供 agent 通过 MCP 消费
       resources:  supplystrata://scbom/company/{lei}
                   supplystrata://evidence/edge/{id}
                   supplystrata://changes/entity/{id}
                   supplystrata://unknowns/company/{id}
       tools:      resolve_company, start_research_session, poll_research_run,
                   run_source_check, read_evidence_for_edge,
                   list_unknowns, traverse_chain, ...
```

## 关键边界：四类东西必须分清

| 概念                  | 谁拥有         | 写在哪里                     | 谁能修改                   |
| --------------------- | -------------- | ---------------------------- | -------------------------- |
| 事实 (fact)           | 官方源         | edges + evidence + cite text | 仅 evidence-gated pipeline |
| 解释 (analysis)       | agent / 用户   | agent 自己的输出             | 不写回 SupplyStrata        |
| 计划 (plan / profile) | dynamic derive | 单次 session 内              | session 结束即丢           |
| 标识 (identity)       | 官方 registry  | entity_master 缓存           | 官方目录 bootstrap         |

## 当前不做（清晰边界）

| 不做                              | 原因                                                               |
| --------------------------------- | ------------------------------------------------------------------ |
| 中心化运营 SaaS                   | 任何团队可基于此自建，但不是项目本体                               |
| 内置 AI agent                     | 提供 reference agent 独立包；核心不绑 agent，避免观点焊死          |
| 自动投资建议 / 交易信号           | 事实底座，不是 alpha 系统                                          |
| 让 LLM 直接写 fact edge           | 方法学硬约束；任何 LLM 输出只能走 candidate / review 路径          |
| 商业付费数据库 / ToS 灰色源       | 与开放、合法、可复现承诺冲突                                       |
| 跨用户 truth 同步                 | 每个 local instance 自治；warm start 靠 community-pack 单向分发    |
| 必须有 reviewer 团队才能用        | review 是 opt-in；默认走 evidence 等级自动门槛                     |
| 搜索引擎爬虫 / 反爬绕过           | 只走声明过的官方目录与官方源                                       |
| 预置全球公司 seed CSV             | seed 已退化为 dev fixture；任意公司从 registry 现查现建            |
| 手工维护各行业 hard-coded profile | profile 改为运行时 derive；内置 profile 仅作为 verification anchor |

## 与相邻项目的关系

| 项目                                                          | 关系                                                                                                     |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **OpenSanctions**                                             | 借鉴产品结构（source catalog / entity match / statement / dataset / graph / readiness 六入口），不同领域 |
| **OSV.dev / deps.dev**                                        | 借鉴"开放数据 + 独立 schema + 任何工具消费"的生态模型                                                    |
| **CycloneDX / SPDX (SBOM)**                                   | SCBOM 标准化路径直接参照 SBOM 生态                                                                       |
| **GPT Researcher / Perplexity**                               | 不竞争：它们是 agent，SupplyStrata 是 agent 的数据源                                                     |
| **Cursor / Claude Desktop / Cline**                           | 一等公民 consumer：MCP 接入面优先为它们设计                                                              |
| **Bloomberg / Sourcemap / Sayari**                            | 不竞争：它们是中心化 SaaS，SupplyStrata 是 local-first 基础设施                                          |
| **Wikidata / GLEIF / OpenFIGI**                               | 上游身份来源，SupplyStrata 直接消费它们的 ID，不发明 ENT-XXX 内部 ID                                     |
| **SEC EDGAR / DART / EDINET / TWSE / HKEX / Companies House** | 官方事实源，truth 永远在它们那里；SupplyStrata 是 adapter + cache + audit ledger                         |

## 核心术语

事实层：

| 术语             | 含义                              |
| ---------------- | --------------------------------- |
| `evidence_level` | 1-5 来源强度等级，不是 risk score |
| `confidence`     | 抽取/解析置信度，不是真实世界概率 |
| `fact edge`      | 有可追溯 evidence 支撑的事实关系  |
| `claim`          | 多条 evidence 融合后的可读结论    |
| `unknown`        | 阻止结论成立的显式未知项          |

观测与派生层：

| 术语                | 含义                                                               |
| ------------------- | ------------------------------------------------------------------ |
| `observation`       | 公开世界中可复现的变化（财务、贸易、价格、政策、设施事件）         |
| `lead`              | 值得调查但不能写事实边的线索                                       |
| `relation_strength` | share / dependency / capacity / qualitative 等关系重要性派生上下文 |
| `freshness`         | 事实边最后验证时间的派生新鲜度                                     |
| `risk_metric`       | HHI / single-source / centrality / knockout 等派生指标             |

接入与分发层：

| 术语               | 含义                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------- |
| `MCP server`       | SupplyStrata 唯一对外 surface；tools / resources / prompts                             |
| `SCBOM`            | 开放供应链数据交换 schema，独立 repo 维护，SupplyStrata 是参考实现                     |
| `community-pack`   | 定期发布的预跑数据集（parquet/sqlite），用作 warm cache，不是 truth                    |
| `research session` | 一次性的研究编排；结束后只在 DB 留事实写入与 audit log，profile / plan / prompt 不持久 |
| `llm-helper`       | 单步、受控、必返候选、不写事实的 LLM 调用入口                                          |

## 权威判断入口

- 方法学边界与硬约束：[intelligence-methodology.md](../03-data-model/intelligence-methodology.md)
- 端到端数据流：[data-flow.md](../02-architecture/data-flow.md)
- 模块边界：[module-design.md](../02-architecture/module-design.md)
- 架构决策与推理：[decisions.md](../10-decisions/decisions.md)
- 产品对照与借鉴：[competitive-landscape.md](./competitive-landscape.md)
- MCP 接入面契约：[mcp-surface.md](../04-api/mcp-surface.md)（待建）
- SCBOM schema：scbom-spec/（独立 repo，待建）
- 后端完成门槛：[backend-completion-criteria.md](../06-development/backend-completion-criteria.md)
- 运行入口：[quickstart.md](../06-development/quickstart.md)
