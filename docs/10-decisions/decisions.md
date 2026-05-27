# Decisions — 架构决策摘要

本文合并当前仍有效的 ADR。旧的逐条 ADR 文件已经删除，避免文档数量膨胀；如需改变下面任何决策，直接更新本文并在变更说明里写清楚原因。

## 1. 主语言：TypeScript 主栈，Python 仅作必要 sidecar

决策：

- 默认使用 TypeScript、pnpm workspaces、strict TS。
- XBRL ZIP、复杂 PDF、表格抽取等确有必要时再引入 Python sidecar。
- sidecar 必须通过清晰 IPC contract 接入，不能把 Python 变成第二套业务系统。

理由：

- 供应链情报系统更怕 silent failure，TypeScript 类型边界更适合当前阶段。
- Web/API/CLI/LLM SDK/DB tooling 统一。
- Python 在 XBRL/PDF/NLP 生态上保留为专项能力。

## 2. 存储：Postgres truth store + GraphStore materialized view

决策：

- Postgres 是单一事实来源，保存 entity、document、evidence、edge、claim、observation、unknown、job、audit。
- GraphStore 是可重建的图谱当前态视图；内置 adapter 是 Neo4j。
- 写入先提交 Postgres，再投影 GraphStore；投影失败可重试或重建。

理由：

- 证据、审计、队列和历史更适合 Postgres。
- 多跳探索和图可视化更适合专业图库。
- 双存储的复杂性通过“GraphStore 可重建”控制。

## 3. LLM 策略：规则优先，LLM 只读/候选/兜底

决策：

- 当前默认不开内部 AI。
- 规则和官方结构化来源优先。
- LLM 只能产生候选或只读解释，不能写 fact edge。
- LLM 抽取必须有 cite text、schema 校验、prompt/model 版本记录、`needs_review=true`。
- LLM 永远不能产生 Level 5。

当前边界：

- 内部 AI 是 analyst layer，不是 agent。
- 外部 AI 只读消费 API，不提供回写接口。
- 不做 unknown-driven 自动联网调查 agent。

## 4. Monorepo：pnpm workspaces

决策：

- 保持单仓库。
- package 按 domain / feature 边界拆分，但不再为了“看起来干净”继续细拆。
- 新 package 必须证明生命周期、职责和依赖方向独立。
- package README 是模块细节的主要载体，`docs/` 不再保存模块长文档。

## 5. License：Apache-2.0

决策：

- 代码、文档、项目维护 seed metadata 使用 Apache-2.0。
- 第三方原始数据、商业网站内容、API 响应不随仓库授权。
- `data/`、`reports/`、`.env` 保持本地。

## 6. 队列：Postgres-backed durable jobs

决策：

- 当前 source monitor 使用 `source_check_jobs`。
- 不引入 pg-boss、Redis 或 Kafka。
- job 必须有 lease、retry/backoff、dead 状态和可审计 source change events。

## 7. API：先 contract，再 HTTP adapter

决策：

- `apps/api` 当前是 Gate 8 contract boundary。
- OpenAPI / DTO / route registry 先稳定，再接 HTTP runtime。
- API DTO 不能泄漏 DB Row。
- 外部 AI / 外部 app 只能读，不提供证据或候选回写接口。
