# SupplyStrata

> Open Supply Chain Evidence Graph
> 公开供应链证据图谱系统

SupplyStrata 是一个开源的**全球供应链证据图谱引擎**：它把公司披露、供应商名单、实体注册信息、物流与贸易观测整理成可审计、可追溯、可重建的供应链关系网络。

SupplyStrata 把公开信息变成可验证的研究资产：每条边都有证据等级、原文片段、来源链接、抓取时间、置信度、review 状态和 unknown map。你可以从一家上市公司出发，追踪上游供应商、合同制造、组件暴露、设施地点和后续物流/贸易线索，并且始终知道哪些结论有证据、哪些地方仍然未知。

---

## 本项目是什么

把**公开数据**（公司 10-K / 年报 / IR / 监管文件 / 海关贸易 / 港口 AIS / 能源商品价格 / 政府采购等）整理为一张可追溯、可视化的供应链证据图谱。

每条供应链关系都必须带：

- 证据等级（Level 1-5）
- 来源类型（10-K / IR / Comtrade / BOL / 新闻 / …）
- 来源链接与抓取日期
- 证据原文片段
- 是否为推断（is_inferred）
- 置信度分数
- 最近验证时间

它面向产业链研究、决策支持、金融研究、采购分析和开源情报工作流，目标是把"NVIDIA 上游有谁、HBM 供给紧张到什么程度、Apple 哪些组件来自哪些地区"这类问题，整理成**有证据、有时间戳、有来源、有不确定性标注**的答案。

具体定位与边界请看 [docs/00-overview/vision.md](./docs/00-overview/vision.md) 和 [docs/00-overview/non-goals.md](./docs/00-overview/non-goals.md)。

---

## 文档导航

完整目录见 [docs/README.md](./docs/README.md)。下面是 onboarding 的最小阅读路径：

1. [vision.md](./docs/00-overview/vision.md) — 系统要解决什么问题
2. [non-goals.md](./docs/00-overview/non-goals.md) — 系统边界
3. [audience-and-personas.md](./docs/01-product/audience-and-personas.md) — v0.2 用户边界
4. [mvp-scope.md](./docs/01-product/mvp-scope.md) — 第一版边界
5. [system-architecture.md](./docs/02-architecture/system-architecture.md) — 总体架构
6. [module-design.md](./docs/02-architecture/module-design.md) — 模块拆分与接口契约
7. [evidence-model.md](./docs/03-data-model/evidence-model.md) — 证据等级模型（系统的灵魂）
8. [roadmap.md](./docs/06-development/roadmap.md) — 阶段化开发计划
9. [v0.2-alpha-plan.md](./docs/06-development/v0.2-alpha-plan.md) — 下一版 alpha 的产品范围
10. [release-criteria.md](./docs/06-development/release-criteria.md) — 发布验收标准
11. [source-roi-matrix.md](./docs/04-data-sources/source-roi-matrix.md) — 数据源投入产出排序
12. [open-source-readiness.md](./docs/06-development/open-source-readiness.md) — 开源发布前体检
13. [quickstart.md](./docs/06-development/quickstart.md) — 从空环境跑到研究输出

---

## 设计原则

SupplyStrata 的目标是把公开信息变成可信的供应链研究基础设施。项目坚持几条原则：

1. **证据优先**。每条关系都要能追到来源、原文片段、抓取时间、证据等级和置信度。
2. **图谱可重建**。DatabaseStore 是 truth store，GraphStore 是可插拔物化视图；图坏了可以从证据库重建。
3. **未知也要建模**。客户匿名化、合同价格、订单分配和隐藏物流路径会明确进入 unknown map。
4. **规则先行，LLM 兜底**。LLM 产出候选并进入 review 流程；cite_text 校验和 `evidence_level = 4` 上限按 [ADR-003](./docs/10-decisions/ADR-003-llm-strategy.md) 执行。
5. **开源友好，可嵌入**。核心路径优先保持 TypeScript、CLI 和无数据库 preview 能力，方便后续嵌入桌面端、agent 产品或独立研究工作台。
6. **ToS 与法律边界先于代码**。SEC EDGAR、UN Comtrade、NOAA、EIA、FRED 是明确允许的；ImportYeti / 部分商业网站是灰色的，采用手工或半手工证据录入。详见 [docs/09-risks-compliance/](./docs/09-risks-compliance/)。

---

## 当前状态

| 内容                                | 状态                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------ |
| 愿景与边界                          | drafted                                                                  |
| 数据模型                            | drafted                                                                  |
| 模块设计                            | drafted                                                                  |
| 数据源清单                          | drafted                                                                  |
| 技术选型 ADR                        | accepted                                                                 |
| 开源 license ADR                    | accepted                                                                 |
| 代码骨架（monorepo）                | implemented                                                              |
| 数据库 schema 落库                  | implemented                                                              |
| 第一批数据源 adapter                | SEC EDGAR implemented；TSMC/Samsung/SK hynix/ASML/Apple supplier preview |
| NVIDIA 10-K 纵向切片                | implemented                                                              |
| Apple Supplier List review/apply    | implemented (semi-auto, requires review)                                 |
| Entity source lookup/import         | preview/review path implemented                                          |
| GraphStore / Neo4j adapter 健康检查 | implemented                                                              |
| Evidence trace/fingerprint          | implemented for newly applied evidence                                   |

## 当前可运行切片

无数据库 preview 路径：

```bash
pnpm install
pnpm --silent cli preview nvidia --format markdown
pnpm --silent cli preview report nvidia --format markdown --lang zh
pnpm --silent cli preview sec-edgar --cik 0001045810 --entity ENT-NVIDIA --types 10-Q --format markdown
pnpm --silent cli preview sec-edgar --cik 0001045810 --entity ENT-NVIDIA --types 8-K --format markdown
```

`preview` 命令执行 source adapter `plan/fetch/normalize`、规则抽取、seed 实体消歧和证据评分；适合未来嵌入 TS 桌面端或 agent 产品。当前切片走规则抽取路径，LLM 扩展遵循 [ADR-003](./docs/10-decisions/ADR-003-llm-strategy.md)。

需要累积证据、审计、review/apply 和图谱重建时，接入 DatabaseStore；仓库内置 Postgres adapter，也允许宿主 app 注入兼容的 truth store 生命周期。需要本地图谱物化检查时，再接入某个 GraphStore adapter。仓库内置 Neo4j adapter；嵌入其它 app 时可以由宿主提供自己的 GraphStore。Docker 是本地开发的可选启动方式；也可以使用已有的 Postgres / Neo4j 服务并改 `.env` 连接串。

用 Docker 启动本地持久化环境：

```bash
docker compose up -d postgres neo4j
pnpm smoke:local --with-db
```

无数据库 smoke 适合开源贡献者先确认 CLI surface；联网研究切片再单独运行：

```bash
pnpm smoke:local
pnpm smoke:network
```

LLM 策略、`needs_review` 默认值与 cite_text 校验规则按 [ADR-003](./docs/10-decisions/ADR-003-llm-strategy.md) 保留，当前可运行切片使用规则抽取。

`sec-edgar` adapter 支持 `10-K / 10-Q / 20-F / 8-K`。当前 NVIDIA shortcut 仍默认跑 10-K；10-Q / 8-K 先作为显式命令和后续 source monitor 调度入口。

检查 Neo4j 物化视图是否和 Postgres 真相存储一致：

```bash
pnpm --silent cli graph check --format json
```

查看免费/公开数据源的监控健康状态：

```bash
pnpm --silent cli sources health --format markdown
pnpm --silent cli sources due --format markdown
pnpm --silent cli sources policy sync --file config/source-policies.example.json
pnpm --silent cli sources run-due --limit 5 --format markdown
```

查看图谱和来源变化时间线：

```bash
pnpm --silent cli changes --since 2026-05-01 --format markdown
pnpm --silent cli changes --source sec-edgar --attention-only
pnpm --silent cli changes --scope company:ENT-NVIDIA --format json
```

从已验证事实边生成可审计 claim 层：

```bash
pnpm --silent cli claims build --min-level 4 --format markdown
```

历史 evidence 可分批补齐精确定位和指纹：

```bash
pnpm --silent cli db backfill-evidence-trace --limit 1000
```

Apple Supplier List 是半自动链路：

```bash
pnpm --silent cli preview apple-suppliers --limit 10 --format markdown
pnpm --silent cli review enqueue apple-suppliers
pnpm --silent cli review next
pnpm --silent cli review approve <REV-id> --reviewer <name> --reason "matched source row"
pnpm --silent cli review apply <REV-id> --reviewer <name>
```

批处理仅应用已经 approved 的候选，pending 候选继续等待审核：

```bash
pnpm --silent cli review apply-approved --reviewer <name> --limit 10
```

## 开源许可与数据边界

代码、文档和项目维护的 seed metadata 使用 [Apache-2.0](./LICENSE)。

本仓库保存代码、文档、配置样例和项目维护的 seed metadata。`data/`、`reports/`、`.env` 保持在本地；公开输出保留必要 cite_text 片段、来源 URL 和来源日期。第三方数据源许可与 ToS 见 [data-licenses.md](./docs/09-risks-compliance/data-licenses.md) 和 [legal-tos.md](./docs/09-risks-compliance/legal-tos.md)。

This project uses public data from sources such as SEC EDGAR, company investor-relations pages, Apple supplier-responsibility materials, OpenCorporates, and UK Companies House. Each citation should link back to its primary source.

后续路线图见 [docs/06-development/roadmap.md](./docs/06-development/roadmap.md)。
