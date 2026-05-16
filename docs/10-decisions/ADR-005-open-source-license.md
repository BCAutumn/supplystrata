# ADR-005 — Open Source License

- **Status**: accepted
- **Date**: 2026-05-16
- **Deciders**: 项目维护者
- **Context window**: Phase 2；影响公开发布、贡献、下游集成

## Context

SupplyStrata 计划作为开源项目发布。仓库包含 TypeScript 代码、项目维护的 seed metadata、文档与测试；不应包含第三方原始 PDF/HTML/API 响应。

许可证需要满足：

- 允许商业和非商业使用。
- 对下游 agent / 桌面端 / API 产品友好。
- 对贡献者和使用者有清晰专利授权边界。
- 不把第三方数据源的许可误传递为我们的许可。

## Options Considered

### Option A: MIT

- 优点：极简，生态熟悉。
- 缺点：没有显式专利授权；对 AI/data infra 项目的公司采用略弱。

### Option B: Apache-2.0

- 优点：宽松开源；含专利授权；公司采用友好；适合基础设施项目。
- 缺点：文本更长；需要保留 NOTICE。

### Option C: GPL / AGPL

- 优点：强 copyleft，防止闭源再分发。
- 缺点：会显著降低下游集成意愿；不适合当前“嵌入其他 agent/桌面端产品”的目标。

## Decision

选择 **Apache License 2.0**。

理由：

- 本项目目标是成为可嵌入、可扩展的供应链证据基础设施，宽松许可更合适。
- Apache-2.0 的专利授权比 MIT 更稳。
- 与未来商业/非商业下游使用兼容。

## Consequences

### Positive

- 开源边界清晰。
- 下游可以安全集成。
- 贡献默认按 Apache-2.0 授权。

### Negative / Trade-offs

- 需要维护 `LICENSE` 和 `NOTICE`。
- 需要文档明确：第三方数据源不随代码许可重新授权。

### Risks We Accept

- 下游可以闭源使用本项目代码。

### Risks We Mitigate Now

- `NOTICE` 明确第三方原始数据不在仓库许可范围内。
- `.gitignore` 排除 `data/`、`reports/`、`.env`。
- `SECURITY.md` 明确不提交密钥和原始数据。

## Implementation Notes

- 根目录加入 `LICENSE` 和 `NOTICE`。
- 根 `package.json` 标注 `"license": "Apache-2.0"`。
- `docs/09-risks-compliance/data-licenses.md` 同步 license 决策。

## Revisit Triggers

- 项目要发布结构化数据集，而不只是代码。
- 下游必须采用强 copyleft。
- 法律顾问要求换 license。

## References

- [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
- [data-licenses.md](../09-risks-compliance/data-licenses.md)
