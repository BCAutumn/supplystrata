# Overview — 定位、边界与术语

SupplyStrata 是一个证据优先的供应链情报图谱 alpha。它把公开披露、供应商名单、实体注册信息和可审计 observation 整理成可追溯、可重建、可解释的研究底座。

当前最准确的定位：

```text
Evidence-backed supply-chain intelligence backend alpha
```

它还不是全球实时监控、成熟风险提示、货物流向追踪或投资建议系统。

## 要回答的问题

- 某公司依赖哪些上游？
- 某产品依赖哪些组件、材料、设备和设施？
- 某关系来自官方披露、供应商列表、贸易 observation、新闻 lead，还是人工 review？
- 证据在哪里？原文是什么？多久没有被重新验证？
- 哪些关系有强度、份额、产能或二源 corroboration？
- 哪些关键问题仍然 unknown？

## 不直接回答的问题

- 明天该买什么股票。
- 某公司下一季度是否超预期。
- 某批货物的真实客户分配。
- 没有公开证据的供应商关系。
- 没有官方证据的公司级货物流向。

这些问题可以由下游研究员、正式前端或内部只读 AI 基于 SupplyStrata 输出继续分析，但不能回写事实层。

## 核心原则

- **证据优先**：每条 fact edge 必须能追到 evidence、document、source URL 和 cite text。
- **未知优先**：不知道就写 unknown，不用 fallback 或 LLM 猜测填空。
- **事实与派生分离**：risk、strength、freshness、observation、alert 都是派生层，不污染 facts。
- **免费公开优先**：P0 数据源必须公开、合法、可复现。
- **实体消歧先于关系抽取**：公司、业务部门、设施、组件不能混成一个模糊节点。
- **AI 只读解释**：内部 AI 不联网、不爬虫、不运行 connector、不写 truth store、不审批 review。
- **外部 AI 只读消费**：不提供外部 AI 提交证据、候选、source target 或爬虫结果的接口。

## 当前不做

| 不做                                       | 原因                                         |
| ------------------------------------------ | -------------------------------------------- |
| 投资建议 / 自动交易 / 回测                 | 事实底座不是 alpha 系统                      |
| 实时秒级监控                               | 大多数官方源本身是日级、月级或季度级         |
| 漂亮正式前端 / SaaS / 多租户               | 当前优先级是方法论、数据质量、API 和后端闭环 |
| 商业付费数据库                             | 与开源、免费公开优先冲突                     |
| ImportYeti 等 ToS 灰色来源的自动化抓取     | 法律风险高，只允许人工或半手工 evidence 路径 |
| LLM 凭空补全事实关系                       | 所有事实必须有 cite text 和 review-safe path |
| observation / lead / policy 自动生成事实边 | 它们只能作为研究信号、约束或风险派生输入     |
| 全行业覆盖                                 | 当前 gold path 是 AI compute / semiconductor |

## 核心术语

| 术语                | 含义                                                               |
| ------------------- | ------------------------------------------------------------------ |
| `fact edge`         | 有可追溯 evidence 支撑的事实关系。                                 |
| `evidence_level`    | 1-5 离散证据等级，只描述来源强度，不是风险分。                     |
| `confidence`        | 抽取/解析置信度，不等于真实世界概率。                              |
| `claim`             | 多条 evidence 融合后的可读结论。                                   |
| `observation`       | 公开世界中的可复现变化，如财务指标、贸易流、价格、政策、设施事件。 |
| `lead`              | 值得调查但不能写事实边的线索。                                     |
| `unknown`           | 阻止结论成立的显式未知项。                                         |
| `source target`     | 可运行或待修复的数据源监控目标。                                   |
| `WorkbenchModel`    | 稳定 machine-readable export contract。                            |
| `research-pack`     | 围绕某个研究 scope 生成的目录化报告和 JSON 输出。                  |
| `GraphStore`        | 可重建图谱物化视图；Postgres truth store 才是事实来源。            |
| `relation_strength` | share、dependency、capacity、qualitative 等关系重要性派生上下文。  |
| `freshness`         | 事实边最后验证时间的派生新鲜度。                                   |
| `risk_metric`       | HHI、single-source、centrality、knockout 等图算法或观测派生指标。  |

## 权威判断入口

- 方法学边界：[intelligence-methodology.md](../03-data-model/intelligence-methodology.md)
- 后端完成门槛：[backend-completion-criteria.md](../06-development/backend-completion-criteria.md)
- 模块边界：[module-design.md](../02-architecture/module-design.md)
- 运行入口：[quickstart.md](../06-development/quickstart.md)
