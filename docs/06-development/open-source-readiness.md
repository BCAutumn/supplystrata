# Open Source Readiness — 开源状态与体检

本文件记录开源发布前后的最低准备状态。目标不是宣称 MVP 已完成，而是判断仓库能否以 alpha/MVP 形式公开，让外部用户理解边界、跑通本地切片，并安全贡献。

## 当前判断

**已经可以公开 alpha，但还不应宣称 Phase 2 / MVP 完成。**

当前公开基线：

- GitHub repo: `BCAutumn/supplystrata`
- Release tag: `v0.1.0-alpha.1`
- License: Apache-2.0

下一阶段以后端完成 gate 为准，见 [backend-completion-criteria.md](./backend-completion-criteria.md)。`phase-2-upgrade-plan.md` 仍保留为可信度修复的历史计划，不再代表当前全部后端进度。

适合对外表述：

- `alpha`
- `MVP vertical slice`
- `evidence-first supply-chain graph`
- `critical technology supply-chain intelligence workbench`
- `not investment advice`
- `public-data only`

不适合对外表述：

- "完整供应链数据库"
- "自动供应链发现"
- "全球供应链监控系统"
- "实时货物流追踪系统"
- "成熟风险提示产品"
- "投资 alpha 系统"
- "覆盖所有 Apple/NVIDIA 供应商"

## 已具备

- Apache-2.0 license。
- README 有项目定位、非目标、运行切片。
- `.env` 被忽略，`.env.example` 可用。
- `data/`、`reports/` 被忽略。
- `CONTRIBUTING.md`、`SECURITY.md`、`CODE_OF_CONDUCT.md` 已存在。
- GitHub Actions CI 已配置 type-check、unit、integration、lint、dependency boundary。
- GitHub Actions CI 已配置 fixture e2e。
- `pnpm release:check` 已配置本地发布前体检：ignore rules、secret scan、type-check、unit、integration、e2e、lint、dep-check 和无数据库 smoke；需要本地 truth store / GraphStore 时使用 `pnpm release:check --with-db` 额外跑 `dq run` 与 `graph check`。
- GitHub issue / PR templates 已配置数据边界提醒。
- `pnpm type-check`、`pnpm test:unit`、`pnpm test:integration`、`pnpm lint`、`pnpm dep-check` 可运行。
- `pnpm test:e2e` 可运行，不访问 SEC 外网。
- `pnpm smoke:local` 可在无 Docker/无 DB 环境运行；`pnpm smoke:local --with-db` / `pnpm smoke:network` 用于持久化链路自检。
- `pnpm cli dq run` 可检查 Postgres truth 的核心数据质量。
- 本地 Postgres / Neo4j 路径可运行。
- `graph check` / `graph rebuild` 能验证并恢复 Neo4j 物化视图。
- `review -> approve -> apply` 边界清楚，批处理只处理 approved 候选。

## 发布前必须检查

- [x] 删除或确认不提交本地 `.env`。
- [x] 删除或确认不提交 `data/`。
- [x] 删除或确认不提交 `reports/`。
- [x] 确认没有 raw PDF / raw HTML / API response 进入 git。
- [x] README 当前状态与 CLI 命令一致。
- [x] `docs/06-development/backend-completion-criteria.md` 作为后端完成权威 gate。
- [x] `docs/06-development/roadmap.md` 已改为历史阶段记录，避免被误读为后端完成门槛。
- [x] `docs/09-risks-compliance/legal-tos.md` 与实际 adapter 一致。
- [x] GitHub 启用 private vulnerability reporting。
- [x] CI 至少跑 type-check、unit、integration、fixture e2e、lint、dep-check。
- [x] 本地发布前跑 `pnpm release:check`。

## 后端仍缺

按 [backend-completion-criteria.md](./backend-completion-criteria.md)，主要还缺：

- 官方披露事实覆盖：至少 25 个核心节点、100 条 Level 4/5 fact edge、30% 二来源或 single-source 标记。
- Claim 多源融合：支持支持源、反证源、unknown / conflict，并有 regression fixtures。
- Observation / signal 深度：至少 3 类 observation 进入 ComponentCard / ChainView，并保持不写 fact edge。
- API / 嵌入契约：`apps/api` contract tests、只读 DTO、review action API。
- Agent / LLM 安全接入：schema validation、cite_text 校验、review queue、audit log。
- 质量与性能：contract / integration / perf baseline、code-quality-hardening 无 P0/P1 open item。

## 粗略完成度

这是工程判断，不是承诺日期：

- 开源 alpha 准备度：已具备。
- 中期 intelligence network 骨架：基本成立。
- 后端完成度：不要用本文估算；以 [backend-completion-criteria.md](./backend-completion-criteria.md) 的十个 gate 为准。
- 可展示研究体验：NVIDIA / SEC / Apple supplier / research-pack / ChainView / source monitor / risk baseline 已可展示；还不是大规模全球覆盖。

## 建议开源发布语

> SupplyStrata is an alpha TypeScript monorepo for building an evidence-backed public supply-chain intelligence network. It includes a working SEC/NVIDIA slice, Apple supplier-list review workflow, Postgres truth store, Neo4j materialized graph, ChainView / research-pack exports, source-check worker baseline, and deterministic risk/intelligence context. It is not an investment advice system and does not redistribute raw source documents.

## 发布后的第一批 issue

- `good first issue`: add docs for one CLI command with example output.
- `good first issue`: add source adapter README for an existing adapter.
- `help wanted`: expand official disclosure coverage toward backend Gate 1.
- `help wanted`: add claim fusion fixtures and conflict handling.
- `help wanted`: add API contract tests.
- `help wanted`: expand observation source contract tests.
- `help wanted`: harden performance / integration baseline.
- `help wanted`: evidence offset / fingerprint migration plan.
