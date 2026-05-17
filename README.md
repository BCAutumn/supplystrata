# SupplyStrata

> Open Supply Chain Evidence Graph
> 公开供应链证据图谱系统

**当前阶段**：Phase 1 已完成，Phase 2 正在推进。NVIDIA SEC 10-K 纵向切片、Apple Supplier List review/apply 纵向链路、Postgres 真相存储、Neo4j 物化图、`graph check/rebuild`、CLI 输出、测试门禁和新 evidence trace/fingerprint 写入已经跑通或落地。

SupplyStrata 正在把公开披露、供应商名单、实体注册信息和后续物流/贸易观测整理成一套**可审计、可追溯、可扩展的全球供应链证据图谱引擎**。当前 HTML 链路图是研究预览；v0.2 计划把它迁移为 `apps/research-preview`，采用 TypeScript + Canvas 的本地研究工作台。

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

**这不是一个荐股系统**，也不是一个交易信号系统。它的目标是把"NVIDIA 上游有谁、HBM 供给紧张到什么程度、Apple 哪些组件来自哪些地区"这类问题，给出**有证据、有时间戳、有来源、有不确定性标注**的答案。

具体定位与边界请看 [docs/00-overview/vision.md](./docs/00-overview/vision.md) 和 [docs/00-overview/non-goals.md](./docs/00-overview/non-goals.md)。

---

## 文档导航

完整目录见 [docs/README.md](./docs/README.md)。下面是 onboarding 的最小阅读路径：

1. [vision.md](./docs/00-overview/vision.md) — 系统要解决什么问题
2. [non-goals.md](./docs/00-overview/non-goals.md) — 系统**不做**什么（很重要）
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

SupplyStrata 的目标不是堆更多爬虫，而是把公开信息变成可信的供应链研究基础设施。项目坚持几条原则：

1. **证据优先**。每条关系都要能追到来源、原文片段、抓取时间、证据等级和置信度。
2. **图谱可重建**。Postgres 是 truth store，Neo4j 是物化视图；图坏了可以从证据库重建。
3. **未知也要建模**。客户匿名化、合同价格、订单分配和隐藏物流路径会进入 unknown map，而不是被系统假装知道。
4. **规则先行，LLM 兜底**。LLM 只产候选；默认 `needs_review = true`，未经审核不得入图。即使 cite_text 校验通过，LLM 证据最高也只能到 `evidence_level = 4`。
5. **开源友好，可嵌入**。核心路径优先保持 TypeScript、CLI 和无数据库 preview 能力，方便后续嵌入桌面端、agent 产品或独立研究工作台。
6. **ToS 与法律边界先于代码**。SEC EDGAR、UN Comtrade、NOAA、EIA、FRED 是明确允许的；ImportYeti / 部分商业网站是灰色的，只做手工或半手工证据录入。详见 [docs/09-risks-compliance/](./docs/09-risks-compliance/)。

---

## 当前状态

| 内容              | 状态           |
| --------------- | ------------ |
| 愿景与边界           | drafted      |
| 数据模型            | drafted      |
| 模块设计            | drafted      |
| 数据源清单           | drafted      |
| 技术选型 ADR        | accepted     |
| 开源 license ADR    | accepted     |
| 代码骨架（monorepo）  | implemented  |
| 数据库 schema 落库   | implemented  |
| 第一批数据源 adapter  | SEC EDGAR implemented；TSMC/Samsung/SK hynix/ASML/Apple supplier preview |
| NVIDIA 10-K 纵向切片 | implemented |
| Apple Supplier List review/apply | implemented (semi-auto, requires review) |
| Entity source lookup/import | preview/review path implemented |
| Neo4j 物化视图健康检查 | implemented |
| Evidence trace/fingerprint | implemented for newly applied evidence |

## 当前可运行切片

不启动 Docker、只看解析效果：

```bash
pnpm install
pnpm --silent cli preview nvidia --format markdown
pnpm --silent cli preview report nvidia --format markdown --lang zh
pnpm --silent cli preview sec-edgar --cik 0001045810 --entity ENT-NVIDIA --types 10-Q --format markdown
pnpm --silent cli preview sec-edgar --cik 0001045810 --entity ENT-NVIDIA --types 8-K --format markdown
```

`preview` 命令是无数据库路径，只做 source adapter `plan/fetch/normalize`、规则抽取、seed 实体消歧和证据评分；适合未来嵌入 TS 桌面端或 agent 产品。当前切片只使用规则抽取，没有调用 LLM API。

需要累积证据、审计、review/apply 和图谱重建时，需要 Postgres；需要本地图谱物化检查时再接 Neo4j。Docker 只是本地开发里最省事的一种启动方式，不是产品运行时强依赖；也可以使用你已有的 Postgres / Neo4j 服务并改 `.env` 连接串。

用 Docker 启动本地持久化环境：

```bash
docker compose up -d postgres neo4j
pnpm smoke:network
```

只检查本地数据库、seed 和 Neo4j 同步，不访问外网：

```bash
pnpm smoke:local
```

LLM 策略、`needs_review` 默认值与 cite_text 校验规则仍按 [ADR-003](./docs/10-decisions/ADR-003-llm-strategy.md) 保留，但不属于这次已经跑通的路径。

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
```

查看图谱和来源变化时间线：

```bash
pnpm --silent cli changes --since 2026-05-01 --format markdown
pnpm --silent cli changes --source sec-edgar --attention-only
pnpm --silent cli changes --scope company:ENT-NVIDIA --format json
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

批处理只处理已经 approved 的候选，不会自动批准 pending：

```bash
pnpm --silent cli review apply-approved --reviewer <name> --limit 10
```

## 开源许可与数据边界

代码、文档和项目维护的 seed metadata 使用 [Apache-2.0](./LICENSE)。

本仓库不重新发布第三方原始材料。`data/`、`reports/`、`.env` 不应提交；公开输出只保留必要 cite_text 片段、来源 URL 和来源日期。第三方数据源许可与 ToS 见 [data-licenses.md](./docs/09-risks-compliance/data-licenses.md) 和 [legal-tos.md](./docs/09-risks-compliance/legal-tos.md)。

This project uses public data from sources such as SEC EDGAR, company investor-relations pages, Apple supplier-responsibility materials, OpenCorporates, and UK Companies House. Each citation should link back to its primary source.

后续任务和未完成范围见 [docs/06-development/roadmap.md](./docs/06-development/roadmap.md)。
