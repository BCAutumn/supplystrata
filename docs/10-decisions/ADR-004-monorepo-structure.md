# ADR-004 — Monorepo 结构：pnpm workspaces

- **Status**: accepted
- **Date**: 2026-05-16
- **Deciders**: 项目维护者
- **Context window**: Phase 0；影响整个仓库的物理布局

## Context

需要在一个仓库里管：

- 多个 source adapter（每个一个包）
- 共享 core 类型 / schema
- 业务模块（parsers / extractor / scorer / graph-builder / 等）
- 应用（cli / worker / future api）
- Python sidecar（独立子目录）

工具候选：

- pnpm workspaces
- npm workspaces
- yarn (Berry) workspaces
- Nx
- Turborepo
- Lerna

## Options Considered

### Option A: pnpm workspaces (+ optional Turborepo for task pipeline)

- 优点：
  - pnpm 安装快、磁盘占用少（symlink 内容寻址）
  - workspace protocol (`workspace:*`) 表达内部依赖清晰
  - 与 TS / vitest / drizzle 等生态兼容好
  - Turborepo 可作 task graph + cache（可选）
- 缺点：
  - 高级 monorepo 功能（boundaries / generators）需要额外自写

### Option B: Nx

- 优点：
  - 一站式 monorepo（task graph、boundaries、generators）
  - 适合大团队
- 缺点：
  - 学习曲线
  - 偏向 Angular / React 生态
  - 对单仓 / 一人项目偏重

### Option C: 多仓库 + 私有 npm registry

- 优点：每个 package 完全独立
- 缺点：
  - 一人 / 小团队的协调成本太高
  - 跨仓 PR 麻烦
  - 与"高内聚低耦合"目标不矛盾，但工程成本不必要

### Option D: 单包仓库

- 优点：超简单
- 缺点：违反 source adapter 必须独立 package 的约束（详见 [extensibility.md](../02-architecture/extensibility.md)）

## Decision

选择 **Option A：pnpm workspaces，Turborepo 作可选 task pipeline**。

## 物理布局

```
supplystrata/
├── package.json                 root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── turbo.json                   可选
├── docker-compose.yml
├── .env.example
├── .editorconfig
├── .gitignore
├── .gitattributes
├── docs/
├── seeds/
├── data/                        gitignored
├── packages/                    所有库
│   ├── core/
│   ├── db/
│   ├── graph/
│   ├── object-store/
│   ├── source-adapter-spec/
│   ├── parsers/
│   │   ├── html/
│   │   ├── pdf/
│   │   ├── xbrl/
│   │   ├── csv/
│   │   ├── excel/
│   │   └── text/
│   ├── entity-resolver/
│   ├── relation-extractor/
│   │   ├── rule/
│   │   ├── llm/
│   │   └── corroborator/
│   ├── evidence-scorer/
│   ├── graph-builder/
│   ├── llm-bridge/
│   ├── pipeline/
│   ├── render/
│   └── sources/
│       ├── sec-edgar/
│       ├── company-ir/
│       │   ├── tsmc-ir/
│       │   ├── samsung-ir/
│       │   ├── skhynix-ir/
│       │   ├── asml-ir/
│       │   └── ...
│       ├── apple-suppliers/
│       ├── opencorporates/
│       └── companies-house/
├── apps/                        可执行
│   ├── cli/
│   └── worker/
├── sidecars/                    Python（Phase 3 起）
│   └── xbrl-py/
└── tests/                       e2e / fixtures / golden
    ├── e2e/
    ├── fixtures/
    └── golden/
```

## 命名约定

- 包名：`@supplystrata/<kebab>`
  - core → `@supplystrata/core`
  - sources/sec-edgar → `@supplystrata/sources-sec-edgar`
  - parsers/html → `@supplystrata/parsers-html`
- 文件名：kebab-case
- 内部依赖通过 `workspace:*`

## 依赖方向（CI 校验）

`dependency-cruiser` 配置必须实现：

```
core            ← *
db              ← pipeline / repos consumers only
graph           ← graph-builder / render only
object-store    ← sources / parsers (read) / pipeline
source-adapter-spec ← sources/* / pipeline only
parsers/*       ← sources/* / relation-extractor
sources/*       ← pipeline only
relation-extractor ← pipeline only
entity-resolver ← sources/* / extractor / graph-builder / pipeline
evidence-scorer ← graph-builder
llm-bridge      ← extractor.llm / entity-resolver
render          ← apps/cli only
```

任何反向 / 非法依赖：CI 红灯。

## 共享 tsconfig

`tsconfig.base.json`（已在 [tech-stack.md](../02-architecture/tech-stack.md) 给出）。每个包：

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

## Build / Task pipeline

- Turborepo 配置 `build` / `test` / `lint` / `type-check` 任务
- Cache 由 Turborepo 管（本地）
- 不上 Turborepo Cloud（隐私 / 成本）

## Consequences

### Positive

- 包边界清晰
- 一处改动 → CI 只跑相关包
- 内部依赖通过 `workspace:*`，不发包也能联调

### Negative / Trade-offs

- 一人项目下，monorepo 的好处不立竿见影
- 仍需写 dependency-cruiser 配置 + maintain
- 增加新包时 boilerplate 较多

### Risks We Accept

- 早期 boilerplate 成本

### Risks We Mitigate Now

- 写一个 package 模板（`packages/_template/`）方便复制
- pnpm-workspace.yaml 用 glob 匹配：`packages/*`、`packages/sources/**`

## Revisit Triggers

- pnpm workspaces 出现严重问题（极少发生）
- 项目规模激增需要 Nx 那种功能
- 发现 Turborepo 限制

## References

- [tech-stack.md](../02-architecture/tech-stack.md)
- [extensibility.md](../02-architecture/extensibility.md)
- [module-design.md](../02-architecture/module-design.md)
