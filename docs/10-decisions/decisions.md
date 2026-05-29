# Decisions — 架构决策摘要

本文合并当前仍有效的 ADR。旧的逐条 ADR 文件已经删除，避免文档数量膨胀；如需改变下面任何决策，直接更新本文并在变更说明里写清楚原因。

新加入的决策（#8 起）是 2026-05-28 产品定位重构的产物，把 SupplyStrata 从"中心化研究后台"重新定位为"AI agent 的供应链证据数据源"。它们和 #2、#3、#7 互相依赖；如要回退，应整体回退而不是单条修改。

## 1. 主语言：TypeScript 主栈，Python 仅作必要 sidecar

决策：

- 默认使用 TypeScript、pnpm workspaces、strict TS。
- XBRL ZIP、复杂 PDF、表格抽取等确有必要时再引入 Python sidecar。
- sidecar 必须通过清晰 IPC contract 接入，不能把 Python 变成第二套业务系统。

理由：

- 供应链情报系统更怕 silent failure，TypeScript 类型边界更适合当前阶段。
- Web/API/CLI/LLM SDK/DB tooling 统一。
- Python 在 XBRL/PDF/NLP 生态上保留为专项能力。

## 2. 存储：Postgres 是本地 cache + audit ledger，不是 truth store

决策：

- Postgres 保存 entity 缓存、document、evidence、edge、claim、observation、unknown、job、audit。
- GraphStore（Neo4j adapter）是可重建的图谱当前态视图。
- 写入先提交 Postgres，再投影 GraphStore；投影失败可重试或重建。
- **truth 永远在官方源（SEC / DART / EDINET / TWSE / HKEX / Companies House / GLEIF / OpenFIGI / Wikidata / 公司 IR 等）**。删除本地 Postgres 不丢真相，可以从官方源 + 可选 community-pack 重建。
- 不同用户的 Postgres 实例不互相同步；warm start 走 community-pack 单向分发（见 #14）。

理由：

- "truth store" 语气暗示中心化权威源，与 local-first 承诺（#8）矛盾。
- 把 truth 留给官方源使方法学和数据流自洽：方法学（#3、#13）只要求"可追溯到 cite text + source URL"，不要求"DB 是权威"。
- 跨用户同步会引入治理、冲突解决、信任图等一整套问题；定位为 cache 后这些问题不存在。

## 3. LLM 策略：受控 helper，永不写事实，不内置 agent

决策：

- LLM 调用在核心代码里**只能通过 `@supplystrata/llm-helpers`**。该包导出 4 个有限用法：
  - `disambiguate_entity` — 多候选实体消歧
  - `derive_dynamic_profile` — 从公开简介派生 plan-context profile（不写事实）
  - `suggest_source_targets` — 建议下一步该跑哪些 source target（不执行）
  - `summarize_with_citations` — 在已有 evidence 上做带引用的摘要
- 每个 helper 必须 a) 单步 b) 返回 candidate（含 status、cite 来源、置信度）c) 永不直接写 `edges` / `evidence` / `claims` d) 可被全局环境变量关闭。
- 任何写 fact edge 的代码路径不允许 import `llm-helpers`。
- `@supplystrata/agent` 是独立 npm 包，**不被核心依赖**（见 #9）。
- LLM 抽取候选（rule extractor 之外）必须有 cite text、schema 校验、prompt/model 版本记录、`needs_review=true`。
- LLM 永远不能产生 Level 5 证据。

理由：

- 把 LLM 用法收敛到 4 个具名 helper 让审计可终结：grep `llm-helpers` 就能列出全部 LLM 调用点。
- 不内置 agent 让"open-source、local-first、零信任"承诺可兑现；agent 留给外部（Cursor / Claude Desktop / 用户自建）通过 MCP 接入（见 #9、#15）。

## 4. Monorepo：pnpm workspaces

决策：

- 保持单仓库。
- package 按 domain / feature 边界拆分，但不再为了"看起来干净"继续细拆。
- 新 package 必须证明生命周期、职责和依赖方向独立。
- package README 是模块细节的主要载体，`docs/` 不再保存模块长文档。

## 5. License：Apache-2.0

决策：

- 代码、文档、项目维护 seed metadata 使用 Apache-2.0。
- 第三方原始数据、商业网站内容、API 响应不随仓库授权。
- `data/`、`reports/`、`.env` 保持本地。

## 6. 队列：Postgres-backed durable jobs

决策：

- 当前 source monitor 使用 `source_check_jobs`。
- 不引入 pg-boss、Redis 或 Kafka。
- job 必须有 lease、retry/backoff、dead 状态和可审计 source change events。

## 7. 接入面：MCP-only，REST 推迟不删

决策：

- v0.x 唯一对外 surface 是 **MCP server**（`@supplystrata/mcp`），承载 tools / resources / prompts。
- 浏览器、CLI、自建 agent、Cursor / Claude Desktop 等所有 client 走同一组 MCP 定义。
- REST / OpenAPI **推迟到 v1.x，不在 v0.x 实现**；MCP HTTP/SSE transport 已经覆盖绝大多数"非 agent HTTP 客户端"诉求。
- API DTO（无论 MCP resource 还是未来 REST）不允许泄漏 DB Row。
- 外部 agent / 外部 app 只能读 + 触发受控写（source-check 入队、研究 run 创建等），不允许提交 evidence / review / 爬虫结果回写。

理由：

- 2025-2026 MCP 已成为 agent 调用外部能力的事实标准（Cursor / Claude Desktop / Cline / Windsurf / ChatGPT Desktop / LangChain 全支持）。
- 同时维护 REST 和 MCP 会让 REST 的形状反向锁住 MCP 设计；推迟 REST 让 MCP 的设计自由。
- 真有不便用 MCP 的 client 出现，再加一层薄 REST shim 是几天的工作，不会沉淀技术债。
- 老版 `apps/api` 的契约工作没有作废——它们会迁移到 MCP resource / tool 定义里，DTO 复用。

## 8. 部署形态：Local-first，没有中心化 SaaS

决策：

- 每个用户运行自己本地的 SupplyStrata 实例。
- 项目维护者**不提供托管 SaaS**作为产品主线（任何团队可基于此自建内部 / 行业 SaaS，但那不是项目本体）。
- 跨实例不同步 truth；warm start 靠 community-pack（#14）单向分发。
- 设计任何新功能必须问："如果这台机器永远不联网到其他 SupplyStrata 实例，还能用吗？"——答案必须是"能"。

理由：

- 中心化 SaaS 的护城河是数据团队规模（Bloomberg 几万人 12 小时倒班），开源项目物理上无法复刻这条护城河。
- Local-first 同时获得：用户隐私、数据主权（许多企业不能把供应链数据上传第三方）、零运营成本、无 vendor lock-in、合规简单。
- 引入 OpenSanctions Yente / Wikibase / Mastodon 等"open 协议 + 任何人 self-host"模式作为参照系，证实这是成熟开源基础设施的常见形态。

不采纳的备选：

- 托管 SaaS（拒绝：经济模型不成立；与开源承诺冲突）。
- 联邦同步（recommended-out-of-scope：跨实例信任图涉及治理、冲突解决、声誉系统，复杂度远超价值）。

## 9. Agent：不在核心，独立 reference 包

决策：

- 核心代码（`@supplystrata/core` 及所有 workflow 包）**绝不内置 agent loop**。
- `@supplystrata/agent` 是独立 npm 包，optional dependency；删掉它 SupplyStrata 仍完整可用。
- 参考 agent 默认通过 MCP 调本机 SupplyStrata，用户自带 LLM provider（OpenAI / Anthropic / DeepSeek / 本地 ollama 等）。
- 外部 agent（Cursor / Claude Desktop / Cline / 自建 LangGraph）是一等公民 consumer；MCP 接入面优先服务它们。

理由：

- agent loop 是产品观点，会随模型能力变化（GPT-4 vs Claude 4 vs Gemini 3 时代的最佳 agent 写法完全不同）。把今天的 agent 焊死进核心，6 个月后会过时。
- 不内置 agent 让 SupplyStrata 保持"中立基础设施"定位，类似 Stripe / Plaid / Twilio 之于 AI agent：提供能力，不提供智能。
- Cursor / Claude Desktop 等外部 agent UX 远超我们能做的内置 agent；与其竞争不如服务它们。
- 核心不绑 LLM key 让 local-first（#8）和零信任更容易兑现。

不采纳的备选：

- 内置 agent（拒绝：观点焊死、UX 不如外部、违反零信任）。
- 完全不做 reference agent（拒绝：用户首次体验缺一个"开箱跑得起来"的选项）。

## 10. SCBOM：开放 schema 独立 repo

决策：

- 抽取当前 `workbench-export` 的稳定 JSON 契约升级为 **SCBOM (Supply Chain BOM) v0.x**，独立 GitHub repo 维护。
- SCBOM 用 JSON Schema + Markdown spec 描述：实体、关系、证据、置信度、强度、新鲜度、unknown、observation、SCBOM 自身的版本/metadata。
- SupplyStrata 是 SCBOM 的**参考实现**，不是格式拥有者；显式邀请其他工具实现 producer / consumer。
- SCBOM 版本独立递进，与 SupplyStrata 仓库版本解耦。

理由：

- 软件供应链领域 CycloneDX / SPDX 的生态杠杆效应已经证明：开放 schema > 自家工具。Snyk / Anchore / Trivy / Syft / OSV-Scanner 互通是因为格式标准化，不是某一家强势。
- SupplyStrata 当前 `workbench-export` 已经是接近 SCBOM 的形态，差的只是"独立版本号 + 公开 spec + 邀请实现"。
- 长期治理风险用 ADR 化决策权 + 严格 schema 审查流程控制。

不采纳的备选：

- schema 留在 monorepo（拒绝：限制外部采用）。
- 不做独立 schema，只做内部 DTO（拒绝：放弃生态杠杆）。

## 11. 实体冷启动：扔掉公司 seed，全部从官方 registry bootstrap

决策：

- 删除 `seeds/entities.csv` 和 `seeds/aliases.csv` 中所有公司层 seed；移到 `tests/fixtures/dev-entities/` 作为 CI 测试用。
- `seeds/components.csv` 与组件别名移入 `@supplystrata/component-context`（共享世界知识）。
- 生产代码路径**不允许依赖任何本地预置公司 CSV**；任意公司都从官方 registry 现查现建。
- registry 接入优先级：GLEIF / OpenFIGI / Wikidata（身份）→ 各国官方目录（SEC / DART / EDINET / TWSE / HKEX / Companies House / 各国 OAM）→ 公司 IR 网站。
- 命中歧义 / 不可达 / 未覆盖市场都以显式状态返回，不伪装成"公司不存在"。

理由：

- 81 家 seed 的覆盖范围与"任意全球上市公司"目标差几个数量级，且 seed 越多越像中心化产品。
- 官方 registry 本身就是免费、合法、稳定的全球公司目录；不依赖 seed 反而让数据更新鲜。
- 与 #8 local-first 一致：每个用户的实体宇宙都是按需查出来的，不是"我们家供的"。

不采纳的备选：

- 扩 seed（拒绝：人工维护几万家公司不可持续）。
- 只支持已 bootstrap 市场（拒绝：用户无法预测哪个市场没接，体验差；应显式状态返回）。

## 12. 行业 Profile：运行时 derive，内置 profile 仅作 verification anchor

决策：

- 现有两个 hard-coded profile（`ai-compute-memory.v0`、`ev-battery-energy.v0`）保留但**重新定位为 verification anchor**（gold path 验证用），不再是"产品覆盖范围"。
- 真实 profile 在 research session 内动态 derive：通过 `llm-helpers.derive_dynamic_profile` 读公司公开简介、SEC SIC/NAICS、DART 业种、10-K Item 1，输出该公司预期上游组件 / source target 清单。
- derived profile 仅作为 plan-context，**不持久化、不写事实、session 结束即丢**。
- 用户/agent 可显式覆盖 derived profile（通过 MCP tool 参数）。

理由：

- 全球 100+ 个一级产业、几万家上市公司，手工 profile 是不可能的工程量。
- profile 本质是"研究计划"，不是"事实"——LLM derive 不违反方法学（#3）的事实层禁令。
- 与 #11 一致：把"世界知识"从 build-time 推到 runtime，让任意行业即开即用。

## 13. 事实写入门槛：Evidence-gated auto-promote 默认，review 是 opt-in

决策：

- 默认写入路径：当 `extractor 是 rule AND source 是官方 AND evidence_level ≥ 4` 时**自动写入**，不要求人工 review。
- 双源 corroboration（独立官方源命中同一关系）任一来源是 LLM 抽取的情况下，仍可自动写入。
- LLM 单源抽取 / 弱源 / 单一来源 / 有冲突 → 留作 `review_candidates`，由调用 agent 或用户决定。
- Review queue 仍然存在（`@supplystrata/review-store`），但是 **opt-in 高风险部署模式**，不是默认体验。

理由：

- 现有 review-gated 默认在 solo / local-first 场景下退化为"事实层永远为空"——见 `tests/llm_research/D.md` 的 Tesla 报告：`partial / observations_only / reviewed fact edges = 0`。
- 规则抽取在官方 10-K 上的"we utilize foundries such as TSMC and Samsung"本来就是 L5 evidence，没必要走 review。这条 auto-promote 路径在代码里其实已经存在（`data-flow.md` 第 6 步），只是被方法学语气盖住了。
- review queue 在企业部署 / 合规场景仍有价值，保留但降级为可选。

不采纳的备选：

- 全部 LLM 抽取自动写入（拒绝：抽取错误会污染事实层）。
- 全部走 review（拒绝：solo 用户体验为零）。

## 14. 数据分发：Community-pack 作为 warm-start baseline

决策：

- 维护团队定期发布 `supplystrata-pack-YYYY.QN.parquet`（或 sqlite），覆盖已审 gold path 的实体、关系、证据。
- pack 通过 GitHub Release 或公开对象存储分发；用户启动时可选拉取。
- pack 是 **read-only baseline**：本地新写入会覆盖 pack 内容，但不污染 pack；pack 升级时本地新写入保留。
- pack 第一份目标 Q3 2026，覆盖 AI compute + EV battery + 半导体头部。
- pack 不是 truth，是 warm cache；truth 仍在官方源（#2）。

理由：

- 解决 local-first 的冷启动悖论：新用户第一次跑能直接看到 AI compute / EV battery 链条，不必从空开始。
- 参照 OpenSanctions / OSV.dev / OpenAlex 模式：开放数据 dump 是开源数据基础设施的标准价值交付物。
- 维护团队的工作量集中在 pack 生成，而不是托管 SaaS 运营。

## 15. 前端：中立 SCBOM viewer，不内置 agent

决策：

- `@supplystrata/web` 是中立 SCBOM viewer，不消费 WorkbenchModel / DB / SupplyStrata 私有状态；任何符合 SCBOM v0.x 的 document 都能渲染。
- 分两层发布：
  - **L0 headless core**：纯 TypeScript、零 DOM、零网络、零框架，把 SCBOM 规范化成 `ScbomView`。React / Vue / 内部 design system 想深度定制时直接消费 L0 自画 UI。
  - **L1 Web Components**：`<scbom-evidence-view>`、`<scbom-unknown-map>`、`<scbom-supply-chain-graph>`；用 Lit 编写标准 Custom Elements，Shadow DOM + CSS variables + `::part()` + slot 暴露换肤面。
- `packages/web` 自身不引 React / Vue / Svelte 作为运行或构建依赖；Lit 是 Web Components authoring library，不是宿主框架绑定。
- 同时发布 IIFE bundle（`<script>` 即用）和 npm ESM（按需 import）。IIFE gzip size 有 CI 门禁（≤ 200KB）。
- 渲染 UX evidence-first：主视图是证据表 / 时间线和 unknown map；Sigma.js / WebGL 图只作概览入口。
- 浏览器 MCP HTTP client 默认只连 `127.0.0.1`；远程 endpoint 必须显式 opt-in。viewer 只读，不暴露 source check / review / research session 写入口。
- 不内置 agent。需要 agent 体验时，由调用方 agent（包括 `@supplystrata/agent` 或外部 Cursor / Claude Desktop）通过 MCP 驱动可视化。
- `apps/web` 是薄本地 viewer shell，把组件拼起来连本机 MCP HTTP，供本地实例首次体验；不做用户管理、不做权限、不做主题。

理由：

- "供应链图"无法用文本表达——这是任何 agent 用 markdown 表格永远填不上的体验空缺，是前端唯一独占价值。
- 可嵌入意味着 SupplyStrata 不需要"自己的网站"。任何想做供应链产品的人能把组件嵌进他的 Next.js / Nuxt / Astro / 内部 dashboard，传播路径远大于"我们跑一个网站"。参照 Mermaid / Excalidraw / Cytoscape 的生态扩张方式。
- 不内置 agent 让前端与外部 agent 平级（都是 MCP client），不抢话语权。"AI 自动生成全球供应链地图"的工作流变成"外部 agent → MCP → 可视化组件渲染"，比内置 agent 更通用。
- L0 + Web Components 不带 React / Vue 依赖，避免框架版本冲突，最大化嵌入兼容性。

不采纳的备选：

- 完整 Next.js Web App（拒绝：隐含中心化部署、SEO 站、品牌站，与 local-first 矛盾；难以嵌入）。
- 桌面应用 Electron / Tauri（拒绝：local-first 对，但封闭、难嵌入、安装摩擦大）。
- 不做前端只让 agent 输出 markdown（拒绝：供应链图必须可视化，是核心价值）。
- React-only 库（拒绝：限制嵌入到非 React 项目）。
