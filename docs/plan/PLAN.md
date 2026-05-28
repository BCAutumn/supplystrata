# Implementation Plan (Rolling)

最后更新: 2026-05-28
当前位置: **Phase A · in_progress**

> 这是滚动工作笔记，不是规范。决策 / 边界 / 完成口径以 `docs/` 为准。
> 每完成一 Phase: 压缩当前 → 细化下一。
> 不在本文件写代码。
> Phase G 全部完成后并入 `docs/` 或删除。

---

## 路线图概览

| Phase | 目标                                                       | 状态        |
| ----- | ---------------------------------------------------------- | ----------- |
| A     | 锚定架构不变式 (llm-helpers / dep-check / agent 占位)       | in_progress |
| B     | MCP 接入面 (`apps/mcp`; stdio + HTTP/SSE)                   | not_started |
| C     | 全球身份覆盖 (gleif / openfigi / wikidata + universal bootstrap) | not_started |
| D     | 动态 profile + Agent 参考实现                                | not_started |
| E     | SCBOM v0.x 独立 repo + workbench-export 对齐                 | not_started |
| F     | Web 嵌入式组件 (Sigma.js + Web Components)                   | not_started |
| G     | Community-pack release pipeline                              | not_started |

---

## 工作约定 (贯穿所有 Phase)

1. **每 PR 三件套**：加新边界 + 迁移老代码 + 删除旧路径。**不留 shim / TODO / 死代码**。
2. **每条不变式必有 CI 机械化拦截**（dep-check / lint / contract test 之一），不靠人工审查记忆。
3. **测试矩阵不能只增不减**；迁移代码 = 迁移测试，不允许 skip 后补。
4. **每 Phase 入口工作区必须 git clean**（`git status` 空），方便事后审计 PR diff。
5. **指挥模式**：commander (Claude) 不修改代码；implementer (你) 不私自改架构边界。
6. Phase 完成后由 commander 更新本文件。

---

## Phase A · 锚定架构不变式 [当前]

**目标**：把 Fact 写入不变式 #1 / #3 落成 CI 拦截，把 LLM 调用收敛到唯一入口。

### PR 切分

| PR  | 标题                                                          | 范围                                                                                                                                                                                                                                                                                  | 验收                                                                                                                                          | 清理判据（必须满足才能合）                                                                                                                                                |
| --- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Extract `@supplystrata/llm-helpers` package skeleton          | 新建包；4 个 helper 的 typed 签名 + disabled stub；`LlmProvider` interface 留 plugin 槽；从 ai-analysis **移动**（不复制）`provider-config.ts` + `provider-openai-compatible.ts`；新包加进 workspace + tsconfig path + pnpm-lock                                                          | `pnpm build` / `pnpm type-check` 通过；4 个 helper 即使无业务也能返回合法 candidate；`SUPPLYSTRATA_LLM_DISABLED=1` 时返回 disabled candidate    | ai-analysis 不再 export 任何直接调 provider 的函数；ai-analysis 文件数 ≤ 6                                                                                                |
| A2  | Migrate `local-simulated-analysis` to llm-helpers internal    | `local-simulated-analysis.ts` 从 ai-analysis 移到 llm-helpers 内部，作为"无 provider 时的可预测后端"和"unit test fixture provider"                                                                                                                                                       | `tests/unit/ai-analysis.test.ts` 通过；e2e nvidia 通过                                                                                          | ai-analysis 不再 export `LocalSimulatedAnalysis`；全仓 search 不到该 symbol 在 ai-analysis 外的使用点                                                                       |
| A3  | Refactor existing `research ai-analyze` CLI + API onto llm-helpers | `apps/cli/src/commands/research.ts` 的 ai-analyze 子命令改为：构造 plan（仍用 ai-analysis）→ 调 `llm-helpers.summarize_with_citations` → 写 `ai_analysis_runs` 审计；`apps/api/src/features/http-adapter/orchestration/ai-analysis-artifact-files.ts` 同样改造                              | CLI 行为字节级一致（artifact JSON diff 应只有字段顺序差异，无内容差异）；API e2e 不变；audit 表写入仍发生                                          | `apps/cli` / `apps/api` 不再 import `@supplystrata/ai-analysis` 的 `provider-*` 路径；只 import `@supplystrata/llm-helpers` + ai-analysis 的 audit / plan / validation       |
| A4  | dep-check invariants + agent placeholder                       | (a) dep-check 规则：`pipeline` / `graph-builder` / `review-store` / `claim-builder` / `evidence-maintenance` / `observation-store` **禁止** `@supplystrata/llm-helpers`；(b) 新建 `packages/agent` 占位（README + package.json + src/index.ts 仅声明）；(c) dep-check 规则：`packages/*` 禁止 `@supplystrata/agent` | 故意构造违例 import 验证 `pnpm dep-check` fail；回滚后通过                                                                                       | dep-check 配置文件清晰列出两条边界；CI workflow 包含 dep-check                                                                                                            |
| A5  | Implement 3 remaining helpers + cite validation                | A1 只是签名；A5 实现 disambiguate_entity / derive_dynamic_profile / suggest_source_targets；每个 helper：(a) prompt template 内嵌（不读外部文件） (b) 输入 schema validation (c) 输出 schema validation (d) cite 校验（输出引用的 evidence_id 必须在输入中） (e) ≥ 2 unit test         | 4 个 helper 每个 ≥ 2 测试；fixture 覆盖：正常 / 模糊 / 无效输出 / disabled mode                                                                  | 没有 helper 直接返回 LLM 原始文本；都经过 schema + cite 校验；helper README 写清每个输出的"不允许被当成什么用"                                                              |

### 执行顺序

```
A1 → A2 → A3 ┐
             ├→ A5 → Phase A DONE → Phase B
A4 (并行) ──┘
```

### 清理 checklist（Phase A 合并前必须勾完）

- [ ] `packages/ai-analysis/src/` 文件数 ≤ 6（删 `local-simulated-analysis.ts` + 两个 `provider-*.ts`）
- [ ] `rg "fetch.*api.openai|fetch.*deepseek" packages/` 只命中 `packages/llm-helpers/`
- [ ] `rg "from \"@supplystrata/ai-analysis\"" apps/ packages/` 不再命中 `provider-*` / `local-simulated-*` 导出
- [ ] `pnpm dep-check` 通过；故意构造违例验证拦截有效
- [ ] `packages/llm-helpers/README.md` 完整（4 个 helper 用法 / disabled 行为 / provider 配置 / 与 ai-analysis 关系）
- [ ] `packages/agent/README.md` 写清"独立 optional、不被核心依赖、可整包删除"
- [ ] 无 `// TODO` / `// FIXME` / `// HACK` 残留
- [ ] 无 `deprecated` / `legacy` / `_old` / `.bak` 文件
- [ ] `pnpm type-check` / `lint` / `test:unit` / `dep-check` / `format:check` 全绿
- [ ] `pnpm smoke:local` / `smoke:research` 行为不变
- [ ] `tests/e2e/nvidia-fixture.test.ts` 通过
- [ ] `docs/02-architecture/module-design.md` 中 `packages/llm-helpers/` 和 `packages/agent/` 的【新增，目标】标签去掉

### 风险点（命中即找 commander）

- A1 时 provider-* 移动破坏 ai-analysis barrel；跨包 import 改动 > 5 文件
- A3 后 artifact JSON 字节级 diff 不为空——是 regression，**不能"小修接受 diff"**
- A4 dep-check 工具拦不住——评估升级 dep-check 配置 vs 改用 ESLint rule
- A5 prompt 设计是 net-new；prompt 改动 = 行为改动，必须有 fixture 拦截

---

## Phase B-G · 概览（启动时再细化为 Phase A 的格式）

### Phase B · MCP 接入面

- **出口判据**：Cursor / Claude Desktop 通过 stdio 连接本机 MCP server，端到端跑通 `resolve_company → list_source_targets → run_source_check → traverse_chain` demo
- **关键不变式**：所有 write tool 必须标 `requires_user_confirmation`（contract test 机械化拦截）
- **依赖**：Phase A 完成（write tool 内部仍可能用 llm-helpers，且不能绕过 evidence-gated promote）

### Phase C · 全球身份覆盖

- **出口判据**：`LVMH` / `MC.PA` / `969500FP1Q07I98R6P10` (LEI) / `路易威登` 任一形态解析到同一法人；非美国上市公司能进入对应官方目录监控
- **关键不变式**：identity bootstrap 失败时显式 `unresolved` / `ambiguous`，不伪装"公司不存在"
- **依赖**：Phase A（disambiguate 用 llm-helpers）

### Phase D · 动态 profile + Agent 参考实现

- **出口判据**：删除 `packages/agent` 后核心仍完整可用（dep-check 验证）；agent 包独立跑出可引用报告
- **关键不变式**：profile 只在 session 内存在，不持久化；agent loop 不能直接写事实层
- **依赖**：Phase A（profile derive 用 llm-helpers）、Phase B（agent 调本机 MCP）

### Phase E · SCBOM v0.x

- **出口判据**：`supplystrata/scbom-spec` 独立 repo 发布 v0.0.1 JSON Schema；`workbench-export` 输出对齐
- **关键不变式**：SCBOM schema 不含任何 SupplyStrata 私有字段
- **依赖**：可在任何时候启动；workbench 对齐依赖 schema 稳定

### Phase F · Web 嵌入式组件

- **出口判据**：`<supplystrata-supply-chain-graph>` Web Component 在 demo / Notion / Substack 嵌入并正确渲染；IIFE bundle ≤ 200KB gzipped
- **关键不变式**：不依赖 React / Vue / Svelte / 任何 framework；调本机或远程 MCP HTTP
- **依赖**：Phase B（HTTP/SSE transport）+ Phase E（SCBOM 作为渲染输入）

### Phase G · Community-pack

- **出口判据**：`pack-2026.QN.parquet` 通过 GitHub Release 分发；MCP server `--pack=` 加载校验 sha256；本地写覆盖 pack 字段但不污染 pack
- **关键不变式**：community-pack 是 read-only baseline；任何写入只发生在本地 cache 层
- **依赖**：Phase B（MCP server 启动参数）、Phase E（SCBOM 作为 pack 格式）

---

## 决策日志（day-to-day；与 `docs/10-decisions/decisions.md` 区分：那里是宪法）

- 2026-05-28 — **DQ1**: llm-helpers 复用 ai-analysis 的 `provider-config` + `provider-openai-compatible`；加 `LlmProvider` interface 留 plugin 槽（未来 Anthropic native / Gemini / Ollama）
- 2026-05-28 — **DQ2**: MCP 用官方 `@modelcontextprotocol/sdk-typescript`；Phase B 只做 stdio，HTTP/SSE 放 Phase B 后段
- 2026-05-28 — **DQ3**: `gleif` / `openfigi` / `wikidata` 各自独立 `packages/sources/` 包
- 2026-05-28 — **DQ4**: `research_session` 由 `packages/source-workflows` 管理（与 `research-runs.ts` 同层）；MCP 仅透传 session_id
- 2026-05-28 — **DQ5**: `scbom-spec` 独立 repo (`supplystrata/scbom-spec`)，从 v0.0.1 起独立版本号
- 2026-05-28 — **DQ6**: Web 图渲染用 Sigma.js v3
- 2026-05-28 — **DQ7**: Agent 参考实现采用三段式 `plan → fetch_via_mcp → synthesize`，单进程无状态机

---

## 何时找回 commander

- dep-check 拦不住的边界灰区
- MCP write tool 想跳过 `requires_user_confirmation`
- identity bootstrap 信息不足但又想"先写一个 placeholder entity"
- profile derive 想 cache 跨 session
- SCBOM schema 想加 SupplyStrata 私有字段
- 出现"为了赶进度先 hack 一下事实写入"的诱惑
- artifact JSON 字节级 diff 不为空但想接受 diff
- 任何 PR 想留 `// TODO` / `// FIXME` / shim 代码
- 任何 PR 想 skip 老测试"后面再补"

---

## Phase 完成时本文件如何更新（commander 操作）

1. 把当前 Phase 详细段**压缩为 5-10 行摘要**（commits range + 关键变化 + 实际偏离）
2. 路线图概览状态更新（当前 Phase → `done`，下一 Phase → `in_progress`）
3. 把下一 Phase 概览扩展为详细段（PR 切分 / 执行顺序 / 清理 checklist / 风险点）
4. 决策日志追加本 Phase 期间产生的新决策
5. 必要时更新 `docs/` 中状态描述（去掉【新增，目标】标签等）

---

## 已完成 Phase 摘要

（暂无；Phase A 完成后此处追加压缩摘要）
