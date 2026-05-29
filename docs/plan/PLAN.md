# Implementation Plan (Rolling)

最后更新: 2026-05-29
当前位置: **Phase F · in_progress**

> 这是滚动工作笔记，不是规范。决策 / 边界 / 完成口径以 `docs/` 为准。
> 每完成一 Phase: 压缩当前 → 细化下一。
> 不在本文件写代码。
> Phase G 全部完成后并入 `docs/` 或删除。

---

## 路线图概览

| Phase | 目标                                                  | 状态        |
| ----- | ----------------------------------------------------- | ----------- |
| A     | 锚定架构不变式 (llm-helpers / dep-check / agent 占位) | **done**    |
| B     | MCP 接入面 (`apps/mcp`; stdio + StreamableHTTP)       | **done**    |
| C     | 全球身份覆盖 + MCP CLI 接 DB-backed runtime           | **done**    |
| D     | 动态 profile + Agent 参考实现                         | **done**    |
| E     | SCBOM v0.x 开放交换格式 + workbench-export 对齐       | **done**    |
| F     | 中立 SCBOM 可视化 (headless core + Web Components)    | in_progress |
| G     | Community-pack release pipeline                       | not_started |

---

## 工作约定 (贯穿所有 Phase)

1. **每 PR 三件套**：加新边界 + 迁移老代码 + 删除旧路径。**不留 shim / TODO / 死代码**。
2. **每条不变式必有 CI 机械化拦截**（dep-check / lint / contract test 之一），不靠人工审查记忆。
3. **测试矩阵不能只增不减**；迁移代码 = 迁移测试，不允许 skip 后补。
4. **每 Phase 入口工作区必须 git clean**。
5. **指挥模式**：commander (Claude) 不修改代码；implementer (你) 不私自改架构边界。
6. Phase 完成后由 commander 更新本文件。

---

## Phase F · 中立 SCBOM 可视化（headless core + Web Components）[当前]

> 大白话：做一个能渲染**任何 SCBOM 文档**的中立可视化层——本地实例一跑就有 UI 看自己的数据，agent 能把图当报告产出，别人也能把它嵌进自己的 React/Vue app 并深度换肤定制。证据优先，不是先甩一张毛球图。

**目标**：交付 SupplyStrata 第一个**可视化对外脸面**。它是一个**中立的 SCBOM viewer**（消费任何符合 SCBOM 的文档，不绑定 SupplyStrata），分两层：**L0 headless core**（纯 TS、零 DOM、零框架，把 SCBOM 规范化成可渲染的 view model）+ **L1 themeable Web Components**（开箱即用、可换肤）。

完成后能证明三件事：数据不仅机器能读（SCBOM/MCP），人也能直接看（本地 UI + agent 产出图）；可视化与核心彻底解耦（删 `packages/web` 核心照常工作）；第三方能**自由集成**——快速嵌的人用 L1，要把图融进自己 React/Vue 设计系统的人用 L0 自画。

### 产品形态：B + C 为主，A 为副产物（DQ20）

- **B 本地自带 UI**：实例 `--serve-web` 起 localhost 页面，跑实例的人立即能浏览自己的数据（datasette / Obsidian 借鉴）。
- **C agent 可视化 artifact**：agent / CLI 产出**自包含 HTML**（内联 IIFE + 内联 SCBOM），离线可渲染，人看 agent 的产出。
- **A 嵌入式组件**：`<script>` + 自定义标签嵌别人页面——是 L1 的自然副产物，不单列为目标。

### 分层架构：headless core (L0) + themeable Web Components (L1)（DQ22）

| 层 | 内容 | 给谁 | 边界 |
| -- | ---- | ---- | ---- |
| **L0 headless core** | SCBOM document → 规范化 `ScbomView`（entities / relationships / evidence index / unknowns / changes）+ graph 布局 | 想用自己 React/Vue 组件 + 设计系统**完全自画 UI** 的开发者 | 纯 TS、**零 DOM、零网络、零框架**；本次真正的资产 |
| **L1 Web Components** | `<scbom-evidence-view>`（主）/ `<scbom-unknown-map>` / `<scbom-supply-chain-graph>`（概览） | 想快速嵌、不想自己画、或非 React 场景 | custom element + Shadow DOM；themeable |
| **L2 框架 wrapper** | `@supplystrata/web-react` / `-vue` | 想要地道 React/Vue DX | **本期不做**（DQ22）：WC 原生可在 React/Vue 用；深度定制走 L0 |

**关键认知**：React/Vue 集成不靠我们包里塞 React/Vue（那会破 #15），而靠 (1) Web Components 本就能在 React/Vue 里用；(2) L0 headless core 把数据直接交给开发者自画。`packages/web` 自身**永远不把 React/Vue 作运行/构建依赖**。这是 #15 的细化，不是推翻。

### 关键技术决策（已锁定）

- **DQ6**：图渲染用 **Sigma.js v3 + graphology**（WebGL；实测约 240KB min ≈ 75KB gz，在预算内），不用 Cytoscape/自写 canvas。graph 仅概览入口（DQ23），故不追更轻方案。
- **DQ24 L1 用 Lit**：Web Component 层用 **Lit**（~5.5KB gz，Google 维护）写,不手写 base class。Lit 产出标准 custom element，可在 React/Vue 直接用，**不破 #15/DQ22**（Lit 不是 React/Vue 那类框架，是 WC authoring lib）；Shadow DOM + `static styles` + CSS 变量换肤内置，正好承载 DQ23 换肤。dep-check 允许 Lit，仍禁 React/Vue/Svelte。
- **DQ21 中立化**：viewer 渲染任何 SCBOM，组件用 `scbom-*` 前缀（非 `supplystrata-*`）信号中立；先放本 repo `packages/web`，接口按中立设计，将来抽独立 repo 零成本。
- **DQ23 evidence-first UX**：主视图是 `<scbom-evidence-view>`（证据表/时间线：cite text + source URL + evidence_level + validity）；graph 是**概览入口**不是主屏；unknown 一等展示。
- **DQ23 换肤**：Shadow DOM 封装 + CSS 变量（`--scbom-*`）+ `::part()` + slot 暴露换肤点（Lit 原生支持）。
- **只读**：viewer **不暴露任何 write tool**；只渲染，不触发 source check / review / session（写仍只走 agent/CLI 经 MCP confirmation gate）。
- **双形态产物**：IIFE bundle（`<script>` 直接用）+ npm ESM（headless core + 构建链引入）。
- **预算口径**：size gate 判 **gzipped**（≤ 200KB），不拿 minified 数字判（两者差约 3 倍，易误判）。F1 实测 gz 值入门禁。

### PR 切分

| PR  | 标题                                            | 范围                                                                                                                                                                                                          | 验收                                                                                                       | 清理判据                                                                                            |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| F1  | `packages/web` skeleton + L0 类型 + dual-build + 尺寸门禁 | 新建 `packages/web`；加 `lit` 依赖（DQ24）；定义 L0 `ScbomView` 类型；ESM（headless entry）+ IIFE（components entry）双产物；CI bundle size gate（实测 **gzipped** ≤ 200KB IIFE）；占位 no-op                     | `pnpm build` 产出双产物；size gate 超预算 fail（故意塞大依赖验证，判 gz 值）；headless entry 可被纯 TS import | 不依赖 React/Vue/Svelte（dep-check + package.json；Lit 允许）；headless entry 零 DOM/网络 import       |
| F2  | L0 headless core：SCBOM → ScbomView + 布局（纯函数） | `scbom-to-view.ts`：SCBOM document → `ScbomView`；relationship → 其 evidence trail 索引（evidence-first）；unknown 一等 list；change list；graphology 概览布局；evidence_level → 视觉权重 vocabulary（不硬编） | 单测：SCBOM fixture → ScbomView；observation/unknown 不变成 relationship；dangling ref 安全降级；布局确定性 | 纯函数、零 DOM、零网络；输入 SCBOM 不是 WorkbenchModel；无 SupplyStrata 私有概念；**这是 React/Vue 消费层**，导出稳定 |
| F3  | L1 Web Component base（Lit）+ 换肤基础设施       | 用 Lit `LitElement` 写 base + Shadow DOM；换肤经 CSS 变量 + `::part()` + slot；`@property` attr → L0 → render 生命周期；`<scbom-ping>` 验证换肤钩子                                                            | base element 在纯 HTML 注册；CSS 变量覆盖生效；`::part()` 可定位；slot 内容渲染                            | 换肤 surface 文档化；Lit 之外无框架；产出标准 custom element（React/Vue 可直接用）                  |
| F4  | evidence-first 主组件 `<scbom-evidence-view>` + `<scbom-unknown-map>` | `<scbom-evidence-view>`：**主视图**——relationship 证据表/时间线（cite + source URL + evidence_level + validity）；`<scbom-unknown-map>`：unknown 一等展示；两者消费 L0、只读                                  | 渲染单测（happy-dom）；unknown 一等语气（非"缺失/错误"）；evidence_level 配色合 evidence-model.md；deprecated 区分 | 只读、无写入入口；消费 L0 view model；无共享可变全局态                                               |
| F5  | `<scbom-supply-chain-graph>` 概览图 + 浏览器 MCP HTTP client | Sigma.js v3 概览图（入口，非主屏；点节点下钻到 evidence-view）；observation/unknown 不画成 relationship edge；`mcp-http-client.ts` 浏览器侧连 `StreamableHTTPServerTransport` 调 `supplystrata://scbom/company/{lei}` 取 SCBOM，默认 `127.0.0.1` | graph 渲染 NVIDIA SCBOM fixture；mock-transport 取数单测；取数失败显式错误态；远程/跨域需显式配置          | client 只调 read resource，不调 write tool；graph 只读；默认 localhost                              |
| F6  | 本地 viewer app (B) + agent artifact (C) + 尺寸 e2e + docs + #15 amendment | `apps/web` 薄本地 viewer（CLI 起 localhost 服 L1 bundle 指向本机 MCP，形态 B）；agent/CLI 产出自包含 HTML（内联 IIFE + 内联 SCBOM，离线渲染，形态 C）；size e2e；更新 docs（module-design 分层去标签、quickstart 嵌入 + headless React/Vue 片段）、decisions.md #15 amendment | 本地 viewer 连本机 MCP 渲染出图；agent HTML artifact 离线渲染；size e2e 绿；docs 一致                       | app 薄壳无业务规则；module-design web 行去标签；quickstart 有 embed + headless 片段；decisions #15 已 amend；removable；无 TODO/shim |

### 执行顺序

```
F1 (skeleton + L0 类型 + dual-build + size gate) → F2 (L0 headless core) → F3 (WC base + 换肤) ┐
                                                                                                ├→ F6 (本地 viewer + agent artifact + e2e + docs) → Phase F DONE
                                       F4 (evidence-first 主组件) ‖ F5 (graph 概览 + MCP client) ┘
```

- F1 → F2（headless）→ F3（WC base）线性
- F4、F5 依赖 F2（ScbomView）/ F3（base class），可在 F3 后并行
- F6 最后（合流 B/C 形态 + docs + #15 amendment）

### 清理 checklist（Phase F 合并前必须勾完）

- [ ] `packages/web` 自身不依赖 React/Vue/Svelte（dep-check + package.json 检查；Lit 作为 WC authoring lib 允许）
- [ ] L0 headless entry 零 DOM / 零网络 import（meta-test：扫 L0 入口不引 DOM/fetch）
- [ ] IIFE + ESM 双产物；IIFE ≤ 200KB gzipped（CI size gate，故意超标验证拦截）
- [ ] L0 `scbom-to-view` 纯函数、零 DOM、零网络；输入 SCBOM 不是 WorkbenchModel；导出稳定（React/Vue 消费契约）
- [ ] observation / unknown 不被画成 relationship（结构上而非样式上区分）
- [ ] 主视图是 evidence-view（证据优先）；graph 是概览入口非主屏；unknown 一等
- [ ] evidence_level 配色与 `docs/03-data-model/evidence-model.md` 约定一致
- [ ] 换肤经 CSS 变量 + `::part()` + slot，已文档化
- [ ] viewer **只读**：无任何 write tool 入口；MCP HTTP client 只调 read resource
- [ ] 浏览器 MCP client 默认 `127.0.0.1`；远程/跨域需显式配置 + README 风险标注
- [ ] 本地 viewer app (B) 连本机 MCP 渲染出图；agent HTML artifact (C) 离线可渲染
- [ ] 删除 `packages/web` + `apps/web` 后核心 build/test 全绿（removable meta-test）
- [ ] `docs/02-architecture/module-design.md` web 分层去【新增,目标】标签
- [ ] `docs/06-development/quickstart.md` 加 embed 片段 + headless React/Vue 使用片段
- [ ] `docs/10-decisions/decisions.md` #15 amend（补 headless 分层 + 中立 viewer 形态）
- [ ] 无 `// TODO` / `// FIXME` / shim 代码
- [ ] type-check / lint / unit / dep-check / build / format-check / e2e / smoke 全绿

### 风险点（命中即找 commander）

1. **`packages/web` 自身想引 React/Vue 作运行/构建依赖** — 头号风险。框架集成在**消费方**（用 WC 或 L0），不在我们包内。dep-check 拦截，也要警惕传递依赖。
2. **L0 headless core 偷引 DOM / fetch** — L0 一旦碰 DOM 或网络就丧失"框架无关 + 可测 + React/Vue 可消费"。meta-test 扫 L0 入口。
3. **bundle 体积失控** — Sigma + graphology 已占预算；任何顺手加的大依赖都可能爆 200KB。size gate 是硬门禁，超了砍功能/换依赖，不抬预算。
4. **组件直接读 WorkbenchModel / DB** — 只吃 SCBOM。出现"SCBOM 没这字段所以直接连 DB"的冲动时停——要么字段进 SCBOM（回 Phase E 讨论），要么不展示。
5. **viewer 出现写入入口** — 渲染层永远只读。"图上点一下触发 source check / approve"违反写入边界。
6. **observation 被画成关系线** — Phase E 同源风险的可视化版：observation/unknown 在视觉和数据结构上都不等于 relationship。
7. **graph 喧宾夺主** — UX 是 evidence-first；不要把毛球图做成主屏，证据/unknown 才是差异化。
8. **跨域取数默认放开** — 默认 localhost-only；远程 MCP endpoint 需显式配置自担风险，不为 demo 方便默认开 CORS。
9. **中立组件混入私有概念** — 组件名 `scbom-*`、只认 SCBOM；任何 SupplyStrata 私有字段/概念渗进渲染层都破坏中立化（DQ21）。

### 测试策略

**新增**：
- `tests/unit/web-scbom-to-view.test.ts` — L0 映射 + observation/unknown 不混入 relationship
- `tests/unit/web-headless-no-dom.test.ts` — meta-test：L0 入口零 DOM/网络 import
- `tests/unit/web-component-theming.test.ts` — Shadow DOM + CSS 变量 + `::part()` + slot 换肤
- `tests/unit/web-evidence-view.test.ts` — 主视图证据表/时间线渲染（happy-dom）
- `tests/unit/web-unknown-map.test.ts` — unknown 一等展示
- `tests/unit/web-graph-component.test.ts` — 概览图注册 + 渲染
- `tests/unit/web-mcp-http-client.test.ts` — mock transport 取数 + 错误态
- `tests/unit/web-readonly-boundary.test.ts` — meta-test：web 不引用任何 write tool
- `tests/unit/dep-boundary-web-removable.test.ts` — meta-test：web + apps/web 可整包删除
- `tests/e2e/web-local-viewer.test.ts` — 本地 viewer 连本机 MCP 渲染（B）
- `tests/e2e/web-agent-artifact.test.ts` — agent 自包含 HTML 离线渲染（C）+ bundle size

### Phase F 完成出口

```
出口判据 (single sentence):
  packages/web 以 L0 headless core（纯 TS 零 DOM，React/Vue 可直接消费自画 UI）+ L1 themeable
  Web Components（scbom-* 前缀、Shadow DOM + CSS 变量/::part()/slot 换肤）两层交付一个中立 SCBOM viewer；
  本地实例 --serve-web 起 localhost UI（B）、agent 能产出离线自包含 HTML 图（C）、第三方能 <script> 嵌入（A）；
  主视图 evidence-first（证据表/时间线 + unknown 一等，graph 作概览入口），只读无写入入口、
  IIFE ≤ 200KB gzipped、packages/web 自身零 framework 依赖；
  删除 packages/web + apps/web 后核心 build/test 仍全绿。
```

---

## Phase G · 概览（启动时再细化）

### Phase G · Community-pack

- **出口**：`pack-2026.QN.parquet` 发布；MCP server `--pack=` 加载校验 sha256
- **不变式**：community-pack 是 read-only baseline；任何写入只发生在本地 cache
- **依赖**：Phase B（MCP 启动参数）+ Phase E（SCBOM 格式作为 pack 内容）

---

## 决策日志（day-to-day；与 `docs/10-decisions/decisions.md` 区分：那里是宪法）

- 2026-05-28 — **DQ1**: llm-helpers 复用 ai-analysis 的 `provider-config` + `provider-openai-compatible`；加 `LlmProvider` interface 留 plugin 槽
- 2026-05-28 — **DQ2**: MCP 用官方 `@modelcontextprotocol/sdk@1.29.0`；Phase B 先做 stdio，HTTP 用 `StreamableHTTPServerTransport`
- 2026-05-28 — **DQ3**: `gleif` / `openfigi` / `wikidata` 各自独立 `packages/sources/` 包
- 2026-05-28 — **DQ4**: `research_session` 由 `packages/source-workflows` 管理；MCP 仅透传 session_id
- 2026-05-28 — **DQ5**: `scbom-spec` 独立 repo (`supplystrata/scbom-spec`)，从 v0.0.1 起独立版本号
- 2026-05-28 — **DQ6**: Web 图渲染用 Sigma.js v3
- 2026-05-28 — **DQ7**: Agent 参考实现采用三段式 `plan → fetch_via_mcp → synthesize`，单进程无状态机
- 2026-05-28 — **Phase A done**：llm-helpers 4 helper candidate-only + 校验链；dep-check 锁定 3 条边界
- 2026-05-28 — **DQ8** (Phase B)：orchestration 抽到 `packages/api-orchestration`（apps/api 与 apps/mcp 共用）
- 2026-05-28 — **DQ9** (Phase B): write tool 最终 gate 在 server 端（pending state + confirmation_token）
- 2026-05-28 — **DQ10** (Phase B): MCP annotation 严格用 spec 标准字段集，不发明 spec 外字段
- 2026-05-28 — **DQ11** (Phase B): MCP SDK 用官方 `@modelcontextprotocol/sdk@1.29.0`
- 2026-05-28 — **DQ12** (Phase B): B3 read surface 先复用现有 DTO；entity-scoped DTO 留后续
- 2026-05-28 — **DQ13** (Phase B): HTTP 用 `StreamableHTTPServerTransport`，endpoint `/mcp`，默认绑 `127.0.0.1`
- 2026-05-28 — **DQ14** (Phase B): B6 smoke 用 fixture server，不偷接 DB runtime（留 Phase C）
- 2026-05-28 — **Phase B done**：5 write tools 双层确认；HTTP transport；smoke:mcp；api-orchestration 抽出
- 2026-05-29 — **DQ15** (Phase C): UK/EU 当前 registry-only，返回 `cannot_conclude` 不杜撰 source target
- 2026-05-29 — **DQ16** (Phase C): seed-entities 改 dev fixture import 语义（非完全删命令）；迁到 `tests/fixtures/dev-entities/`
- 2026-05-29 — **DQ17** (Phase C): `traverse_chain` 接受 `company:ENT-...` scope；smoke:mcp:db 断言真实 envelope
- 2026-05-29 — **Phase C done**：GLEIF/OpenFIGI/Wikidata 全球身份；country routing；MCP `--runtime=db` 接通；seed 降级 dev fixture；非美国公司 e2e
- 2026-05-29 — **Phase D done**：profile 两层（anchor + runtime derived）；dynamic profile via llm-helper candidate-only 不持久化；session-scope 生命周期；`@supplystrata/agent` 三段式 core + `apps/agent-cli`；agent removable meta-test；citation/cannot_conclude 边界机械化
- 2026-05-29 — **DQ18** (Phase E): `scbom-spec` v0.0.1 的 canonical source 是独立 Git tag / GitHub Release；npm `@scbom/spec` 是可选分发渠道，不是 Phase E blocker。本 repo 通过 pinned git dependency 消费，版本锁定
- 2026-05-29 — **DQ19** (Phase E): SCBOM resource 不进 REST/OpenAPI route registry，改走独立 `MCP_RESOURCE_ROUTES`，避免意外暴露旧 REST surface（坚持 MCP-first #7）
- 2026-05-29 — **Phase E done**：`scbom-spec` 独立 repo (canonical `BCAutumn/scbom-spec`，非 DQ5 原写的 `supplystrata/scbom-spec`) 发布 v0.0.1；本 repo 经 pinned git dep `@scbom/spec` 消费；`workbench-export` 新增 scbom-mapper + scbom-validator（含引用对象类型 conformance 校验）；MCP resource `supplystrata://scbom/company/{lei}` 走 `MCP_RESOURCE_ROUTES` 不入 REST；私有字段泄漏 meta-test + conformance e2e + 三 smoke 覆盖
- 2026-05-29 — **DQ6 重申** (Phase F 启动): Web 图渲染锁定 Sigma.js v3；组件只吃 SCBOM、只读、零 framework 依赖、IIFE ≤ 200KB gzipped
- 2026-05-29 — **DQ20** (Phase F): 产品形态 B+C 为主——本地实例 `--serve-web` localhost UI（B）+ agent 产出自包含 HTML artifact（C）；嵌入式组件（A）作 L1 副产物，不单列目标
- 2026-05-29 — **DQ21** (Phase F): viewer 中立化——渲染任何 SCBOM document，组件用 `scbom-*` 前缀（非 `supplystrata-*`），先放本 repo `packages/web`、接口中立、将来可零成本抽独立 repo
- 2026-05-29 — **DQ22** (Phase F, #15 amendment): 分层 L0 headless core（纯 TS 零 DOM 零框架，React/Vue 深度定制入口）+ L1 themeable Web Components；`packages/web` 自身永不引 React/Vue 作运行/构建依赖；L2 框架 wrapper 本期不做（WC 原生可在 React/Vue 用）
- 2026-05-29 — **DQ23** (Phase F): UX evidence-first——主视图 `<scbom-evidence-view>`（证据表/时间线 + unknown 一等），graph 作概览入口非主屏；换肤经 Shadow DOM + CSS 变量 + `::part()` + slot
- 2026-05-29 — **DQ24** (Phase F): L1 用 **Lit**（~5.5KB gz）写 Web Components，不手写 base class；Lit 产出标准 custom element，不破 #15/DQ22（非 React/Vue 框架）；dep-check 允许 Lit、仍禁 React/Vue/Svelte。图渲染保留 DQ6 Sigma.js v3+graphology（~75KB gz 在预算内）。size gate 判 gzipped 不判 minified

---

## 何时找回 commander

- dep-check 拦不住的边界灰区
- MCP write tool 想跳过 server-side pending gate 或 confirmation_token 校验
- 想用 spec 外的 MCP annotation 字段
- identity bootstrap 信息不足但想"先写一个 placeholder entity"
- Wikidata 数据想直接 promote 到 fact edge
- profile derive 想 cache 跨 session
- agent loop 想绕过 MCP 直接 import db / pipeline / graph-builder
- agent 报告出现无 citation 的关系断言
- SCBOM schema 想加 SupplyStrata 私有字段 / 把 evidence_level 1-5 锁死进 schema
- **`packages/web` 自身想引 React/Vue 等 framework 作运行/构建依赖（Phase F 头号风险；集成应在消费方用 WC 或 L0）**
- **L0 headless core 想 import DOM / fetch（破坏框架无关与可测性）**
- **viewer SCBOM 缺字段时想直接连 DB / 读 WorkbenchModel 取数**
- **viewer 想加任何写入入口（点击触发 source check / approve 等）**
- **graph 想做成主屏（UX 应 evidence-first，graph 仅概览入口）**
- **bundle 体积想突破 200KB gzipped 预算上限（应砍功能/换依赖，不抬预算）**
- 出现"为了赶进度先 hack 一下事实写入"的诱惑
- artifact JSON 字节级 diff 不为空但想接受 diff
- 任何 PR 想留 `// TODO` / `// FIXME` / shim 代码
- 任何 PR 想 skip 老测试"后面再补"

---

## Phase 完成时本文件如何更新（commander 操作）

1. 把当前 Phase 详细段**压缩为 5-10 行摘要**（commits range + 关键变化 + 实际偏离）追加到"已完成 Phase 摘要"
2. 路线图概览状态更新（当前 Phase → `done`，下一 Phase → `in_progress`）
3. 把下一 Phase 概览扩展为详细段（PR 切分 / 执行顺序 / 清理 checklist / 风险点）
4. 决策日志追加本 Phase 期间产生的新决策
5. 必要时更新 `docs/` 中状态描述（去掉【新增，目标】标签等）

---

## 已完成 Phase 摘要

### Phase A · 锚定架构不变式 (done · 2026-05-28)

- **Commits**: `9eccfc2`、`fda9f96`
- **Net effect**: 4 个 candidate-only LLM helper 落地（disambiguate_entity / derive_dynamic_profile / suggest_source_targets / summarize_with_citations）；helper 全部带输入/输出/citation 校验 + disabled/deferred/invalid/provider_error 状态机；provider config + OpenAI-compatible adapter + local simulation 从 ai-analysis 迁出到 llm-helpers；ai-analysis 收缩为 audit + plan + validation
- **CI 边界**: dep-check 锁定 3 条 — fact/derived 写入路径 ⇏ llm-helpers；`packages/*` ⇏ agent；llm-helpers ⇏ ai-analysis
- **验证全绿**: type-check / lint / unit / dep-check / build / format:check / smoke:local / smoke:research / nvidia-fixture e2e
- **偏离**: 无

### Phase B · MCP 接入面 (done · 2026-05-28)

- **Commits**: `3e8f1f1`、`e989a5c`、`9f5e276`、`a35ecd7`（含 B1-B3）
- **Net effect**: `apps/mcp` 唯一对外 surface 雏形；`packages/api-orchestration` 抽出共享 use-case 层；6 read tools + 5 write tools；HTTP 用 `StreamableHTTPServerTransport`；stdio + http 双 transport CLI
- **Write 安全双层**: MCP spec 标准 annotation（review.approve/reject 标 `destructiveHint: true`）+ server-side pending state + 单次性 confirmation_token；两层都有 meta-test
- **关键边界**: smoke 用 fixture server，刻意不接 DB runtime（留 Phase C）
- **验证全绿**: release:check / smoke:mcp / smoke:local / smoke:research / unit / integration / e2e / type-check / lint / dep-check / build / format-check
- **偏离**: 增加第 5 个 write tool `confirm_research_session`；HTTP 用 StreamableHTTP 而非 deprecated SSE

### Phase C · 全球身份覆盖 + MCP DB runtime (done · 2026-05-29)

- **Commits**: `140e289`、`d629477`、`1a3d30a`、`dd5958f`、`161f87b`、`7865fc8`、`5d7d633`、`ee80152`、`3a6b6c5`
- **Net effect**: 全球公司查询不再绑美国上市公司或内置 profile。新增 `packages/sources/{gleif,openfigi,wikidata}`；universal identity bootstrap 遵守"默认 ambiguous 不猜测"，Wikidata 仅协作型 hint，disambiguate_entity 仍 candidate-only；`country-router` 路由 US→SEC/KR→DART/JP→EDINET/TW→TWSE/HK→HKEX stub，UK/EU registry-only 返回 `cannot_conclude`
- **DB runtime**: `apps/mcp --runtime=fixture|db`（默认 fixture，db 缺 POSTGRES_URL fail-fast）；Phase B 未接的 DB-backed execution 正式接通；`smoke:mcp:db` 新增
- **seed 清理**: entities/aliases → `tests/fixtures/dev-entities/`；CLI 改 dev fixture import；dep-check/unit 约束生产代码不反向依赖；`seeds/` 只剩 components.csv + README
- **E2E**: `global-listed-company.test.ts` 用 Docker Postgres + MCP stdio + db runtime 跑通 Samsung/TSMC/LVMH/AstraZeneca
- **验证全绿**: type-check / unit / e2e / smoke:mcp:db / build / dep-check / format:check
- **偏离**: seed CLI 未完全删（DQ16）；UK/EU 暂 registry-only（DQ15）

### Phase D · 动态 profile + Agent 参考实现 (done · 2026-05-29)

- **Commits**: `941aa94`、`a4fdb4f`、`61ddb82`、`faecadf`、`deca1f5`、`03b9278`
- **Net effect**: research target profile 拆两层（Layer A 内置 anchor / Layer B runtime derived，`profile=none` 可关）；anchor miss 才调 `llm-helpers.derive_dynamic_profile`，helper disabled 退回 generic，candidate-only 不写 fact/observation/unknown；derived profile session-scope，session 结束即清，无 DB 表/字段、无跨 session cache；`@supplystrata/agent` 升级为三段式 core（plan → fetch_via_mcp → synthesize），只走 MCP，缺 evidence/citation 返回 cannot_conclude；`apps/agent-cli` 入口（`pnpm agent` / `supplystrata-agent`），支持 stdio/http MCP + provider/model/base-url/api-key
- **CI 边界**: 核心 ⇏ agent；非 agent app ⇏ reference agent；agent ⇏ db/pipeline/graph-builder/review-store/source-workflows；dynamic profile 不持久化；citation 必来自 MCP evidence refs；agent removable meta-test（删 agent + agent-cli 后核心全绿）
- **验证全绿**: type-check / lint / format:check / build / dep-check / unit / e2e / smoke:mcp / smoke:mcp:db / smoke:local / smoke:research；实跑 `pnpm agent --company NVIDIA --provider none --mcp-runtime fixture`
- **偏离/额外修复**: CLI 对 `anthropic`（当前 bridge 是 OpenAI-compatible）fail-fast；fixture vs db runtime MCP envelope 形状差异在 agent core 做窄兼容（缺关键字段仍报错）；补 `pnpm agent` 本地入口（workspace bin 不能直接 `pnpm --filter exec`）

### Phase E · SCBOM v0.x 开放交换格式 (done · 2026-05-29)

- **Commits**: `04c35fa`、`97db405`（PLAN/decision）+ SCBOM 实现改动（待你 commit；见下方"进入 F 前"）
- **Net effect**: SCBOM 从独立 spec repo 接进本仓库且**未扩成新 REST surface**。接入 pinned git dep `@scbom/spec`（canonical `BCAutumn/scbom-spec#v0.0.1`，非 DQ5 原写的 `supplystrata/scbom-spec`）；`workbench-export` 新增 `scbom-mapper.ts`（WorkbenchModel → ScbomDocument）+ `scbom-validator.ts`（JSON Schema + conformance：重复 id / dangling ref / relationship subject·object 必须 entity / source_refs 必须 evidence）；MCP resource `supplystrata://scbom/company/{lei}` 经 `api-orchestration.getCompanyScbomDocument`，fixture + db 两 runtime 一致
- **CI 边界**: 私有字段泄漏 meta-test（无 `supplystrata_*` 等）；`workbench-to-scbom` + resource contract + conformance e2e + db runtime resource e2e；`smoke:mcp` / `smoke:mcp:http` / `smoke:mcp:db` 全覆盖 SCBOM resource
- **额外修复**: validator 从"仅查引用存在"升级为"按 conformance 校验引用对象类型"；SCBOM route 从 API route registry 迁到 `MCP_RESOURCE_ROUTES`（DQ19），堵住意外暴露旧 REST/OpenAPI 路径
- **验证全绿**: type-check / unit / e2e / build / dep-check / lint / format:check / smoke:mcp / smoke:mcp:http / smoke:mcp:db / smoke:local
- **偏离**: scbom-spec canonical remote 为 `BCAutumn/scbom-spec`（DQ5 原写 org 名待校正，已在决策日志注明）；Phase E 实现改动进入 F 前需单独 commit（见下）

> **进入 Phase F 前的硬前置**：Phase E 的实现改动（scbom-mapper / scbom-validator / MCP resource / 测试 / smoke / docs）当前仍在工作区**未提交**，只有 PLAN 与 decision 两个 commit 落地。按工作约定 #4（每 Phase 入口 git clean），请先把这批 SCBOM 改动作为 Phase E 的收尾 commit 提交，再开 F1。
