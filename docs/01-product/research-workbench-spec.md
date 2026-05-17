# Research Workbench Spec — 研究工作台规格

本文定义 `apps/research-preview`。它替代当前一次性的 `scripts/render-research-html.mjs`，但仍然是本地研究工作台，不是 SaaS 前端。

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
observation
lead
unknown
```

前端不得把 observation 画成事实边。

## 交互

v0.2 必须支持：

- 公司切换。
- 点击边，右侧显示 Evidence Inspector。
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
- 工作台入口改为 `pnpm research-preview` 或等价命令。
