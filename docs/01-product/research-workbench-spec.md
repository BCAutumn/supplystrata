# Research Workbench Spec — 研究工作台规格

本文定义 `apps/research-preview`。它是本地交互式研究工作台，不是 SaaS 前端。静态 HTML 报告由 `scripts/render-research-html.mjs` 从 `research-pack` 目录生成，两者共享同一条后端 truth-store / workbench / research-pack 主线，但用途不同。

当前第一版已经落地为本地静态工作台：

```bash
pnpm cli workbench export --company nvidia --out reports/nvidia-workbench.json
pnpm research-preview
```

然后打开本地服务输出的 URL：

```text
http://127.0.0.1:4173/apps/research-preview/index.html?report=/reports/nvidia-workbench.json
```

如果没有传 `?report=`，工作台仍然支持手动加载 JSON 文件。自动加载入口是给 CLI、桌面端、Agent 产品嵌入使用的；文件选择入口是给本地调试和外部复现使用的。

## 决策

v0.2 研究工作台采用：

```text
TypeScript + Canvas
```

不采用：

```text
React
Next.js
SPA 路由框架
组件库
```

原因：

- 目标是可嵌入 TS 桌面端或 agent 产品。
- 当前最复杂的是图谱绘制、hit-testing、缩放、布局，不是表单业务。
- React 层在这个阶段会增加边界和构建复杂度。
- 工程上更适合把渲染核心做成 framework-agnostic canvas engine。

## 布局

```text
┌──────────────────────────────────────────────────────────┐
│ Header: 公司选择 / phase 状态 / last fetched at          │
├────────────────────────┬─────────────────────────────────┤
│                        │ Edge Inspector                  │
│   Chain Canvas         │ - relation / component          │
│   - Tier 1 official    │ - evidence_level / confidence   │
│   - Observation lane   │ - cite_text + locator           │
│   - Unknown boundary   │ - source URL + fetched_at       │
│                        │ - inferred 状态                 │
│                        ├─────────────────────────────────┤
│                        │ Draft Claims                    │
│                        │ - reviewed semantic changes     │
│                        │ - non-active research drafts    │
│                        ├─────────────────────────────────┤
│                        │ Unknown Map                     │
├────────────────────────┴─────────────────────────────────┤
│ Source Health · Changes Timeline · Review Queue Stats    │
└──────────────────────────────────────────────────────────┘
```

## 核心模块

```text
apps/research-preview/
├── src/
│   ├── main.ts
│   ├── app-state.ts
│   ├── data/
│   │   ├── load-report.ts
│   │   └── normalize-workbench-model.ts
│   ├── canvas/
│   │   ├── chain-canvas.ts
│   │   ├── layout.ts
│   │   ├── hit-test.ts
│   │   └── draw.ts
│   ├── panels/
│   │   ├── evidence-panel.ts
│   │   ├── unknown-panel.ts
│   │   ├── source-health-panel.ts
│   │   └── changes-timeline.ts
│   └── styles.css
└── index.html
```

React 不存在；DOM 只负责 shell 和 side panels，Canvas 负责图谱。
当前前端只读本地 JSON 文件，不直连 Postgres / Neo4j，也不调用 CLI。
本地服务只负责静态文件和导出 JSON 的读取，不引入后端 API。

## 数据契约

工作台只消费 JSON，不直接访问 Postgres / Neo4j：

```ts
interface WorkbenchModel {
  companies: CompanyWorkbenchNode[];
  selected_company_id: string;
  chain_segments: ChainSegment[];
  edges: WorkbenchEdge[];
  upstream_edges: WorkbenchEdge[];
  downstream_edges: WorkbenchEdge[];
  draft_claims: WorkbenchClaim[];
  evidences: WorkbenchEvidence[];
  unknown_items: WorkbenchUnknown[];
  sources: WorkbenchSourceHealth[];
  changes: WorkbenchChange[];
}
```

`evidences` 必须包含 ChainView 事实边上的全部 evidence，而不只是 `primary_evidence_id`。如果旧 evidence 已经被 `superseded_by` 指向新 evidence，工作台仍要保留它，让研究员能看到证据链如何演化。

`chain_segments.semantic_layer` 必须保留：

```text
edge
claim
observation
lead
unknown
```

前端不得把 observation 画成事实边。
`claim` 只作为可读结论或标签展示，不得被前端当成一条新的供应链关系。

`draft_claims` 是单独区块，不属于 `chain_segments`。它来自已确认的 `semantic_change` review candidate，状态必须是 `draft`，并且导出时按当前研究公司 scope 过滤。前端只能把它展示为研究草稿，不能画进 fact edge lane，也不能把它计入 active claims。

## 交互

v0.2 必须支持：

- 公司切换。
- 点击边或上下文 segment，右侧显示 Inspector。
- 点击 unknown boundary，右侧显示 unknown item。
- Draft Claims 区块显示已确认但未升级为事实边的 claim 草稿。
- Source health 区块显示 last_success / last_failure / next_check_at。
- Changes timeline 显示新增边、新证据、文档变化。

v0.2 不支持：

- 编辑图谱。
- 登录。
- 多用户协作。
- 动画或复杂过渡。
- 在线部署。

## 视觉约定

```text
solid edge
  Level 4/5 graph edge

dashed edge
  inferred edge，默认隐藏，用户打开后显示

thin grey line
  observation link

orange boundary
  unknown / confidential / unverified segment

draft claim panel
  reviewed semantic-change research draft; never a fact edge
```

默认隐藏 Level 1-3，按钮文案使用：

```text
show inferred edges
```

默认状态必须是 off。

## 静态 HTML 报告

`scripts/render-research-html.mjs` 是 research-pack 的静态读物渲染器：

- 输入是 research-pack 目录，例如 `reports/gate1-latest-nvidia`。
- 输出是可用 `file://` 打开的 HTML。
- 可选传入上一版 research-pack 目录，用于展示指标 delta。
- 不再兼容早期 `preview report` JSON。
- 不承担交互式工作台职责，不直接读取 Postgres / Neo4j。

示例：

```bash
pnpm --silent cli research run --company nvidia --depth 5 --prepare-data --out reports/gate1-latest-nvidia
node scripts/render-research-html.mjs reports/gate1-latest-nvidia reports/latest-nvidia-research.html
```

## 与工作台的差异

`apps/research-preview` 是研究工作台：它从 `workbench export` JSON 读取 `chain_segments / claims / draft_claims / evidences / unknown_items / sources / changes`，用 Canvas 画事实边、观测、线索和未知边界，并用侧栏展示已确认语义变化产生的 claim 草稿。它的目标不是只展示 NVIDIA，而是未来输入 Apple、Tesla、Microsoft、SpaceX 等任意研究对象时，都沿用同一个数据契约和交互模型。

静态 HTML 是研究包读物：它从 `research-pack` 读取 manifest、Gate 1 readiness、source-target coverage、supply-chain expansion plan、data-depth workbench、run ledger、quality 和 question/propagation readiness。它的目标是让研究员或宿主 app 快速判断“这次研究包质量如何、还缺什么、下一步跑什么”，不是长期替代工作台。

因此两者的核心区别是：

```text
静态 HTML
  research-pack 读物、可比较版本、适合验收 Gate 1 数据深度和缺口。

research-preview workbench
  通用工作台、公司可配置、truth-store 导出、适合继续做深层供应链追踪。
```
