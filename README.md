# SupplyStrata

> Open Supply Chain Evidence Graph
> 公开供应链证据图谱系统

**当前阶段**：Phase 1 已完成，Phase 2 正在推进。NVIDIA SEC 10-K 纵向切片、Apple Supplier List review/apply 纵向链路、Postgres 真相存储、Neo4j 物化图、`graph check/rebuild`、CLI 输出、测试门禁和新 evidence trace/fingerprint 写入已经跑通或落地。

这是 alpha/MVP 仓库，不是完整供应链数据库。当前 HTML 链路图只是静态研究预览，不是产品化前端；v0.2 计划把它迁移为 `apps/research-preview`，采用 TypeScript + Canvas 的本地研究工作台。

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

## 写在前面的若干客观提醒

写在最前，避免在文档里被乐观情绪带偏。

1. **6 周内做出完整供应链图谱是不现实的**。本仓库的 roadmap 改成阶段制（Phase 0-5），不承诺自然周。任何具体周数估计都是下限。
2. **TS 单一语言栈在 XBRL / 科学 NLP 场景下是次优解**。我们仍然以 TS 为主栈，但保留 Python sidecar 的接口（详见 [ADR-001](./docs/10-decisions/ADR-001-language-choice.md)）。
3. **免费数据有大量盲区**。CBP manifest confidentiality、客户匿名化（"Customer A"）、内部分配数据、合同价格等本质上拿不到。系统的重要产出之一是**未知地图**（unknown map），明确告诉用户哪里我们不知道。
4. **LLM 抽取出的关系不能直接当事实**。LLM 只产候选；默认 `needs_review = true`，未经审核不得入图。即使 cite_text 校验通过，LLM 证据最高也只能到 `evidence_level = 4`，永远不能产生 Level 5。
5. **ToS 与法律边界必须先于代码**。SEC EDGAR、UN Comtrade、NOAA、EIA、FRED 是明确允许的；ImportYeti / 部分商业网站是灰色的，**MVP 不做自动化抓取**，只做手工或半手工证据录入。详见 [docs/09-risks-compliance/](./docs/09-risks-compliance/)。

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

本地启动后可以跑完整 NVIDIA 公开披露切片：

```bash
pnpm install
docker compose up -d postgres neo4j
pnpm smoke:network
```

只检查本地数据库、seed 和 Neo4j 同步，不访问外网：

```bash
pnpm smoke:local
```

不启动 Docker、只看解析效果：

```bash
pnpm --silent cli preview nvidia --format markdown
pnpm --silent cli preview report nvidia --format markdown --lang zh
pnpm --silent cli preview sec-edgar --cik 0001045810 --entity ENT-NVIDIA --types 10-Q --format markdown
pnpm --silent cli preview sec-edgar --cik 0001045810 --entity ENT-NVIDIA --types 8-K --format markdown
```

当前切片只使用规则抽取，没有调用 LLM API。LLM 策略、`needs_review` 默认值与 cite_text 校验规则仍按 [ADR-003](./docs/10-decisions/ADR-003-llm-strategy.md) 保留，但不属于这次已经跑通的路径。

`preview` 命令是无数据库路径，只做 SEC 抓取、HTML 解析、规则抽取、seed 实体消歧和证据评分；适合未来嵌入 TS 桌面端或 agent 产品。Postgres/Neo4j 路径用于累积证据、审计、review 和图谱重建。

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
