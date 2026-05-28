# Competitive Landscape — 产品对照与借鉴

本文记录 SupplyStrata 当前形态决策时扫过的产品参照系。它不是市场调研报告，而是给后续维护者解释**"为什么我们长成这样、为什么不长成那样"**的对照表。

如果未来要做新的产品形态决策（例如：是否加入实时告警、是否做托管 SaaS、是否引入用户内容贡献），应回到本文先看相邻产品如何处理类似问题，再决定。

## 一张图：SupplyStrata 在产品图谱里的位置

```
                运行形态 →

                  per-user local        federated/per-instance        centralized SaaS
              ┌─────────────────────┬─────────────────────────────┬─────────────────────┐
   on-demand  │ GPT Researcher      │ ★ SupplyStrata (目标位置)   │  Perplexity         │
   每次重新   │ Aider / Cursor      │   OpenSanctions Yente       │  Deep Research      │
   抓取/推理  │ Zotero              │   Sourcegraph self-hosted   │  Elicit / Consensus │
              │                     │   Backstage                 │                     │
              ├─────────────────────┼─────────────────────────────┼─────────────────────┤
   curated    │ Anki / Obsidian     │   Wikibase / OSM tile       │  Bloomberg Terminal │
   有持久化   │ Logseq              │   Grafana + Prometheus      │  S&P CapIQ          │
   知识库     │ datasette (本地)    │   OpenAlex / OpenSanctions  │  CrunchBase         │
              │                     │   deps.dev / OSV.dev        │  Sourcemap / Sayari │
              └─────────────────────┴─────────────────────────────┴─────────────────────┘
                  ↑
                  事实来源 ↓
```

**SupplyStrata 旧形态（重构前）**：右下"中心化 curated 知识库"格——这是 Bloomberg / Sourcemap 的形态，开源项目无法承担。
**SupplyStrata 新形态（重构后）**：中上"federated / per-instance + on-demand"格——和 OpenSanctions Yente、Sourcegraph self-hosted 同象限。
**两者错配**正是 2026-05-28 产品定位重构的起点（见 `decisions.md` #8-#15）。

## 按象限的代表产品与借鉴点

### 象限 1：local + on-demand（per-user research agent）

| 产品                 | 形态                                                                    | SupplyStrata 借鉴                                                            |
| -------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **GPT Researcher**   | 开源、~16k star、零状态 query → cited markdown report                   | 参考 agent (`@supplystrata/agent`) 的形态原型；citation 强约束               |
| **Aider / Cursor**   | 本地 agent 操作本地代码 / 文件                                          | 本地化思路；用户带 LLM key 模式                                              |
| **Zotero**           | 个人 reference 库 + translator (网站解析器) 插件生态                    | source adapter 应是"translator 模式"——社区可贡献而非主仓库扩张              |
| **ResearchRabbit**   | 学术研究 graph 可视化 + LLM 辅助                                        | 可视化做研究入口的产品形态                                                   |
| **Perplexity (本地)** | 联网 + 强 citation                                                      | citation-as-UI 的交互强度（见象限 5）                                        |

**核心借鉴**：**用户进来不需要"先填库"才能用**——任何研究任务都是一次性 session，结束即清。SupplyStrata 的 `research-session` 概念直接来自这一象限。

### 象限 2：federated/per-instance + on-demand（SupplyStrata 目标位置）

| 产品                          | 形态                                                                                                                          | SupplyStrata 借鉴                                                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **OpenSanctions Yente**       | OFAC / 联合国制裁等开源替代品；每天 GitHub Actions 跑 crawler → publish parquet/json dump；Yente 是 self-host API server；FtM 是开放 ontology | **最重要的对照产品**。借鉴：source catalog / entity match / statement / dataset / graph / readiness 六大产品入口；定期数据集发布；self-host API；开放 ontology |
| **Sourcegraph self-hosted**   | 每个企业部署一份，能搜任何代码（GitHub 是 source of truth，他们 index）                                                          | "我们不 own 数据，官方源 own"——index/cache 而非占有                                                                                          |
| **Backstage (Spotify)**       | 每个企业部署一份开发者门户；plugin / catalog-info.yaml 描述自家服务                                                                | 用户自描述研究 scope（research-session config）；plugin 生态                                                                                |
| **Mastodon / Matrix / ActivityPub** | 联邦协议，每个实例自治                                                                                                            | local-first + 可联合，但 SupplyStrata 显式选择**不**做实例间联邦（#8 决策）                                                                  |

**核心借鉴**：**OpenSanctions 是 SupplyStrata 形态最接近的对照**。两者在"开源 / 官方源驱动 / 可 self-host / 可下载数据 / 有 schema / 有 CLI / 有 API / 不靠人审投票而靠抓官方源"几乎一一对应；差别仅在领域（制裁 vs 供应链）和事实变化频率（制裁名单变更慢、供应链关系变更快）。

### 象限 3：centralized SaaS + on-demand（避开的对照系）

| 产品                                  | 形态                                  | 为什么不学                                            |
| ------------------------------------- | ------------------------------------- | ----------------------------------------------------- |
| **Perplexity**                        | 闭源、SaaS、联网搜索 + 强 citation     | 闭源、依赖中心化索引；citation UI 值得借              |
| **OpenAI Deep Research / Gemini Deep Research** | 闭源、SaaS、agent loop + 长报告           | 不能 self-host；我们是它们的潜在数据源                |
| **Elicit / Consensus / Scite.ai**     | 学术研究 SaaS、citation grounded       | 闭源、SaaS；citation 强度是可借鉴的产品交互           |

**借鉴**：仅借鉴**citation as UI** 的产品交互——见象限 5。

### 象限 4：local + curated（个人知识库）

| 产品                | 形态                                              | SupplyStrata 借鉴                                                              |
| ------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Obsidian / Logseq** | 本地 markdown vault、plugin 生态                  | 每个用户的 SupplyStrata 实例 = 一个"研究 vault"；不要求与他人一致               |
| **Anki**            | 本地卡牌 + 可选 sync                              | sync 是 opt-in，不是必选                                                       |
| **datasette**       | 本地 SQLite + 自动 web UI                         | 本地 DB 即时变 API 的形态启发                                                  |

**借鉴**：**个体即组织**——每个用户的本地实例就是他自己的 SupplyStrata，不需要也不假设有协作者。

### 象限 5：federated/per-instance + curated（开放数据基础设施）

| 产品                              | 形态                                                                          | SupplyStrata 借鉴                                                                                                                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OpenSanctions (网站 + 数据)**     | follow-the-money.org 提供 hosted API + 商业版；数据每天发布 dump                | community-pack 模式直接对应（#14）                                                                                                                                                                          |
| **OSV.dev / deps.dev**            | Google 维护的开源软件漏洞 / 包数据库；JSON schema 标准；任何 scanner 消费       | SCBOM 独立 schema 模式直接对应（#10）；自动门槛代替 review（#13）的灵感来源                                                                                                                                |
| **CycloneDX / SPDX (SBOM)**       | 软件物料清单格式标准                                                          | "把 schema 抽出去做独立标准 = 生态杠杆"（#10）                                                                                                                                                              |
| **OpenAlex**                      | 学术开放元数据 (2 亿篇论文)；纯爬官方源；snapshot 可下                          | 无 review queue 也能维护规模的证明                                                                                                                                                                          |
| **OpenStreetMap**                 | 共享世界地图 + 任何人可 self-host tile server / Overpass                       | warm-start baseline + 本地 instance 的成熟范式                                                                                                                                                              |
| **Wikidata + Wikibase**           | 中心化 Wikidata + self-host Wikibase                                          | LEI / Q-ID 作为身份 backbone 的灵感；本地实例 + 可选中心化数据的双模式                                                                                                                                      |
| **GLEIF / OpenFIGI**              | 全球法人识别码 / 金融标识符开放 API                                            | 实体冷启动的官方上游（#11）                                                                                                                                                                                  |

**核心借鉴**：

1. **OpenSanctions = SupplyStrata 的产品结构模板**（六大入口、定期 dump、self-host server）。
2. **OSV / SBOM = SupplyStrata 的开放 schema 模板**（开 schema、reference impl、生态共生）。
3. **Wikidata / GLEIF / OpenFIGI = SupplyStrata 的身份上游**（不发明 ID，消费这些权威 ID）。

### 象限 6：centralized SaaS + curated（避开的对照系）

| 产品                                            | 形态                              | 为什么不学                                            |
| ----------------------------------------------- | --------------------------------- | ----------------------------------------------------- |
| **Bloomberg Terminal / S&P CapIQ / FactSet**    | 闭源 SaaS、几万人录入团队           | 护城河是人力规模；开源无法复刻                        |
| **CrunchBase / PitchBook**                      | 闭源 SaaS、众包 + 编辑              | 内容生态需要中心化运营                                |
| **Sourcemap / Resilinc / Interos / Sayari**     | 闭源 SaaS、供应链情报                | 直接对标 SupplyStrata 领域；他们是 SaaS，我们走 local-first |
| **Panjiva / ImportYeti / ImportGenius**         | 闭源 SaaS、海关贸易数据             | 数据源是 ToS 灰色路径，开源不做                       |

**借鉴**：仅作为"我们不是这种"的对照系。

### 旁支：AI agent 接入面（影响 #7、#9 决策）

| 产品 / 协议                       | 形态                                                            | SupplyStrata 借鉴                                                                |
| --------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **MCP (Model Context Protocol)**  | Anthropic 2024-11 发布；2025-2026 成为 agent 调外部能力的事实标准 | **核心借鉴**：MCP-only 接入面（#7、#9）                                          |
| **Stripe MCP / Linear MCP / Notion MCP / GitHub MCP / Sentry MCP / Sourcegraph Cody MCP** | 官方 MCP server 范例                                              | 验证"MCP 作为外部能力暴露面"的成熟度                                              |
| **LangChain Tools / LlamaIndex Tools** | agent 工具接口                                                    | MCP 出现前的形态，已被 MCP 吸收                                                  |
| **OpenAI Function Calling**       | 闭源 agent tool spec                                              | 与 MCP 兼容（OpenAI 也支持 MCP）                                                  |

### 旁支：可嵌入可视化（影响 #15 决策）

| 产品              | 形态                                       | SupplyStrata 借鉴                                                              |
| ----------------- | ------------------------------------------ | ------------------------------------------------------------------------------ |
| **Mermaid**       | TS 库、markdown 嵌入、SVG 渲染              | 嵌入式生态扩张范式；任何 markdown 工具都能用                                    |
| **Excalidraw**    | TS + React、canvas 渲染、嵌入友好            | canvas-based 可嵌入交互组件                                                     |
| **Cytoscape.js**  | 图论可视化、Canvas、大规模节点              | 图谱主体渲染选 Canvas 的工程证据                                                |
| **d3.js**         | SVG 数据可视化                              | 中小型 graph / timeline 用 SVG 的选型                                            |
| **react-flow**    | React-only 流程图                           | **反例**：React-only 限制嵌入，#15 决策选 web components 不选这条路              |
| **Sigma.js / Vis Network** | 图可视化库                                  | 同 Cytoscape 一类备选                                                            |

### 旁支：开放数据治理 / 可持续模式

| 产品                              | 商业模式                                                            | SupplyStrata 借鉴                                                                |
| --------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Hugging Face**                  | 开源 libs + 付费托管 / 算力                                          | "开源 + 可选托管"作为长期可持续路径之一                                          |
| **Grafana Labs**                  | 开源 Grafana + Grafana Cloud                                         | 同上                                                                              |
| **n8n / Supabase**                | 开源 + Cloud                                                         | 同上                                                                              |
| **OpenSanctions**                 | 开源数据 + 商业 bulk data 访问                                       | 同上；同行业最直接对照                                                            |
| **Mapbox vs OSM**                 | OSM 是开放底层、Mapbox 是付费上层                                    | 任何团队可基于 SupplyStrata 做付费产品，本体仍开源                               |

## 三个借鉴最深的产品（决策溯源）

如果要快速理解 SupplyStrata 当前所有决策的灵感来源，读这三个产品的架构就够了：

### 1. OpenSanctions（产品结构）

**为什么读它**：合规筛查领域的 SupplyStrata。开源、官方源驱动、可下载数据、可 self-host、有开放 ontology (FollowTheMoney)。

**直接对应**：

- 六入口产品结构 → SupplyStrata MCP server 的 tool / resource 设计
- 定期 parquet dump → community-pack (#14)
- Yente self-host API → SupplyStrata local instance (#8)
- FtM ontology → SCBOM (#10)
- crawler-only truth → "truth 在官方源" (#2、#11)

**关键文档**：
- 架构: https://www.opensanctions.org/docs/
- Yente: https://github.com/opensanctions/yente
- FtM: https://followthemoney.tech/

### 2. OSV.dev / CycloneDX-SPDX (软件供应链 SBOM 生态)

**为什么读它**：证明"开放 schema + reference impl + 多家工具共生"是开源数据基础设施的最高级形态。

**直接对应**：

- SBOM 独立 schema → SCBOM 独立 repo (#10)
- 无 review queue 也能维护漏洞库 → evidence-gated auto-promote (#13)
- 多家 scanner / producer / consumer 共生 → SupplyStrata 长期愿景

**关键文档**：
- OSV: https://osv.dev/
- deps.dev: https://deps.dev/
- CycloneDX: https://cyclonedx.org/specification/overview/
- SPDX: https://spdx.dev/

### 3. GPT Researcher（reference agent 形态）

**为什么读它**：证明"开源 + 本地 + cited research report agent"形态可行。

**直接对应**：

- ~3k 行实现 cited markdown report → `@supplystrata/agent` 形态原型
- 用户带 LLM key → SupplyStrata 不内置 provider key (#9)
- 强 citation 约束 → 方法学 evidence-first 不变式

**关键文档**：
- https://github.com/assafelovic/gpt-researcher

## 不学的对照系（防止漂移）

后续如果有人提议"我们要不要做托管 SaaS / 内置 agent / 拓展到非上市公司众包数据"，先看这一节：

| 提议                                | 不学的对照系                            | 原因                                                                              |
| ----------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------- |
| 我们做托管 SaaS 吧                  | Bloomberg / Sourcemap                   | #8：经济模型不成立，护城河复刻不了                                                |
| 我们内置自己的 agent                | Manus / AutoGPT                         | #9：产品观点会过时，外部 agent UX 更好                                            |
| 我们接受用户众包供应商关系          | OpenCorporates 早期 / Wikipedia          | 方法学：没有 cite text 的事实不能写；众包内容验证成本高                            |
| 我们做实时秒级监控                  | Bloomberg / Refinitiv real-time         | 官方披露源本身是日 / 月 / 季级；伪实时是技术债                                    |
| 我们接 ImportYeti / 海关数据        | Panjiva / ImportGenius                  | ToS 灰色，开源项目法律风险高                                                     |
| 我们做股票 / 投资建议层              | Seeking Alpha / Robinhood                | 事实底座，不做 alpha；与方法学冲突                                                |
| 我们做实例间联邦同步                | Mastodon / ActivityPub                   | #8：跨实例治理、信任、冲突解决复杂度 > 价值                                       |

## 持续维护

- 任何新产品对照（无论想学还是想避开）应追加到本文，附"借鉴点"或"为什么不学"。
- 决策依赖本文时，在 `decisions.md` 对应 ADR 里反向引用本文章节。
- 本文不记录 SupplyStrata 自身的功能 / API / schema 细节；那些在 `module-design.md`、`schema.md`、`mcp-surface.md`（待建）。
