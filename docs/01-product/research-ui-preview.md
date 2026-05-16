# Research UI Preview — 研究前端原型

本文记录 MVP 阶段 HTML 预览页的产品方向。它不是正式前端技术方案，而是避免输出层偏离 SupplyStrata 核心：**全球供应链追踪的第一屏必须是 chain graph，而不是摘要卡片列表**。

当前静态预览由 `scripts/render-research-html.mjs` 从 `preview report` JSON 生成：

```bash
pnpm --silent cli preview report nvidia --format json --lang zh > reports/latest-nvidia-research.json
node scripts/render-research-html.mjs reports/latest-nvidia-research.json reports/latest-nvidia-research.html
```

## 产品判断

参考公开供应链可视化产品的共同特征后，SupplyStrata 前端应优先表达四件事：

1. 多层供应链结构：谁连接谁、属于第几层、组件是什么。
2. 证据强度：哪些边是官方披露的 Level 4/5，哪些只是观测信号。
3. 变化监控：数据源什么时候检查、文档是否变化、哪些边受影响。
4. 未知边界：哪些关键问题公开来源不能回答，下一步最该查什么。

因此当前 HTML 原型采用：

- 主视图：`Chain Graph`
- 右侧：`Evidence Card` + `Unknown Boundary`
- 下方：source cards、edge table、official signal table

卡片可以存在，但只能服务链路图；不能让卡片列表替代供应链本体。

## 视觉语义

```text
实线边
  Level 4/5，可进入事实图谱的直接关系。

虚线边
  observation / signal，不直接生成公司级供应链边。

右侧橙色 unknown boundary
  合同、价格、采购量、具体设施、物流路线等公开来源暂不能确认的边界。

颜色
  foundry / memory / manufacturing services 等组件类别。
```

这个约束很重要：例如 ASML 的官方披露可以作为 semiconductor capacity signal，但不能在没有直接证据时画成 `NVIDIA -> ASML` 或 `ASML -> TSMC` 的供应链事实边。

## MVP 静态页验收

静态 HTML 页至少要满足：

- 第一屏可看到公司 anchor、一级供应商节点、边和 evidence/unknown 侧栏。
- 每条可入图边都有明确关系、组件、evidence level、confidence 和原文片段。
- official signal 与 graph edge 视觉上分离，不能混淆。
- unknown map 不为空，并且解释为什么未知。
- 页面可从本地 `file://` 打开，不依赖服务器。

当前静态页是临时交付物。正式前端应拆成独立模块：

```text
CompanyGraph
ComponentGraph
EvidenceDrawer
UnknownMapPanel
SourceHealthPanel
ChangeEventTimeline
```

v0.2 的正式预览工作台不引入 React，采用全量 TypeScript + Canvas。DOM 只承载 shell 和右侧面板，图谱布局、hit-testing、缩放、证据格式化、unknown 分类、source health 计算都应放在独立 TypeScript 模块中。

## 下一步

1. 把当前 HTML 原型沉淀成 `apps/research-preview`，避免 `scripts/render-research-html.mjs` 继续膨胀。
2. 用同一份 JSON contract 支持 CLI、静态 HTML 和未来只读 API。
3. 增加 source monitor 事件视图：`DOCUMENT_NEW / DOCUMENT_CHANGED / EDGE_ADDED / EDGE_UPDATED / SOURCE_FAILED`。
4. 当 Phase 2 数据覆盖扩大后，把一级边扩展成真正的 n-tier chain，而不是在没有证据时用推断填满图。
