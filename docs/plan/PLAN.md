# Implementation Plan (Rolling)

最后更新: 2026-05-28
当前位置: **Phase B · in_progress**

> 这是滚动工作笔记，不是规范。决策 / 边界 / 完成口径以 `docs/` 为准。
> 每完成一 Phase: 压缩当前 → 细化下一。
> 不在本文件写代码。
> Phase G 全部完成后并入 `docs/` 或删除。

---

## 路线图概览

| Phase | 目标                                                             | 状态        |
| ----- | ---------------------------------------------------------------- | ----------- |
| A     | 锚定架构不变式 (llm-helpers / dep-check / agent 占位)            | **done**    |
| B     | MCP 接入面 (`apps/mcp`; stdio + HTTP/SSE)                        | in_progress |
| C     | 全球身份覆盖 (gleif / openfigi / wikidata + universal bootstrap) | not_started |
| D     | 动态 profile + Agent 参考实现                                    | not_started |
| E     | SCBOM v0.x 独立 repo + workbench-export 对齐                     | not_started |
| F     | Web 嵌入式组件 (Sigma.js + Web Components)                       | not_started |
| G     | Community-pack release pipeline                                  | not_started |

---

## 工作约定 (贯穿所有 Phase)

1. **每 PR 三件套**：加新边界 + 迁移老代码 + 删除旧路径。**不留 shim / TODO / 死代码**。
2. **每条不变式必有 CI 机械化拦截**（dep-check / lint / contract test 之一），不靠人工审查记忆。
3. **测试矩阵不能只增不减**；迁移代码 = 迁移测试，不允许 skip 后补。
4. **每 Phase 入口工作区必须 git clean**。
5. **指挥模式**：commander (Claude) 不修改代码；implementer (你) 不私自改架构边界。
6. Phase 完成后由 commander 更新本文件。

---

## Phase B · MCP 接入面 [当前]

**目标**：从 `apps/api` 抽出可复用的 orchestration 层，把 `apps/mcp` 建成 SupplyStrata 唯一对外 surface 的雏形；落实"所有 write tool 必须 `requires_user_confirmation`"的 contract 拦截。`apps/api` REST 暂时保留作为过渡。

### 前置说明：为什么需要 B1 (orchestration 抽取)

`apps/api/src/features/http-adapter/orchestration/` 当前装着所有 HTTP handler 的 use-case 编排（`db-operation-handlers.ts`、`ai-analysis-artifact-files.ts`、`route-match.ts`、`http-response.ts` 等）。MCP server 要复用这些 use-case；走 cross-app 反向 import 会被 dep-check 拒，也是架构 smell。

**已决定**（DQ8）：抽到 `packages/api-orchestration`，apps/api 和 apps/mcp 都依赖它。下沉到 domain package 是更优的最终态，但属于单独的架构治理轮次，不耦合在 Phase B 主目标里。

### PR 切分

| PR  | 标题                                            | 范围                                                                                                                                                                                                          | 验收                                                                                                                                                                                              | 清理判据                                                                                                                                  |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Extract `@supplystrata/api-orchestration` package | 把 `apps/api/src/features/http-adapter/orchestration/` 整体移到新包；apps/api 改为 import 新包；纯结构 refactor，**零行为改动**                                                                                | `pnpm type-check` / `lint` / `test:unit` / `dep-check` / `build` 全绿；`tests/unit/api-http-adapter.test.ts` 通过无 diff；REST API contract test 通过无 diff                                       | `apps/api/src/features/http-adapter/orchestration/` 目录消失；rg 不再命中 `apps/api/src/.*orchestration` 的反向引用；新包 README 写明定位 |
| B2  | `apps/mcp` skeleton + stdio + ping tool         | 新建 `apps/mcp` app；引入 `@modelcontextprotocol/sdk-typescript`（锁版本）；stdio transport；一个 `ping` tool 验证连通；CLI 入口 `pnpm mcp --transport=stdio`；不暴露任何业务工具                                | `pnpm mcp --transport=stdio` 启动不报错；手动用 SDK client 调 `ping` 收到响应；新增 `tests/unit/apps-mcp-skeleton.test.ts` 验证服务器能初始化和注册 `ping`                                          | apps/mcp 不 import apps/api；apps/mcp README 写明定位与未来工具 surface 列表                                                              |
| B3  | Read resources + read tools                     | 6 个 resources（`entity/{id}`、`evidence/edge/{id}`、`unknowns/company/{id}`、`changes/entity/{id}`、`source-health`、`reasoning-walkthrough/{id}`）+ 6 个 read tools（`resolve_company`、`read_evidence_for_edge`、`traverse_chain`、`list_unknowns`、`list_source_targets`、`poll_research_run`）；全部通过 `api-orchestration` 复用现有 DTO | 每个 resource / tool 有 contract test 与 schema validation；URI grammar 文档化；新增 `tests/unit/mcp-read-surface.test.ts`                                                                          | 没有 read-side resource / tool 直接读 DB；都经过 `api-orchestration`；read-side 不调用 llm-helpers（除非显式启用的 helper-backed read tool） |
| B4  | Write tools + `requires_user_confirmation` 拦截 | 4 个 write tools（`start_research_session`、`run_source_check`、`review.approve`、`review.reject`）；每个 tool schema 必须含 `annotations.requires_user_confirmation = true`；**新增 contract meta-test**：枚举所有 write tools 断言 annotation 存在 | meta-test 故意构造一个无 annotation 的 write tool 验证 fail；回滚后通过；写入仍走 evidence-gated promote                                                                                            | 没有 write tool 跳过 annotation；没有 write tool 直接调 LLM helper（write tool 内部仍可调，但 candidate 仍需 review）；audit trail 写入   |
| B5  | HTTP/SSE transport + multi-transport CLI        | 在 SDK 基础上接 HTTP/SSE transport；CLI 增加 `--transport=http --port=N`；CORS / 鉴权策略文档化（local-first 默认 localhost-only）                                                                              | `pnpm mcp --transport=http --port=7474` 启动；用 curl / SDK client 双协议都能调通 read surface；新增 `tests/unit/mcp-http-transport.test.ts`                                                       | HTTP 默认仅 localhost；远程访问需要显式 `--bind 0.0.0.0` 且 README 标红                                                                   |
| B6  | E2E smoke + docs alignment                      | 新增 `pnpm smoke:mcp`：spawn stdio MCP server → 调用 `resolve_company("NVIDIA") → list_source_targets → run_source_check → traverse_chain` → 断言输出 shape；`docs/02-architecture/module-design.md` 去掉 mcp / api-orchestration 的【新增，目标】标签；`docs/06-development/quickstart.md` Phase B 占位段替换为真实示例 | smoke 单独运行 < 30s；CI 包含                                                                                                                                                                      | quickstart 中"MCP server（v0.x 目标）"段从占位变为可运行示例；Phase B 概览段（本文件）压缩为摘要                                          |

### 执行顺序

```
B1 (orchestration 抽取) → B2 (mcp skeleton) → B3 (read surface) ┐
                                                                ├→ B5 (HTTP/SSE) → B6 (smoke + docs) → Phase B DONE → Phase C
                                              B4 (write surface) ┘
```

B3 和 B4 可以并行（不同文件、不同 tool 集合）；B5 依赖 skeleton 稳定（B2 之后）；B6 依赖前 5 个 PR。

### 清理 checklist（Phase B 合并前必须勾完）

- [ ] `apps/api/src/features/http-adapter/orchestration/` 目录已消失（B1）
- [ ] `apps/api` 仍然能跑现有 contract test；REST e2e 无 diff
- [ ] `apps/mcp` 不依赖 `apps/api`（dep-check 验证）
- [ ] `apps/mcp` 依赖 `packages/api-orchestration`、`packages/llm-helpers`（当需要时）但不依赖任何写事实层的 package
- [ ] 所有 write tools 都有 `annotations.requires_user_confirmation = true`（meta-test 拦截）
- [ ] MCP resources URI grammar 文档化在 `apps/mcp/README.md`
- [ ] `pnpm mcp --transport=stdio` 和 `pnpm mcp --transport=http --port=N` 都能跑
- [ ] `pnpm smoke:mcp` 通过；进入 CI（如有 `pnpm release:check` 列表）
- [ ] 无 `// TODO` / `// FIXME` / shim 代码
- [ ] `docs/02-architecture/module-design.md` 中 `apps/mcp/`、`packages/api-orchestration/` 的【新增，目标】标签去掉
- [ ] `docs/06-development/quickstart.md` 的 MCP 段从占位扩展为可运行示例
- [ ] `pnpm type-check` / `lint` / `test:unit` / `dep-check` / `build` / `format:check` 全绿
- [ ] `pnpm smoke:local` / `smoke:research` / `smoke:mcp` 都通过
- [ ] `tests/e2e/nvidia-fixture.test.ts` 通过

### 风险点（命中即找 commander）

- **B1 边界灰区**：抽 orchestration 时发现 handler 里混着 HTTP-specific 逻辑（如 `Express.Request`、`res.status()`）。这类必须留在 `apps/api` 的 transport 层，handler 必须返回纯 DTO + 显式 error。如果 mixing 严重，停下来一起设计 boundary。
- **B2 SDK 版本兼容**：`@modelcontextprotocol/sdk-typescript` 是 v0.x，API 可能演进。锁定具体 minor 版本；如果 SDK 不直接支持 `annotations.requires_user_confirmation`（这是较新的 MCP spec 字段），需要手动注入 annotation 并加 contract test。**遇到 SDK 不支持，请停下来一起决定**：(a) PR 给 SDK；(b) 私有 wrapper；(c) 等 SDK 升级。
- **B4 `requires_user_confirmation` 的传播语义**：MCP 客户端（Cursor / Claude Desktop）是否真的尊重这个 annotation 取决于客户端实现，不是 server 能强制的。**Server 端必须独立持有最终 gate**——例如 `start_research_session` 即使被 agent 自动调，仍只能创建一个 `pending_user_confirmation` 的 session，需要用户显式 `confirm_research_session(session_id)` 才真正启动。这一点 contract test 要拦截，不能依赖 client honor annotation。
- **B5 HTTP 默认绑定**：默认必须 `127.0.0.1`，不允许 0.0.0.0 是默认。`--bind 0.0.0.0` 必须显式且 README 警告。本机外网暴露的安全责任由用户承担。
- **任何想跳过 evidence-gated promote 的 write tool**：违反 Fact 写入不变式 #1，禁止合入。

### 测试策略

**保留 + 迁移**（B1 期间）：
- `tests/unit/api-http-adapter.test.ts` — 保留，import 路径更新到 `@supplystrata/api-orchestration`
- `tests/unit/api-supply-chain-report-summary.test.ts` — 同上
- `tests/unit/api-contract.test.ts` — 保留

**新增**（B2-B5）：
- `tests/unit/apps-mcp-skeleton.test.ts` — server 启动 + register ping
- `tests/unit/mcp-read-surface.test.ts` — 每个 resource / read tool 一个用例
- `tests/unit/mcp-write-surface.test.ts` — 每个 write tool 一个用例 + 必须含 confirmation 流程
- `tests/unit/mcp-confirmation-meta.test.ts` — meta-test 枚举所有 write tools 断言 annotation
- `tests/unit/mcp-http-transport.test.ts` — HTTP/SSE 双协议
- `scripts/smoke-mcp.mjs` — 端到端 spawn server 测试

### Phase B 完成出口

```
出口判据 (single sentence):
  本机启动 apps/mcp stdio server 后，用 @modelcontextprotocol SDK client 能完成
  resolve_company → list_source_targets → run_source_check → poll_research_run → traverse_chain
  五步调用链，全部读 path 通过 api-orchestration 复用现有 DTO，
  全部写 path 经过 requires_user_confirmation 双重 gate（client annotation + server pending state）。
```

---

## Phase C-G · 概览（启动时再细化）

### Phase C · 全球身份覆盖

- **出口**：`LVMH` / `MC.PA` / `969500FP1Q07I98R6P10` (LEI) / `路易威登` 任一形态解析到同一法人；非美国上市公司能进入对应官方目录监控
- **不变式**：identity bootstrap 失败时显式 `unresolved` / `ambiguous`，不伪装"公司不存在"
- **依赖**：Phase A（disambiguate 用 llm-helpers）

### Phase D · 动态 profile + Agent 参考实现

- **出口**：删除 `packages/agent` 后核心仍完整可用（dep-check 验证）；agent 包独立跑出可引用报告
- **不变式**：profile 只在 session 内存在不持久化；agent loop 不能直接写事实层
- **依赖**：Phase A（profile derive 用 llm-helpers）、Phase B（agent 调本机 MCP）

### Phase E · SCBOM v0.x

- **出口**：`supplystrata/scbom-spec` 独立 repo 发布 v0.0.1 JSON Schema；`workbench-export` 输出对齐
- **不变式**：SCBOM schema 不含任何 SupplyStrata 私有字段
- **依赖**：可任何时候启动

### Phase F · Web 嵌入式组件

- **出口**：`<supplystrata-supply-chain-graph>` 在 demo / Notion / Substack 嵌入；IIFE bundle ≤ 200KB gzipped
- **不变式**：不依赖任何 framework；调本机或远程 MCP HTTP
- **依赖**：Phase B（HTTP/SSE）+ Phase E（SCBOM 作为渲染输入）

### Phase G · Community-pack

- **出口**：`pack-2026.QN.parquet` 发布；MCP server `--pack=` 加载校验 sha256
- **不变式**：community-pack 是 read-only baseline；任何写入只发生在本地 cache
- **依赖**：Phase B（MCP 启动参数）+ Phase E（SCBOM 格式）

---

## 决策日志（day-to-day；与 `docs/10-decisions/decisions.md` 区分：那里是宪法）

- 2026-05-28 — **DQ1**: llm-helpers 复用 ai-analysis 的 `provider-config` + `provider-openai-compatible`；加 `LlmProvider` interface 留 plugin 槽
- 2026-05-28 — **DQ2**: MCP 用官方 `@modelcontextprotocol/sdk-typescript`；Phase B 只做 stdio，HTTP/SSE 放 Phase B 后段
- 2026-05-28 — **DQ3**: `gleif` / `openfigi` / `wikidata` 各自独立 `packages/sources/` 包
- 2026-05-28 — **DQ4**: `research_session` 由 `packages/source-workflows` 管理；MCP 仅透传 session_id
- 2026-05-28 — **DQ5**: `scbom-spec` 独立 repo (`supplystrata/scbom-spec`)
- 2026-05-28 — **DQ6**: Web 图渲染用 Sigma.js v3
- 2026-05-28 — **DQ7**: Agent 参考实现采用三段式 `plan → fetch_via_mcp → synthesize`
- 2026-05-28 — **Phase A done**：llm-helpers 4 helper 全部 candidate-only + 输入/输出/citation 校验 + disabled/deferred/invalid/provider_error 状态；dep-check 锁定 3 条边界（写事实层 ⇏ llm-helpers / packages ⇏ agent / llm-helpers ⇏ ai-analysis）
- 2026-05-28 — **DQ8** (Phase B 启动)：orchestration 抽取到 `packages/api-orchestration`（apps/api 和 apps/mcp 共用），不走 cross-app dep，也不立即下沉到 domain package。理由：两个 surface 对等消费同一组 use-case；apps 反向依赖被 dep-check 禁；下沉到 domain package 方向对但属于单独的架构治理轮次，不应耦合在 Phase B 主目标里。**已采纳，B1 解锁**。
- 2026-05-28 — **DQ9** (Phase B): `requires_user_confirmation` 的最终 gate 在 server 端（pending state + 显式 confirm），不依赖 client honor annotation。Annotation 仍写，但只是给客户端的 hint，不是安全边界。

---

## 何时找回 commander

- dep-check 拦不住的边界灰区
- MCP write tool 想跳过 `requires_user_confirmation` 或 server-side pending gate
- orchestration 抽出时发现 HTTP-specific 逻辑混在 handler 里且 mixing 严重
- MCP SDK 不支持 `annotations.requires_user_confirmation` 字段
- identity bootstrap 信息不足但想"先写一个 placeholder entity"（Phase C）
- profile derive 想 cache 跨 session（Phase D）
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
