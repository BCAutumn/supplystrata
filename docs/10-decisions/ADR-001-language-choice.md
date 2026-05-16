# ADR-001 — 主语言选择：TypeScript + Python sidecar

- **Status**: accepted
- **Date**: 2026-05-16
- **Deciders**: 项目维护者
- **Context window**: Phase 0；影响所有 packages 的实现选择

## Context

项目要做：

- 多个 source adapter（HTTP、HTML、PDF、CSV、XBRL）
- 实体消歧、关系抽取（含 LLM 调用）
- 关系图谱（Neo4j）+ 元数据 (Postgres) + 对象存储
- CLI（短期）+ REST API（长期）

候选主语言：TypeScript / Python / Go / Rust。

## Options Considered

### Option A: 全 TypeScript

- 优点：
  - LLM SDK / Web / DB ORM / CLI 工具链统一
  - 类型系统强且现代，研究类项目最害怕 silent failure
  - monorepo 工具链成熟（pnpm workspaces）
  - 单语言降低维护负担
- 缺点：
  - XBRL 处理工具弱（arelle 是 Python 事实标准）
  - 复杂 PDF / 表格抽取生态不如 Python（pdfminer.six / camelot）
  - spaCy / 经典 NLP 在 Python 更顺手

### Option B: 全 Python

- 优点：
  - XBRL / PDF / NLP 生态强
  - 工程师上手快
- 缺点：
  - 类型系统较弱（即使有 mypy / pydantic）
  - 复杂 monorepo 不如 TS / pnpm 顺
  - Web / API 生态不如 TS 现代化
  - Drizzle / Neo4j 等现代 ORM 体感差

### Option C: 全 Go

- 优点：
  - 性能、编译产物
- 缺点：
  - LLM / NLP / PDF 生态弱
  - 研究类项目 dev velocity 差
  - 团队学习成本

### Option D: TS 主 + Python sidecar

- 优点：
  - TS 享受类型 / 工具链 / 生态优势
  - Python 处理 XBRL / 复杂 PDF / 经典 NLP 等专项
  - 接口边界清晰（stdin/stdout JSON Lines / 本地 HTTP）
  - 增量演进：MVP 阶段甚至可以不上 Python sidecar
- 缺点：
  - 多语言团队 / 维护成本
  - 进程间通信增加复杂度
  - 沙箱化与错误传播需要细心设计

## Decision

选择 **Option D：TypeScript 主栈 + Python sidecar（仅在必要时引入）**。

具体策略：

- **MVP 阶段（Phase 0-2）**：纯 TypeScript。
  - XBRL：仅消费 SEC `company-facts` JSON，不解析完整 XBRL
  - PDF：用 pdfjs-dist；遇到困难 PDF 强制走 manual review
- **Phase 3 起**：根据需要引入 Python sidecar
  - 优先解决 XBRL 完整解析（arelle）
  - 其次解决复杂 PDF / 表格（pdfminer / camelot）
  - 接口为 JSON Lines over stdio，TS 端封装 promise API

## Consequences

### Positive

- 工具链统一，monorepo / lint / type-check 一致
- LLM / Web / DB / CLI 全套生态享受 TS
- 增量决策：不会被强制上 Python，只有真需要时才引入

### Negative / Trade-offs

- MVP 阶段对 XBRL 的能力是阉割版（只 JSON facts，不解析完整 instance + taxonomy）
- 复杂 PDF（如 Apple Supplier List）需要走半自动 + 人工 review
- Python sidecar 上线后 dev/ops 复杂度增加

### Risks We Accept

- MVP 不能完整解析所有 SEC XBRL filings 的财务细节（这本身不是 MVP 的目标）
- 个别复杂 PDF 表格需要人工录入

### Risks We Mitigate Now

- 抽象 `parsers/xbrl/` 接口先建好，未来切换 sidecar 实现不需改调用方
- 半自动流程的 CLI 命令在 MVP 中实现

## Implementation Notes

- `packages/parsers/xbrl/` 接口：
  ```ts
  interface XbrlParser {
    readCompanyFacts(cik: string): Promise<CompanyFacts>;
    parseInstance?(path: string): Promise<XbrlInstance>; // 可选，Phase 3 起
  }
  ```
- `sidecars/xbrl-py/` 目录在 Phase 3 起出现
- 通信协议：JSON Lines via stdio，每行一个请求 / 响应
- 失败降级：sidecar 不可用时，TS 端不 crash；标 `xbrl_parse_status = "skipped_sidecar_unavailable"`

## Revisit Triggers

- Phase 3 启动时
- 出现 TS 单栈无法处理的 XBRL / PDF / NLP 任务，且影响 P0 / P1 数据源的接入
- 团队成员能力发生变化（如增加 Python 专家）

## References

- [tech-stack.md](../02-architecture/tech-stack.md)
- [parsing.md](../05-modules/parsing.md)
