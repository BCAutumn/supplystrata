# Research UI Preview — 研究前端原型

本文记录本地 HTML 研究报告的产品方向。它不是正式前端技术方案，而是把 `research-pack` 的 Gate 1 输出压成一份可审阅的静态报告，避免输出层偏离 SupplyStrata 核心：**全球供应链追踪的第一屏必须是 chain graph / frontier / evidence readiness，而不是摘要卡片列表**。

静态 HTML 只消费 `research-pack` 目录，不再兼容早期 `preview report` JSON。先生成 research pack，再渲染 HTML：

```bash
pnpm --silent cli research run --company nvidia --depth 5 --prepare-data --out reports/gate1-latest-nvidia
node scripts/render-research-html.mjs reports/gate1-latest-nvidia reports/latest-nvidia-research.html
```

## 产品判断

参考公开供应链可视化产品的共同特征后，SupplyStrata 前端应优先表达四件事：

1. 多层供应链结构：谁连接谁、属于第几层、组件是什么。
2. 证据强度：哪些边是官方披露的 Level 4/5，哪些只是观测信号。
3. 变化监控：数据源什么时候检查、文档是否变化、哪些边受影响。
4. 未知边界：哪些关键问题公开来源不能回答，下一步最该查什么。

因此当前 HTML 报告采用：

- 主视图：Gate 1 scorecard、source monitoring、recursive frontier
- 证据说明：Evidence Layer Legend，把 L1-L5 与 fact / observation / lead 的边界放在第一屏
- 关系区：L4/L5 fact edges 与上游 leads 分层展示
- 质量区：data-depth workbench、explicit unknown、quality issue、question readiness

卡片可以存在，但只能服务链路、证据和缺口审查；不能让卡片列表替代供应链本体。

## 视觉语义

```text
fact edge
  Level 4/5，可进入事实图谱的直接关系。

Level 3
  重复海关 / BOL 或 reviewed inference，默认进入 review queue，不直接画成事实边。

Level 2
  趋势证据，进入 observation / propagation context，不证明具体公司关系。

Level 1
  单条新闻、论坛、招聘或爆料，只进入 lead / hypothesis。

lead / observation
  可研究、可监控、可排队审查，但不直接生成公司级供应链边。

unknown / disposition
  合同、价格、采购量、具体设施、物流路线、single-source 边等公开来源暂不能确认的边界。

颜色
  foundry / memory / manufacturing services 等组件类别。
```

这个约束很重要：例如 ASML 的官方披露可以作为 semiconductor capacity signal，但不能在没有直接证据时画成 `NVIDIA -> ASML` 或 `ASML -> TSMC` 的供应链事实边。

## 静态报告验收

静态 HTML 页至少要满足：

- 第一屏可看到 Gate 1 进度、L4/L5 fact edge 数、source path 覆盖、observation 规模和下一步 P0。
- 可入图关系与 lead / observation / unknown 明确分层，不能混淆。
- source monitoring、data-depth workbench、quality issue 和 next action queue 都能从 research-pack JSON 追溯。
- 与上一版对比时必须使用另一个 research-pack 目录，而不是硬编码指标。
- 页面可从本地 `file://` 打开，不依赖服务器。

静态 HTML 是研究报告和验收读物，不是交互式正式前端。正式前端应拆成独立模块：

```text
CompanyGraph
ComponentGraph
EvidenceDrawer
UnknownMapPanel
SourceHealthPanel
ChangeEventTimeline
```

v0.2 的正式预览工作台不引入 React，采用全量 TypeScript + Canvas。DOM 只承载 shell 和右侧面板，图谱布局、hit-testing、缩放、证据格式化、unknown 分类、source health 计算都应放在独立 TypeScript 模块中。

`apps/research-preview` 是交互式工作台入口：

```bash
pnpm cli workbench export --company nvidia --out reports/nvidia-workbench.json
pnpm research-preview
```

自动打开形态使用 URL 参数：

```text
http://127.0.0.1:4173/apps/research-preview/index.html?report=/reports/nvidia-workbench.json
```

这个入口和静态 HTML 的区别是：静态 HTML 展示一份 `research-pack` 的审阅报告；工作台消费 truth-store 导出的 `WorkbenchModel`，其中包含 chain segments、claims、evidences、unknowns、source health 和 changes。未来 Apple / Tesla / Microsoft / SpaceX 的深度研究应优先复用这些契约，而不是复制公司专用 HTML 脚本。

## 下一步

1. 保持 `scripts/render-research-html.mjs` 只消费 `research-pack`，禁止恢复早期 preview JSON 兼容入口。
2. 继续收紧 `WorkbenchModel`，让 CLI、工作台和未来只读 API 共用一份契约。
3. 增加 source monitor 事件视图：`DOCUMENT_NEW / DOCUMENT_CHANGED / EDGE_ADDED / EDGE_UPDATED / SOURCE_FAILED`。
4. 当 Phase 2 数据覆盖扩大后，把一级边扩展成真正的 n-tier chain，而不是在没有证据时用推断填满图。
