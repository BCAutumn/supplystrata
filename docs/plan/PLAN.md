# Implementation Plan (Rolling)

最后更新: 2026-05-29
当前位置: **Phase E · in_progress**

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
| E     | SCBOM v0.x 开放交换格式 + workbench-export 对齐        | in_progress |
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

## Phase E · SCBOM v0.x 开放交换格式 [当前]

> 大白话：把供应链数据从"SupplyStrata 专用盒子"换成"谁都能读写的通用文件格式"（类比 PDF/SBOM），让"数据源"定位真正成立。

**目标**：把 SupplyStrata 的供应链数据从"`WorkbenchModel` 私有 DTO"升级为**独立维护、厂商中立的开放交换格式 SCBOM**（Supply Chain Bill of Materials）。这是 Decision #10 的兑现：SupplyStrata 是 SCBOM 的参考实现**之一**，不是它的拥有者。

完成后，任何第三方（竞品、研究机构、其它 agent）都能用 SCBOM schema 校验、生产、消费供应链证据数据，而不需要依赖 SupplyStrata 的代码。SupplyStrata 通过 MCP resource `supplystrata://scbom/company/{lei}` 输出 SCBOM 文档。

### 前置说明：独立 repo 与消费机制

Decision #5 / DQ5 锁定：`scbom-spec` 是**独立 repo**（`supplystrata/scbom-spec`），从 v0.0.1 起独立版本号。这意味着 Phase E **跨两个 repo**：

- **`supplystrata/scbom-spec`（新 repo）**：JSON Schema + 规范文档 + 语言无关 conformance examples + 校验工具。不依赖任何 SupplyStrata 包。
- **本 monorepo**：消费已发布的 SCBOM schema，实现 exporter + MCP resource。

**待你确认 DQ18（消费机制）再启动 E4**：本 repo 如何引用 scbom-spec？
- **(a) npm 包 `@scbom/spec`**（JSON Schema + 生成的 TS 类型），本 repo 作为 dep。**推荐**——版本可锁、类型可生成、最干净。
- (b) git submodule：版本同步手动、CI 复杂。
- (c) copy schema + 版本 pin：简单但易 drift。

E1-E3（spec repo 内）不阻塞，可立即开始；E4 起需要消费机制定下来。

### SCBOM 核心对象（v0.0.1 范围）

从 `WorkbenchModel`（已有 `schema_version: "1.0.0"`）抽取厂商中立子集：

| SCBOM 对象        | 来源 WorkbenchModel 字段           | 关键规则                                                            |
| ----------------- | ---------------------------------- | ------------------------------------------------------------------ |
| `entity`          | `companies[]`                      | 必须带稳定 identifier（LEI 优先）+ provenance                       |
| `relationship`    | `edges[]` / upstream / downstream  | 必须带 evidence ref + evidence_level + validity                    |
| `evidence`        | `evidences[]`                      | 必须带 source URL + cite text + locator/fingerprint                |
| `observation`     | （intelligence/observation 子集）  | 不可被消费方误读成 relationship                                     |
| `unknown`         | `unknown_items[]`                  | 一等对象，不是错误日志                                              |
| `change`          | `changes[]`                        | 审计变化；语义类型枚举                                              |

**不进 SCBOM**：risk metric / claim fusion 内部态 / attention queue / review queue / source_check job —— 这些是 SupplyStrata 派生层或运行态，不是厂商中立的交换内容。SCBOM 只交换"可证事实 + 证据 + 未知 + 变化"。

### PR 切分

| PR  | 标题                                          | 范围                                                                                                                                                                                                                       | 验收                                                                                                                | 清理判据                                                                                                       |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| E1  | scbom-spec repo bootstrap + entity/relationship/evidence schema | 新建 `supplystrata/scbom-spec` repo；JSON Schema (draft 2020-12) for `entity` / `relationship` / `evidence`；README 写明设计原则（厂商中立、provenance 必填、evidence-first）；MIT/Apache 双许可                          | 三个 schema 通过 JSON Schema meta-validation；repo 有 ≥ 3 个 valid example + ≥ 3 个 invalid example（缺 provenance 等） | scbom-spec **零依赖** SupplyStrata；schema 里无 `supplystrata_*` 私有字段；version `0.0.1` 标注                  |
| E2  | scbom-spec observation/unknown/change schema  | 补 `observation` / `unknown` / `change` schema；定义对象间引用规则（relationship → evidence ref，change → 受影响对象 ref）；定义顶层 `scbom-document` envelope（version / generated_at / objects[]）                          | 6 类对象 schema 完整；envelope schema 校验通过；example 覆盖 cross-object 引用完整性                                  | observation schema 明确标注"不可作为 relationship"；unknown 是一等对象；无私有字段                              |
| E3  | scbom-spec conformance suite + publish v0.0.1 | 语言无关 conformance test runner（纯 JSON in/out，任何实现都能跑）；CI 在 scbom-spec repo 内跑；发布 v0.0.1（npm `@scbom/spec` 含 schema + 生成 TS 类型，**待 DQ18**）                                                       | conformance suite ≥ 20 cases；CI 绿；v0.0.1 可被外部安装/引用                                                        | conformance runner 不依赖任何特定语言实现；spec repo 自洽可独立 release                                          |
| E4  | `workbench-export` → SCBOM exporter           | 本 repo 引入 SCBOM 消费机制（DQ18）；`packages/workbench-export` 新增 `toScbomDocument(model)` ；映射 WorkbenchModel 子集 → SCBOM 6 对象；对每个导出文档跑 SCBOM schema 校验                                                  | 单测：NVIDIA fixture → SCBOM document 通过 schema 校验；映射不丢 evidence/provenance；risk/claim 内部态不泄漏到 SCBOM | exporter 输出 100% 通过 SCBOM schema；无私有字段泄漏（meta-test 拦截）；WorkbenchModel 原导出保留               |
| E5  | MCP `scbom/company/{lei}` resource            | `apps/mcp` 新增 resource `supplystrata://scbom/company/{lei}`，经 `api-orchestration` → workbench-export SCBOM exporter；LEI 解析复用 Phase C identity bootstrap                                                              | contract test：resource 返回合法 SCBOM document；无 LEI / 未解析时返回明确 error；fixture + db 两 runtime 一致      | resource 输出经 SCBOM schema 校验；不绕过 api-orchestration                                                      |
| E6  | Conformance e2e + docs alignment              | 本 repo e2e：导出 SCBOM → 用 `@scbom/spec` conformance 校验通过；更新 docs/03-data-model（SCBOM 章节）、module-design（scbom-spec 去【新增,目标】）、data-flow（scbom resource）、quickstart（SCBOM 导出示例）                | `tests/e2e/scbom-export.test.ts` 通过；docs 与实现一致                                                               | docs 引用 scbom-spec repo + 版本；module-design SCBOM 行去标签；无 TODO/shim                                     |

### 执行顺序

```
[scbom-spec repo]  E1 (entity/rel/evidence) → E2 (obs/unknown/change) → E3 (conformance + publish v0.0.1)
                                                                              │
                                                                              ↓ (DQ18 消费机制定下来)
[本 repo]                                          E4 (exporter) → E5 (mcp resource) → E6 (e2e + docs) → Phase E DONE
```

E1-E3 在 scbom-spec repo 内自洽完成并发布；E4 起本 repo 消费已发布 spec。

### 清理 checklist（Phase E 合并前必须勾完）

- [ ] `scbom-spec` repo 独立、零依赖 SupplyStrata、双许可、v0.0.1 已发布
- [ ] 6 类对象 schema + envelope schema 完整；JSON Schema meta-validation 通过
- [ ] schema 无任何 `supplystrata_*` / 厂商私有字段（人工 + meta-test 双查）
- [ ] conformance suite ≥ 20 cases，语言无关，scbom-spec CI 绿
- [ ] `@scbom/spec`（或 DQ18 选定机制）可被本 repo 引用，版本锁定
- [ ] `workbench-export.toScbomDocument()` 输出 100% 通过 SCBOM schema 校验
- [ ] SCBOM exporter 不泄漏 risk/claim 内部态 / attention / review / job（meta-test 拦截私有字段）
- [ ] MCP `supplystrata://scbom/company/{lei}` resource 落地；fixture + db 两 runtime 一致
- [ ] `tests/e2e/scbom-export.test.ts` 用 conformance suite 校验通过
- [ ] `docs/03-data-model/` 加 SCBOM 章节；`module-design.md` scbom-spec 去【新增,目标】标签
- [ ] `docs/02-architecture/data-flow.md` scbom resource 与实现一致
- [ ] `docs/06-development/quickstart.md` 加 SCBOM 导出示例
- [ ] 无 `// TODO` / `// FIXME` / shim 代码
- [ ] 本 repo: type-check / lint / unit / dep-check / build / format-check / e2e / smoke 全绿

### 风险点（命中即找 commander）

1. **私有字段泄漏进 SCBOM** — 头号风险。SCBOM 是厂商中立格式；任何 `supplystrata_*` 字段、risk metric、claim fusion 内部态、attention/review 运行态泄漏进 schema 都违反 Decision #10。meta-test 必须拦截。
2. **SCBOM 想塞 SupplyStrata 才有的概念** — 例如把 SupplyStrata 的 `evidence_level` 五级体系硬编进 schema。evidence_level 可以作为 SCBOM `evidence.strength` 的一种 vocabulary，但 schema 应允许其它实现用自己的 strength 体系，不能锁死成 SupplyStrata 的 1-5。**遇到这类设计抉择停下来讨论**。
3. **跨 repo 工作流摩擦** — scbom-spec 独立 repo + 本 repo 消费，版本同步是新成本。DQ18 选 npm 包能最大缓解。E1-E3 完成且 v0.0.1 发布前，E4 不要开始（否则对着未冻结 schema 写 exporter 会反复返工）。
4. **observation 被消费方误读成 relationship** — SCBOM observation schema 必须在结构上就让"这不是一条供应关系"无法被误解（独立 object type + 明确 `not_a_relationship` 语义），不能只靠文档说明。
5. **LEI 缺失的 entity 如何进 SCBOM** — 不是所有 entity 都有 LEI（小公司/设施/组件）。SCBOM entity identifier 应支持多体系（LEI / FIGI / 国家注册号 / SupplyStrata internal id 作 fallback），但 fallback id 必须显式标 namespace，不能伪装成全球标识。

### 测试策略

**scbom-spec repo（新）**：
- JSON Schema meta-validation（schema 本身合法）
- valid/invalid example fixtures（每类对象 ≥ 3 valid + ≥ 3 invalid）
- 语言无关 conformance runner（≥ 20 cases）

**本 repo 新增**：
- `tests/unit/workbench-to-scbom.test.ts` — 映射正确性 + 无私有字段泄漏
- `tests/unit/scbom-no-private-fields.test.ts` — meta-test 扫描导出无 `supplystrata_*` 等
- `tests/unit/mcp-scbom-resource.test.ts` — resource contract
- `tests/e2e/scbom-export.test.ts` — 导出 → conformance 校验端到端

### Phase E 完成出口

```
出口判据 (single sentence):
  scbom-spec 作为零依赖独立 repo 发布 v0.0.1（6 类对象 + envelope + conformance suite）；
  本 repo workbench-export 能把任一公司 WorkbenchModel 导出为 100% 通过 SCBOM schema 校验的文档，
  且不泄漏任何 SupplyStrata 私有字段（meta-test 拦截）；
  MCP resource supplystrata://scbom/company/{lei} 在 fixture + db 两 runtime 下都返回合法 SCBOM document。
```

---

## Phase F-G · 概览（启动时再细化）

### Phase F · Web 嵌入式组件

- **出口**：`<supplystrata-supply-chain-graph>` 在 demo / Notion / Substack 嵌入；IIFE bundle ≤ 200KB gzipped
- **不变式**：不依赖任何 framework；调本机或远程 MCP HTTP；用 SCBOM document 作渲染输入
- **依赖**：Phase B（StreamableHTTP）+ Phase E（SCBOM 作为渲染输入）

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
- 2026-05-29 — **DQ18** (Phase E): 本 repo 通过 npm 包 `@scbom/spec`（JSON Schema + 生成 TS 类型）消费 scbom-spec，版本锁定。**已采纳，E4 解锁**

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
- **SCBOM schema 想加 SupplyStrata 私有字段 / 把 evidence_level 1-5 锁死进 schema（Phase E 头号风险）**
- **SCBOM observation 只靠文档而非结构防止被误读成 relationship**
- **scbom-spec 还没冻结 v0.0.1 就想开始写 exporter（E4 前置）**
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
