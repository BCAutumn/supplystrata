# Implementation Plan (Rolling)

最后更新: 2026-05-29
当前位置: **Phase D · in_progress**

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
| D     | 动态 profile + Agent 参考实现                         | in_progress |
| E     | SCBOM v0.x 独立 repo + workbench-export 对齐          | not_started |
| F     | Web 嵌入式组件 (Sigma.js + Web Components)            | not_started |
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

## Phase D · 动态 profile + Agent 参考实现 [当前]

**目标**：把研究 profile 从"内置 anchor"升级为"运行时按公司动态派生"，并交付第一个**完整可跑的 reference agent**——证明 SupplyStrata 作为"AI agent 的供应链数据源"这个产品定位真的成立。

两件相关但可分离的事：

1. **Dynamic profile** — 当公司不命中内置 anchor（`ai-compute-memory.v0` / `ev-battery-energy.v0`）时，调 `llm-helpers.derive_dynamic_profile` 从公开简介 / SIC / Wikidata description 派生 plan-context profile；**session-scope，不持久化**。
2. **Reference agent** — `@supplystrata/agent` 从占位包升级为可运行的三段式 agent（`plan → fetch_via_mcp → synthesize`，DQ7），用户自带 LLM provider，调本机 MCP，对任意全球上市公司输出可引用报告。

完成后能证明：删掉 `@supplystrata/agent` 整个包，核心仍完整可用（架构纯净）；同时装上它 + 配 LLM key，能端到端跑出一份带 citation 的供应链报告（产品形态成立）。

### 前置说明：profile 两层模型与 session 边界

`docs/03-data-model/intelligence-methodology.md` 已定义两层（与 Decision #12 一致）：

- **Layer A（anchor）**：内置两个 profile，gold path 验证用，不是产品覆盖范围；命中条件是精确匹配 entity/component scope。
- **Layer B（runtime derived）**：anchor 未命中时调 llm-helper 派生；**只活在单次 research session 内**，session 结束即销毁，不写 DB。

Phase D 第一次把 Layer B 真正接进运行链。session 生命周期由 `packages/source-workflows/src/research-session.ts` 管理（DQ4），MCP 仅透传 session_id。

`research-entity-bootstrap` 在 Phase C 已 universal 化；Phase D 在它之上加 profile derive，**不回退到 SEC-centric**。

### PR 切分

| PR  | 标题                                              | 范围                                                                                                                                                                                                                                            | 验收                                                                                                                                  | 清理判据                                                                                                                |
| --- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| D1  | Profile registry 两层化 (anchor vs derived)       | 重构 `packages/research-pack` profile system：把现有内置 profile 明确标为 Layer A anchor；新增 Layer B derived profile 的类型 + 接入点（先留 derive 接口，D2 接实现）；`profile=none` 可关闭两层                                                  | 单测覆盖 anchor 命中 / anchor 未命中走 derived 占位 / `profile=none` 全关；现有 anchor 行为零回归                                       | anchor 与 derived 在类型层清晰分离；现有 `ai-compute-memory.v0` / `ev-battery-energy.v0` fixture 测试不变                 |
| D2  | Dynamic profile derive via llm-helper             | 接 `llm-helpers.derive_dynamic_profile`：输入公司公开简介 / SIC / NAICS / Wikidata description → 输出 expected upstream components + source targets（plan-context only）；候选经输入/输出 schema 校验                                              | 单测：命中 anchor 不调 llm-helper；未命中调 helper 且返回 candidate；helper disabled 时退回 generic（仅国家路由 + SIC），不阻断流程     | derived profile 走 candidate-only 路径；不写 fact / observation / unknown；helper 调用经过 Phase A 的校验链               |
| D3  | Session-scope profile lifecycle                   | `packages/source-workflows/src/research-session.ts`：session_id 生命周期管理；derived profile 挂在 session 上，session 结束（成功/失败/超时）即销毁；MCP `start_research_session` / `poll_research_run` 透传 session_id + profile 摘要（不含原始 prompt） | 单测：profile 不写 DB（grep 验证无持久化路径）；session 结束后 profile 不可再取；并发 session 各自独立 profile                          | 无任何 `derived_profile` 表 / 字段；session store 只在内存或短 TTL；不跨 session 复用 profile（命中即找 commander）       |
| D4  | `@supplystrata/agent` 三段式 core                 | 占位包升级为可运行 agent：`plan(company, mcp_client)` → `fetch_via_mcp(plan)` → `synthesize(evidence)`；单进程无状态机（DQ7）；用户带 LLM provider（复用 llm-helpers provider config）；调本机 MCP（stdio 或 http）                                  | 单测用 mock MCP client + mock provider 跑通三段式；agent 不直接 import 任何 Layer 1-3 写事实层 package（dep-check）                     | agent 只通过 MCP 与核心交互；不 import `pipeline` / `graph-builder` / `db` 等；dep-check 验证 `packages/*` 仍 ⇏ agent    |
| D5  | `apps/agent-cli` 入口 + 可引用报告输出            | 薄 CLI：`supplystrata-agent --company <q> --provider <p> --model <m> [--mcp-transport stdio\|http]`；输出 markdown 报告（带 citation + cannot_conclude + source gap）；report 渲染复用 `render` / research-pack 约定                               | 端到端（mock provider）：对一家 fixture 公司产出结构化报告；citation 都能回链到 evidence ref；缺数据时显式 cannot_conclude 不杜撰       | CLI 是薄入口不含业务规则；报告不出现无 citation 的关系断言                                                                |
| D6  | E2E: agent removable + agent runs + docs          | (a) dep-check meta-test 证明删除 `packages/agent` + `apps/agent-cli` 后核心 build/test 全绿；(b) 新增 `tests/e2e/agent-report.test.ts`（mock provider，对全球公司跑出报告）；(c) 更新 docs：module-design 去 agent/web【新增,目标】标签、methodology profile 两层、quickstart agent 示例段 | agent removable 测试通过；agent report e2e 通过；docs 与实现一致                                                                       | `docs/02-architecture/module-design.md` agent 行去标签；`docs/03-data-model/intelligence-methodology.md` profile 两层与代码一致；quickstart 有 agent 段 |

### 执行顺序

```
D1 (profile 两层化) → D2 (derive via llm-helper) → D3 (session lifecycle) ┐
                                                                          ├→ D6 (e2e + docs) → Phase D DONE
D4 (agent core) → D5 (agent-cli) ────────────────────────────────────────┘
```

- D1 → D2 → D3 线性（profile 链）
- D4 → D5 线性（agent 链），可与 D1-D3 并行启动（agent 通过 MCP 解耦，不依赖 profile 内部实现）
- D6 最后（依赖 profile 链 + agent 链都稳定）

### 清理 checklist（Phase D 合并前必须勾完）

- [ ] profile registry 两层清晰分离；anchor 行为零回归
- [ ] derived profile 走 `llm-helpers.derive_dynamic_profile` candidate-only 路径；不写 fact/observation/unknown
- [ ] derived profile **不持久化**（无 DB 表/字段；grep 验证无持久化路径）
- [ ] helper disabled 时退回 generic profile，不阻断研究流程
- [ ] `@supplystrata/agent` 三段式可跑；只通过 MCP 与核心交互
- [ ] dep-check 验证：`packages/*` 仍 ⇏ agent；agent ⇏ Layer 1-3 写事实层 package
- [ ] 删除 `packages/agent` + `apps/agent-cli` 后核心 build/test 全绿（meta-test）
- [ ] `apps/agent-cli` 产出报告所有关系断言都有 citation；缺数据显式 cannot_conclude
- [ ] `tests/e2e/agent-report.test.ts` 用 mock provider 跑通全球公司
- [ ] `docs/02-architecture/module-design.md` agent / web 去【新增，目标】标签
- [ ] `docs/03-data-model/intelligence-methodology.md` profile 两层描述与代码一致
- [ ] `docs/06-development/quickstart.md` 加 agent 运行示例段
- [ ] 无 `// TODO` / `// FIXME` / shim 代码
- [ ] type-check / lint / unit / dep-check / build / format-check / smoke:local / smoke:research / smoke:mcp / e2e 全绿

### 风险点（命中即找 commander）

1. **profile derive 想 cache 跨 session** — 头号风险。derived profile 是 session-scope 的，任何"为了省 LLM 调用把 profile 存下来下次复用"的想法都违反 Decision #12，必须停下来讨论。
2. **agent loop 想直接写事实层** — agent 只能通过 MCP write tool（带 confirmation gate）影响核心；不能 import db / pipeline / graph-builder 走捷径。dep-check 拦截，但实现时也要警惕"为了方便"绕过 MCP。
3. **agent 报告杜撰 citation** — synthesize 阶段 LLM 可能编造关系或引用不存在的 evidence。报告里每条关系断言必须能回链到真实 evidence ref；做不到就 cannot_conclude，不允许"看起来完整"。
4. **profile derive 与 generic 退化边界** — helper disabled / provider 未配 / cost 超限时，必须干净退回 generic profile（国家路由 + SIC），不能半途 throw 阻断整个 research run。
5. **agent provider 配置复用** — agent 用户带 LLM provider，应复用 llm-helpers 的 provider config（DQ1），不要在 agent 里重新发明一套 provider 抽象。
6. **三段式不要演化成 framework** — DQ7 明确单进程三段式。出现"要不要加状态机 / 多轮 replan / 工具自动选择"的冲动时，停——那是用户自己拿 agent 当模板去改的事，不是 SupplyStrata 核心范围。

### 测试策略

**保留 + 迁移**：
- 现有 research-target-profile 单测 — 标注为 Layer A anchor 测试，行为不变
- 现有 research-pack 测试 — profile 接入点变化处更新 import

**新增**：
- `tests/unit/profile-registry-layers.test.ts` — anchor 命中 / 未命中 / `profile=none`
- `tests/unit/dynamic-profile-derive.test.ts` — derive candidate + disabled 退化 + 不写库
- `tests/unit/research-session-lifecycle.test.ts` — session 生命周期 + profile 不持久化 + 并发隔离
- `tests/unit/agent-three-stage.test.ts` — mock MCP + mock provider 三段式
- `tests/unit/dep-boundary-agent-removable.test.ts` — meta-test：agent 可整包删除
- `tests/e2e/agent-report.test.ts` — mock provider 端到端报告

### Phase D 完成出口

```
出口判据 (single sentence):
  装上 @supplystrata/agent + apps/agent-cli 并配置 LLM provider 后，
  对一家不命中内置 anchor 的全球上市公司执行 supplystrata-agent --company <q>，
  能：动态派生 session-scope profile → 通过本机 MCP 解析实体 + 跑 source check + 读 evidence/chain
  → 输出带 citation 的可引用 markdown 报告（缺数据处显式 cannot_conclude）；
  且删除 agent 包 + agent-cli 后核心 build/test 仍全绿（架构纯净不变）。
```

---

## Phase E-G · 概览（启动时再细化）

### Phase E · SCBOM v0.x

- **出口**：`supplystrata/scbom-spec` 独立 repo 发布 v0.0.1 JSON Schema；`workbench-export` 输出对齐
- **不变式**：SCBOM schema 不含任何 SupplyStrata 私有字段
- **依赖**：可任何时候启动

### Phase F · Web 嵌入式组件

- **出口**：`<supplystrata-supply-chain-graph>` 在 demo / Notion / Substack 嵌入；IIFE bundle ≤ 200KB gzipped
- **不变式**：不依赖任何 framework；调本机或远程 MCP HTTP
- **依赖**：Phase B（StreamableHTTP）+ Phase E（SCBOM 作为渲染输入）

### Phase G · Community-pack

- **出口**：`pack-2026.QN.parquet` 发布；MCP server `--pack=` 加载校验 sha256
- **不变式**：community-pack 是 read-only baseline；任何写入只发生在本地 cache
- **依赖**：Phase B（MCP 启动参数）+ Phase E（SCBOM 格式）

---

## 决策日志（day-to-day；与 `docs/10-decisions/decisions.md` 区分：那里是宪法）

- 2026-05-28 — **DQ1**: llm-helpers 复用 ai-analysis 的 `provider-config` + `provider-openai-compatible`；加 `LlmProvider` interface 留 plugin 槽
- 2026-05-28 — **DQ2**: MCP 用官方 `@modelcontextprotocol/sdk@1.29.0`；Phase B 先做 stdio，HTTP 用 `StreamableHTTPServerTransport`
- 2026-05-28 — **DQ3**: `gleif` / `openfigi` / `wikidata` 各自独立 `packages/sources/` 包
- 2026-05-28 — **DQ4**: `research_session` 由 `packages/source-workflows` 管理；MCP 仅透传 session_id
- 2026-05-28 — **DQ5**: `scbom-spec` 独立 repo (`supplystrata/scbom-spec`)
- 2026-05-28 — **DQ6**: Web 图渲染用 Sigma.js v3
- 2026-05-28 — **DQ7**: Agent 参考实现采用三段式 `plan → fetch_via_mcp → synthesize`
- 2026-05-28 — **Phase A done**：llm-helpers 4 helper 全部 candidate-only + 输入/输出/citation 校验 + disabled/deferred/invalid/provider_error 状态；dep-check 锁定 3 条边界
- 2026-05-28 — **DQ8** (Phase B 启动)：orchestration 抽取到 `packages/api-orchestration`（apps/api 和 apps/mcp 共用），不走 cross-app dep，也不立即下沉到 domain package
- 2026-05-28 — **DQ9** (Phase B): write tool 的最终 gate 在 server 端（pending state + 显式 confirmation_token），不依赖 client honor annotation
- 2026-05-28 — **DQ10** (Phase B, B4 启动前): MCP annotation 严格使用 spec 标准字段集（`readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`）；不发明 spec 外字段
- 2026-05-28 — **DQ11** (Phase B): MCP TypeScript SDK 采用 npm registry 可解析的官方 `@modelcontextprotocol/sdk@1.29.0`
- 2026-05-28 — **DQ12** (Phase B): B3 read surface 先复用现有 `api-orchestration` DTO；`changes/entity/{id}` 暂映射全局 `listChanges`，`list_source_targets` 暂映射 `listSourceHealth`；真正 entity-scoped DTO 留后续扩展
- 2026-05-28 — **DQ13** (Phase B): B5 HTTP transport 使用 SDK 当前 `StreamableHTTPServerTransport`，endpoint 固定 `/mcp`；不接已废弃的 `SSEServerTransport`；默认绑定 `127.0.0.1`，远程访问必须显式 `--bind=0.0.0.0`
- 2026-05-28 — **DQ14** (Phase B): B6 smoke 采用 spawned stdio fixture server 验证 MCP protocol/tool shape，**不**把 DB runtime 或 source-workflow executor 偷塞进 MCP；真实 DB-backed execution 留给 Phase C
- 2026-05-28 — **Phase B done**：5 个 write tools 双层确认上线；HTTP transport + 多 transport CLI；smoke:mcp 端到端；`api-orchestration` 抽出共享层
- 2026-05-29 — **DQ15** (Phase C, C4): 英国 / 欧盟公司当前为 registry-only / unsupported official disclosure route，返回 `cannot_conclude` 而不是杜撰 source target；per-country OAM 滚动加入
- 2026-05-29 — **DQ16** (Phase C, C6): `seed-entities` 不完全删命令，改为 dev fixture import 语义；entities/aliases 迁到 `tests/fixtures/dev-entities/`；dep-check + unit 约束生产代码不反向依赖 dev fixture（采纳 DQ15 推荐方向 (b) 的实质：dev-only 语义）
- 2026-05-29 — **DQ17** (Phase C, C7): `traverse_chain` 接受 `company:ENT-...` scope；`smoke:mcp:db` 断言真实稳定 envelope 字段，不再断言旧 `operation_id` 调试形状
- 2026-05-29 — **Phase C done**：GLEIF/OpenFIGI/Wikidata identity bootstrap 全球化；country directory routing（US/KR/JP/TW/HK + UK/EU registry-only）；MCP `--runtime=db` 接通真实 DB-backed execution；seed-entities 降级为 dev fixture；非美国公司端到端 e2e（Samsung/TSMC/LVMH/AstraZeneca）

---

## 何时找回 commander

- dep-check 拦不住的边界灰区
- MCP write tool 想跳过 server-side pending gate 或 confirmation_token 校验
- 想用 spec 外的 annotation 字段（应回到 server-side 行为层解决，不污染 MCP 协议层）
- identity bootstrap 信息不足但想"先写一个 placeholder entity"
- Wikidata 数据想直接 promote 到 fact edge
- **profile derive 想 cache 跨 session（Phase D 头号风险）**
- **agent loop 想绕过 MCP 直接 import db / pipeline / graph-builder**
- **agent 报告出现无 citation 的关系断言**
- 三段式 agent 想演化成状态机 / framework（超出 DQ7 范围）
- SCBOM schema 想加 SupplyStrata 私有字段（Phase E）
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
- **Net effect**: 4 个 candidate-only LLM helper 落地（disambiguate_entity / derive_dynamic_profile / suggest_source_targets / summarize_with_citations）；helper 全部带输入校验、输出校验、citation 校验、disabled/deferred/invalid/provider_error 状态机；provider 配置 + OpenAI-compatible adapter + local simulation 从 ai-analysis 整体迁出到 llm-helpers；ai-analysis 收缩为 audit + plan + validation
- **CI 边界**: dep-check 锁定 3 条 — (1) fact/derived 写入路径 ⇏ llm-helpers；(2) `packages/*` ⇏ agent；(3) llm-helpers ⇏ ai-analysis 反向依赖
- **附加**: `packages/agent` optional 占位包；`research ai-analyze` CLI 经 llm-helpers → ai-analysis audit ledger 路径重连；修复过期 `smoke:research` 入口
- **验证全绿**: type-check / lint / unit / dep-check / build / format:check / smoke:local / smoke:research / nvidia-fixture e2e
- **偏离原计划**: 无；A1-A5 按原拆分完成

### Phase B · MCP 接入面 (done · 2026-05-28)

- **Commits**: `3e8f1f1`、`e989a5c`、`9f5e276`、`a35ecd7`（含 B1-B3）
- **Net effect**: `apps/mcp` 落地为 SupplyStrata 唯一对外 surface 雏形；`packages/api-orchestration` 抽出共享 use-case 层（apps/api 与 apps/mcp 对等消费）；6 read tools + 5 write tools；HTTP transport 用现代 `StreamableHTTPServerTransport`；MCP CLI 支持 stdio + http 双 transport + bind/port flag
- **Write 安全双层**: (1) MCP spec 标准 annotation，review.approve/reject 标 `destructiveHint: true`；(2) server-side pending state + 单次性 `confirmation_token`，不依赖 client honor annotation。两层都有 meta-test 拦截
- **关键边界**: smoke 用 spawned fixture server，刻意不接 DB runtime 或 source-workflow executor（划线由 Phase C 接通）
- **修正**: PLAN 早稿误把 server-side 行为字段（`requires_user_confirmation`）写成 MCP annotation；B4 启动前更正为标准 spec 字段集（DQ10）
- **验证全绿**: release:check / smoke:mcp / smoke:local / smoke:research / unit / integration / e2e / type-check / lint / dep-check / build / format-check
- **偏离原计划**: 增加第 5 个 write tool `confirm_research_session`；HTTP transport 选用 `StreamableHTTPServerTransport` 而非 deprecated SSE

### Phase C · 全球身份覆盖 + MCP DB runtime (done · 2026-05-29)

- **Commits**: `140e289`、`d629477`、`1a3d30a`、`dd5958f`、`161f87b`、`7865fc8`、`5d7d633`、`ee80152`
- **Net effect**: 全球公司查询不再绑定美国上市公司或内置 profile。新增 `packages/sources/{gleif,openfigi,wikidata}` 三个 identity adapter；universal identity bootstrap 遵守"默认 ambiguous，不猜测"，Wikidata 仅协作型 hint（不升格 fact），`llm-helpers.disambiguate_entity` 仍 candidate-only；`country-router` 路由 US→SEC / KR→DART / JP→EDINET / TW→TWSE / HK→HKEX stub，UK/EU 为 registry-only 返回 `cannot_conclude`
- **DB runtime 接通**: `apps/mcp --runtime=fixture|db`（默认 fixture，db 缺 POSTGRES_URL fail-fast）；Phase B 刻意未接的 DB-backed execution 在此正式接通；`pnpm smoke:mcp:db` 新增
- **seed 清理**: `seeds/entities.csv` + `aliases.csv` → `tests/fixtures/dev-entities/`；CLI 改 dev fixture import 语义；dep-check/unit 约束生产代码不反向依赖 dev fixture；`seeds/` 只剩 components.csv + README
- **E2E**: `tests/e2e/global-listed-company.test.ts` 用 Docker Postgres + MCP stdio + `--runtime=db` 跑通 Samsung / TSMC / LVMH / AstraZeneca 全链路
- **修正**: `traverse_chain` 接受 `company:ENT-...` scope；`smoke:mcp:db` 断言真实稳定 envelope 字段
- **验证全绿**: type-check / unit / e2e / smoke:mcp:db / build / dep-check / format:check
- **偏离原计划**: C6 未完全删除 seed CLI（DQ15/DQ16），改 dev fixture import 语义；UK/EU 官方披露路由暂为 registry-only（DQ15），不是原计划的全 OAM 覆盖
