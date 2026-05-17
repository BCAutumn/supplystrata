# Research Workbench Spec — 研究工作台规格

本文定义 `apps/research-preview`。它替代当前一次性的 `scripts/render-research-html.mjs`，但仍然是本地研究工作台，不是 SaaS 前端。

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
  evidences: WorkbenchEvidence[];
  unknown_items: WorkbenchUnknown[];
  sources: WorkbenchSourceHealth[];
  changes: WorkbenchChange[];
}
```

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

## 交互

v0.2 必须支持：

- 公司切换。
- 点击边或上下文 segment，右侧显示 Inspector。
- 点击 unknown boundary，右侧显示 unknown item。
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
```

默认隐藏 Level 1-3，按钮文案使用：

```text
show inferred edges
```

默认状态必须是 off。

## 当前脚本的处理

`scripts/render-research-html.mjs` 只作为临时静态预览。v0.2 完成后：

- README 不再推荐直接使用该脚本。
- 脚本可以保留为 fixture generator 或删除。
- 工作台入口改为 `pnpm research-preview`，数据入口改为 `pnpm cli workbench export --company <company> --out <file>`。

## 与最初 HTML 的差异

最初的 `reports/latest-nvidia-research.html` 是一次性报告页：它从 `preview report` JSON 生成，形态上更像“把 NVIDIA 研究结果排版出来”。它不读取 Postgres truth store，不消费 `ChainViewModel`，也不承载 source health、change timeline 和 claim/evidence 的长期契约。

`apps/research-preview` 是研究工作台：它从 `workbench export` JSON 读取 `chain_segments / claims / evidences / unknown_items / sources / changes`，用 Canvas 画事实边、观测、线索和未知边界。它的目标不是只展示 NVIDIA，而是未来输入 Apple、Tesla、Microsoft、SpaceX 等任意研究对象时，都沿用同一个数据契约和交互模型。

因此两者的核心区别是：

```text
旧 HTML
  单报告、NVIDIA 形态强、preview 数据、适合快速验收视觉方向。

新 workbench
  通用工作台、公司可配置、truth-store 导出、适合继续做深层供应链追踪。
```
