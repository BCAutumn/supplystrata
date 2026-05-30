# Implementation Plan (Rolling)

最后更新: 2026-05-30
当前位置: **A-H 全部完成 — 待并入 `docs/` 或删除**

> 这是滚动工作笔记，不是规范。决策 / 边界 / 完成口径以 `docs/` 为准。
> 每完成一 Phase: 压缩当前 → 细化下一。
> 不在本文件写代码。
> **A-H 全部完成**：本文件已无活跃 Phase，按约定应把决策日志收敛进 `docs/10-decisions/decisions.md` 后删除本文件（见末尾"收尾"）。

---

## 路线图概览

| Phase | 目标                                                  | 状态        |
| ----- | ----------------------------------------------------- | ----------- |
| A     | 锚定架构不变式 (llm-helpers / dep-check / agent 占位) | **done**    |
| B     | MCP 接入面 (`apps/mcp`; stdio + StreamableHTTP)       | **done**    |
| C     | 全球身份覆盖 + MCP CLI 接 DB-backed runtime           | **done**    |
| D     | 动态 profile + Agent 参考实现                         | **done**    |
| E     | SCBOM v0.x 开放交换格式 + workbench-export 对齐       | **done**    |
| F     | 中立 SCBOM 可视化 (headless core + Web Components)    | **done**    |
| G     | Community-pack release pipeline                       | **done**    |
| H     | Viewer 打磨（布局硬伤 + evidence-first 落地 + 默认主题 + theming surface） | **done**    |

---

## 工作约定 (贯穿所有 Phase)

1. **每 PR 三件套**：加新边界 + 迁移老代码 + 删除旧路径。**不留 shim / TODO / 死代码**。
2. **每条不变式必有 CI 机械化拦截**（dep-check / lint / contract test 之一），不靠人工审查记忆。
3. **测试矩阵不能只增不减**；迁移代码 = 迁移测试，不允许 skip 后补。
4. **每 Phase 入口工作区必须 git clean**。
5. **指挥模式**：commander (Claude) 不修改代码；implementer (你) 不私自改架构边界。
6. Phase 完成后由 commander 更新本文件。

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
- 2026-05-29 — **DQ25** (Phase F): 本地 viewer 首屏改 **server-side 预取**——Node server 先读 MCP SCBOM resource 再把 JSON 内联进 HTML，浏览器不做跨端口首屏 fetch（链路更稳）；MCP HTTP CORS 只允许本地 origin 并暴露 `mcp-session-id`，不为方便默认开放跨域
- 2026-05-29 — **Phase F done**：`@supplystrata/web` 中立只读 SCBOM viewer（L0 headless `createScbomView` + Lit 组件 evidence-view/unknown-map/supply-chain-graph）；`pnpm web` 本地 viewer + `pnpm agent --html-artifact` 自包含报告；7 条边界机械化；修 CORS / 首屏空白 / Lit 属性派生三问题。**已知遗留**：(1) 完整 `test:e2e` 因本地 DB 既有 evidence ref 数据质量问题未全绿，转 Phase G G0 跟踪；(2) 默认观感（环形布局重叠/标签压字、graph 抢主屏、evidence/unknown 裸列表）+ theming surface 补全，转 Phase H（DQ26）
- 2026-05-29 — **DQ26** (Phase F 复盘): 前端"丑"处理走中间路径——修布局硬伤（消费者改不了）+ 落实 evidence-first 主视图 + 克制中性默认主题 + theming surface 文档化；**不做产品级美观 UI**（与 #8/DQ21 中立定位冲突）；视觉品味交消费者。排到 **Phase H**（Phase G 之后）
- 2026-05-29 — **DQG1** (Phase G): pack canonical 格式 = `scbom-jsonl`（manifest.json + 一/多个 SCBOM JSONL；每行一份 `@scbom/spec` 校验过的 SCBOM document）；Parquet/SQLite 等为非 canonical 派生，v0.x 不做
- 2026-05-29 — **DQG2** (Phase G): exporter 只导 publish-eligible 事实；**dirty/dangling evidence ref 在导出层硬 gate**（commit `a18b900`），不进公开包；exporter 不读写 Postgres
- 2026-05-29 — **DQG3** (Phase G): 完整性 = 每文件 sha256 + `SHA256SUMS`（manifest `integrity.algorithm=sha256` + 每文件 sha256/bytes/document 计数）；加密签名 v0.x 未做（延后）；`generated_at` 可手动输入以支持可复现重跑
- 2026-05-29 — **DQG4** (Phase G): loader 把 pack 作 read-only baseline 加载进 MCP（commit `0547b18`）；**本地/上游 SCBOM 永远覆盖 pack baseline**（commit `c215bd5`）；pack 不回写
- 2026-05-29 — **Phase G done**：`@supplystrata/community-pack` 落地——canonical `scbom-jsonl` + 自描述 manifest（DQG1）；exporter 硬 gate dirty evidence ref（DQG2，顺带修 Phase F G0 遗留，完整 e2e 恢复全绿）；MCP pack warm-start loader + upstream-wins 冲突策略（DQG3/DQG4）；GitHub Actions 定期/手动 publish 管线 + `pack:checksums`（SHA256SUMS）+ 可复现 `generated_at`；warm-start e2e（build → MCP HTTP warm-start → web viewer 预取渲染 → re-verify 覆盖 baseline）
- 2026-05-30 — **Phase H done**：viewer 打磨收口——graph 布局换 forceatlas2/noverlap（箭头在节点外）；evidence-first 作落地主视图、graph 退概览；中性可关默认主题 + 完整 theming surface（CSS vars / `::part()` / slots / `unstyled`，含 SVG 兜底层换肤变量）并文档化；`web-theming-contract` 契约锁 + `/theme-demo` 双主题 + `web-custom-theme` e2e；修正 landing-order 测试只锁正常 viewer、H1 墙钟阈值改全套稳定回归哨兵。**A-H 实现侧全部收口**

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

- **Commits**: `04c35fa`、`97db405`（PLAN/decision）+ `d0d096d Add SCBOM export surface`（实现，已提交）
- **Net effect**: SCBOM 从独立 spec repo 接进本仓库且**未扩成新 REST surface**。接入 pinned git dep `@scbom/spec`（canonical `BCAutumn/scbom-spec#v0.0.1`，非 DQ5 原写的 `supplystrata/scbom-spec`）；`workbench-export` 新增 `scbom-mapper.ts`（WorkbenchModel → ScbomDocument）+ `scbom-validator.ts`（JSON Schema + conformance：重复 id / dangling ref / relationship subject·object 必须 entity / source_refs 必须 evidence）；MCP resource `supplystrata://scbom/company/{lei}` 经 `api-orchestration.getCompanyScbomDocument`，fixture + db 两 runtime 一致
- **CI 边界**: 私有字段泄漏 meta-test（无 `supplystrata_*` 等）；`workbench-to-scbom` + resource contract + conformance e2e + db runtime resource e2e；`smoke:mcp` / `smoke:mcp:http` / `smoke:mcp:db` 全覆盖 SCBOM resource
- **额外修复**: validator 从"仅查引用存在"升级为"按 conformance 校验引用对象类型"；SCBOM route 从 API route registry 迁到 `MCP_RESOURCE_ROUTES`（DQ19），堵住意外暴露旧 REST/OpenAPI 路径
- **验证全绿**: type-check / unit / e2e / build / dep-check / lint / format:check / smoke:mcp / smoke:mcp:http / smoke:mcp:db / smoke:local
- **偏离**: scbom-spec canonical remote 为 `BCAutumn/scbom-spec`（DQ5 原写 org 名待校正，已在决策日志注明）

### Phase F · 中立 SCBOM 可视化（done · 2026-05-29）

- **Commits**: `c2fec99`、`4aa5fba`、`b46d304`、`871224b`、`828347d`、`c65375e`、`ba41735`、`62665e5`、`595f348`、`ce5b963`
- **Net effect**: `@supplystrata/web` 中立只读 SCBOM viewer 落地。F1 包骨架（ESM + browser IIFE，禁 React/Vue/Svelte，gzip size gate，headless no-DOM 边界测试）；F2 L0 headless `createScbomView()`（SCBOM → viewer DTO，保留 evidence trail / unknown / observation，只把 relationship 画进 graph）；F3-F4 Lit 组件 `scbom-evidence-view` / `scbom-unknown-map` / `scbom-supply-chain-graph`（CSS vars/parts 主题，证据优先，unknown 一等）；F5 浏览器 MCP HTTP read client（默认 `127.0.0.1`，只读 SCBOM resource，不调 write tool，远程 opt-in）；F6 `pnpm web` 本地 viewer + `pnpm agent --html-artifact` 自包含 HTML 报告
- **CI 边界**: `packages/web` ⇏ React/Vue/Svelte；L0 headless ⇏ DOM/网络；web ⇏ 被核心生产代码反向依赖（可移除）；viewer ⇏ MCP write tools；graph 不把 unknown/observation 画成 relationship edge；browser MCP client 默认 localhost 只读；bundle gzip gate
- **关键修复**: (1) MCP HTTP CORS 原未给本地 viewer 返回 `Access-Control-Allow-Origin`，改成只允许本地 origin 并暴露 `mcp-session-id`；(2) 首屏空白——viewer 改为 Node server 先读 MCP resource 再把 SCBOM JSON 内联进 HTML，浏览器不再做跨端口首屏 fetch；(3) Lit 属性赋值未稳定触发 view 派生（0 entities/relationships），加显式 `loadScbomDocument()`、等 custom element 定义完再加载
- **验证全绿**: type-check / lint / format:check / build / unit / smoke:mcp:http；本机实跑 MCP HTTP `:7474/mcp` + viewer `:8787`
- **偏离/已知遗留**: `pnpm test:e2e` 撞到**本地 DB 既有 evidence ref 数据质量问题**（非 web 代码问题）——前端相关 e2e 用例已单独通过，但完整 e2e 未全绿（已于 Phase G G0 修复）；默认观感打磨 + theming surface 补全转 Phase H（DQ26）

### Phase G · Community-pack 发布管线（done · 2026-05-29）

- **Commits**: `a18b900`（G0 gate dirty ref）、`667a19a`（G1 manifest 格式）、`c959721`（G2 exporter CLI）、`0547b18`（G3 loader）、`c215bd5`（G4 upstream-wins）、`456721d`（G5 publish workflow）、`41aff7b`（G6 warm-start e2e + docs）
- **Net effect**: `@supplystrata/community-pack` 落地。canonical 格式 `scbom-jsonl`（manifest.json + 每行一份 `@scbom/spec` 校验过的 SCBOM document，DQG1）；exporter 选 publish-eligible 事实 → SCBOM documents，**硬 gate dirty/dangling evidence ref**（DQG2，顺带清掉 Phase F G0 遗留，完整 `test:e2e` 恢复全绿）；MCP `--pack=` warm-start loader 把 pack 作 read-only baseline 加载，**本地/上游永远覆盖 pack baseline**（DQG4）；GitHub Actions 定期/手动 publish 管线 + `pack:checksums`（`SHA256SUMS`）+ 手动 `generated_at` 可复现重跑（DQG3）
- **CI 边界**: pack 建立在 SCBOM 上、零私有字段（manifest 不带 claim state/risk/cache）；exporter ⇏ 读写 Postgres；dirty ref 导出层硬 gate；loader baseline 非 truth、可被 upstream 覆盖、不回写 pack；publish workflow / checksum 脚本有单测
- **验证全绿**: type-check / lint / dep-check / changed-file prettier / build / unit（116 files / 567 tests）/ e2e（7 files / 9 tests，Docker 路径全绿）
- **偏离**: 加密签名（minisign/cosign）v0.x 未做，仅 sha256 + SHA256SUMS（DQG3 接受）；全量 `format:check` 未跑（避免误格式化未提交的 PLAN，本轮改动文件 prettier 已过）

### Phase H · Viewer 打磨（done · 2026-05-30）

- **Commits**: `0f9e8be`（H1 graph 布局）、`9f97f64`（H2 evidence-first）、`469e3e0`（H3 中性主题控件）、`99d27aa`（H4 theming surface 文档）、`f3ab82f`（H5 theme demo + e2e）、`fd3181d`（箭头在节点外）
- **Net effect**: Phase F 两个遗留解除。H1 graph 布局换 forceatlas2/noverlap + 箭头在节点外，告别环形堆叠/标签压字；H2 evidence-first 作落地主视图、graph 退回概览（DQ23 落实）；H3 中性可关默认主题（unstyled-but-clean）；H4 补全并文档化 theming surface（CSS vars / `::part()` / slots / `unstyled`，含 graph SVG 兜底层换肤变量）；H5 `/theme-demo` 同一 SCBOM 默认 vs custom host theme
- **CI 边界**: `web-theming-contract` 契约锁（删 part/var 即 fail）；`web-custom-theme` e2e 验证仅 CSS vars 即可换肤；landing-order 测试只锁正常 viewer、不误扫 theme demo；`packages/web` 仍零 framework 依赖、bundle 预算不变、L0 headless 边界不破
- **验证全绿**: build / type-check / lint / dep-check / changed-file prettier / unit（119 files / 575 tests）/ e2e（8 files / 10 tests）；浏览器实测 `/theme-demo` custom CSS vars 生效、evidence/unknown/graph 正常渲染
- **偏离**: H1 墙钟性能阈值改为 full-suite 稳定回归哨兵（避免单测墙钟坏味道）；无其它

---

## 收尾（A-H 全部完成）

路线图 A-H 已全部 done，实现侧收口。本文件是**滚动工作笔记**，按开头约定，活跃 Phase 清零后应处置如下（需 commander/用户拍板）：

1. **决策日志归宪**：本文件"决策日志"是 day-to-day 记录；其中已沉淀为长期约束的项（如 #15 amendment 的 headless 分层、DQ21 中立化、DQ24 Lit、DQG1 pack 格式等）应反映进 `docs/10-decisions/decisions.md`（宪法）。归并后本文件的日志即可弃。
2. **删除本文件**：归并完成后删除 `docs/plan/PLAN.md`，避免与 `docs/` 双源漂移。
3. **docs 状态标签清理**：确认 `docs/02-architecture/module-design.md` 等处 `web` / `community-pack` / `agent` 已去【新增,目标】标签（各 Phase 清理 checklist 应已覆盖，收尾时复核一遍）。

> 在用户确认前不删除本文件。
