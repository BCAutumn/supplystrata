# Testing Strategy — 测试策略

研究类系统最容易翻车的不是性能，而是**数据质量**与**回归**。本文给出测试分层与必备测试。

## 测试分层

```
1. 单元测试 (unit)         — 纯函数 / 类
2. 契约测试 (contract)     — adapter / repo / parser 输出符合 schema
3. 数据快照 (snapshot)     — parser / extractor 输出
4. Golden Set              — Entity Resolver / 重要 rule extractor
5. 端到端 (e2e)            — 一条命令链跑通
6. 回归 (regression)       — 历史 bug 各自一份
```

## 工具

- `vitest`：单元 + 契约 + 快照
- `tsx`：脚本与 e2e fixture loader
- `nock` 或本地 fixture loader：HTTP mock
- `pg-mem` **不**用（行为与真实 PG 不同）；测试连接真实 docker postgres

## 单元测试

### 必须 100% 覆盖的模块

- `packages/core` 中的 IDs / zod schema
- `packages/evidence-scorer`（纯函数 + 关键的算法）
- `packages/entity-resolver` 的核心算法层（不含 LLM）

### 一般覆盖

- 其它 packages 关键路径覆盖率 ≥ 85%

## 契约测试

每个 source adapter：

```
tests/contract/sec-edgar.contract.test.ts
  - plan() 输出每条 task 通过 zod
  - normalize() 输出通过 zod
  - 必填字段非空
```

每个 parser：

```
tests/contract/parsers/html.contract.test.ts
  - 输出 chunks 满足 chunk schema
  - locator 非空
  - text 经 NFKC + 行终止统一
```

每个 repo：

```
tests/contract/repos/evidence.contract.test.ts
  - insert / find / supersede 行为
  - 事务原子性
```

## 数据快照测试

用真实下载的样本（脱敏后）放 `tests/fixtures/`：

```
tests/fixtures/sec-edgar/
├── nvidia-10k-2025.html           真实文件
├── nvidia-10k-2025.expected.json  期望的 NormalizedDocument 截取
└── ...
```

测试：

- 跑 fetch+normalize+extract，对照 expected
- 任何 diff → 必须在 PR 显式更新 expected

## Golden Set

### Entity Resolver

`tests/golden/entity-resolver/`：

- ≥ 200 条 `(surface, context, expected_entity_id)` 样本
- 持续扩充
- 准确率指标：`resolved_correct / (resolved_total + ambiguous_total)` ≥ 99%
- false-merge 率：`(应该是 ambiguous 但 resolved) / total` ≤ 1%

CI 跑全集；任意一条 regression 直接 fail。

### Rule extractors

每条 rule extractor:

- ≥ 3 positive
- ≥ 3 negative
- ≥ 1 edge case

### LLM extractors

- 一组冻结 prompt（hash 入仓）
- 用 ≥ 50 条样本回归
- 每次 prompt / 模型升级 → 重跑 + 人工 review diff

## E2E 测试

当前开源 alpha 提供两个手动 smoke 入口，作为正式 `tests/e2e` 补齐前的环境自检：

```bash
pnpm smoke:local
pnpm smoke:network
```

`smoke:local` 不访问外网，只验证 migration、seed、Neo4j rebuild 和 graph check。`smoke:network` 额外跑 SEC/NVIDIA 联网切片，并断言 company 输出包含 evidence、unknown map 至少 5 项。

这两个脚本不是 CI 的完整 e2e 替代品；正式 e2e 仍应使用 fixture，避免把 SEC 网络可用性变成合并门禁。

当前已补第一条 fixture e2e：

```bash
pnpm test:e2e
```

它使用 `tests/fixtures/sec-edgar/nvidia-10k-supply-chain-mini.html`，不访问外网，验证 HTML parser → rule extractor → evidence scorer → GraphBuilder apply → Neo4j rebuild/check → CompanyCard/UnknownMap render 全链路。

`tests/e2e/full-pipeline.test.ts`：

```
1. docker-compose up postgres + neo4j (test 配置)
2. pnpm db:migrate
3. pnpm cli admin seed
4. 加载 SEC fixture (NVIDIA 10-K) 到 manual ingestion
5. pnpm cli parse / extract / score / apply
6. pnpm cli company nvidia --depth 1 --format json
7. 校验输出含 ≥ 3 条 Level 5 边 (foundry / memory)
8. 校验所有 EV-xxx 在 Postgres 中查得到
9. supplystrata graph rebuild → 节点 / 边数对得上
```

CI 跑（带 docker）。

## 回归测试

每发现一个真实 bug：

- 在 `tests/regression/<bug-id>.test.ts` 加一条
- bug 修复后该测试必须长期通过
- 不删除历史回归用例

## 数据质量回归

每月或每次接入新数据源后跑：

- 实体合并健康度（重复 alias / 孤儿实体扫描）
- 边一致性（Postgres vs Neo4j）
- evidence 完整性（cite_text >= 30 chars / source_url 可访问）
- ChangeRecord 与 edges 对账

详见 [data-quality.md](../07-operations/data-quality.md)。

## CI 流水线

```
job: lint
  - pnpm lint
  - pnpm prettier --check

job: type-check
  - pnpm type-check

job: test-unit
  - pnpm test:unit

job: test-contract
  - pnpm test:contract (含轻量 docker postgres)

job: test-snapshot
  - pnpm test:snapshot

job: test-golden
  - pnpm test:golden

job: test-e2e
  - postgres + neo4j service
  - pnpm test:e2e（fixture，不访问 SEC 外网）

job: dep-check
  - pnpm dep-check (dependency-cruiser)

job: schema-roundtrip
  - 跑 forward / backward / forward 迁移
```

任一 job fail → 阻塞合并。

## 不在测试里做的事

- 不测试外部 API 真实可用性（避免外网依赖）
- 不在 unit / contract 中调真 LLM
- 不在 CI 中跑真 ingestion（仅 fixture）
- 不写无 assertion 的 "smoke" 测试

## Test Hygiene

- 任何 PR 加新代码必须配测试
- 任何 bug fix PR 必须配回归测试
- 任何 schema / 接口变更必须配 migration test
- `--retries` 不允许（不稳定的测试必须修，不靠重试）
