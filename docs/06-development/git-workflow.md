# Git Workflow — 分支策略 & 提交规范

简单优先。本项目目前是一人或小团队工作，不上复杂 GitFlow。

## 分支模型

```
main            稳定分支；CI 必须全绿；任何代码都从 PR 合入
feature/*       常规功能 / 修复
docs/*          仅文档变动
adapter/*       新数据源接入
data/*          seeds / golden set 改动
chore/*         杂项 / 依赖升级
hotfix/*        紧急修复
```

不允许直推 main。

## 提交规范（Conventional Commits）

```
<type>(<scope>): <subject>

<body>

<footer>
```

type 取值：

- `feat`：新功能
- `fix`：修 bug
- `docs`：文档
- `chore`：杂项
- `refactor`
- `perf`
- `test`
- `build`
- `ci`
- `data`：seeds / golden set 改动
- `adapter`：新数据源
- `schema`：DB / zod schema 变更（必须配 migration）

scope 例：`sources/sec-edgar`、`extractor/rule`、`evidence-scorer`、`docs/04-data-sources`。

例：

```
feat(sources/sec-edgar): implement plan() and fetch() with rate limit

- Add tokenBucket helper
- 5 fixture tests pass
- Updated source-registry.md
```

```
schema(db): add macro_signals table

- Migration 003_macro_signals.sql + .down.sql
- 更新 packages/db/repos/macro-signals.repo.ts
- Bump schema_version to 1.1.0
```

主旨行：

- 不超过 72 字符
- 现在时（"add" 而非 "added"）
- 首字母小写
- 不带句号

## PR 规范

每个 PR 必须包含：

1. **Title**：与 commit subject 同样的格式
2. **Description**：
   - 改动概要
   - 为什么改（链接 issue / ADR）
   - 验证方式（命令、截图）
   - Checklist（按 PR 模板）
3. **Reviewer**：至少 1 人（一人项目阶段允许 self-merge，但仍要走 CI）
4. **Linked issue**：如有

### PR Checklist 模板

```
- [ ] 代码 lint / type-check / test 全绿
- [ ] 覆盖率不下降
- [ ] 涉及 schema 变更已加 migration（含 down）
- [ ] 涉及 zod schema 变更已 bump schema_version
- [ ] 涉及 LLM prompt 变更已 freeze prompt hash
- [ ] 文档更新
- [ ] 涉及新数据源已更新 source-registry.md + legal-tos.md
- [ ] 涉及新 ADR 已挂 docs/10-decisions/
- [ ] 没有 console.log / TODO 残留（除显式 issue 链接）
```

## 合并方式

- 优先 **squash merge**（一个功能 = 一个 commit 进 main）
- 长期分支才用 merge commit
- 不用 rebase merge（保留 PR 边界）

## Tag 与 Release

MVP 阶段不 release。可以打 dev tag：

```
git tag dev-YYYY-MM-DD-<short>
```

但不发包。

正式 release 等 Phase 3 之后讨论。

## 分支保护规则（GitHub）

- main 必须 PR 合入
- 必须 ≥ 1 review approval（一人项目阶段可关闭，但保留设置）
- 必须 CI 全绿
- 不允许 force push 到 main
- 不允许删除 main

## Hotfix 流程

紧急修复（如 ingestion 跑飞了把队列打爆）：

1. `hotfix/xxx` 从 main 拉
2. 改最小集
3. PR + 自我 review
4. squash merge
5. 在仓库 `docs/06-development/incidents.md` 写 postmortem（即使是个人项目也写）

## 代码归属

- 仓库根 `LICENSE` 决定（默认建议 MIT 或 Apache 2.0；最终 ADR 待定）
- 第三方数据归原所有人，**不**重新发布。仓库只发代码与 schema

## Git Hygiene

- `.gitattributes` 控制行尾（LF）
- `.gitignore` 排除：
  - `node_modules`
  - `data/raw/`
  - `data/pg/`
  - `data/neo4j/`
  - `data/minio/`
  - `data/backups/`
  - `.env`
  - 各 IDE 临时文件
- 大文件（> 5 MB）禁止入仓；用 ObjectStore + Git LFS（如必要）

## Commit 历史诚实度

- 不在 commit message 里夸大改动
- 不留 "fix" / "wip" 这种空内容（应当 squash 掉）
- 不删历史（除非泄密）

不要留无意义的"WIP"或"trying things"在 main 历史中。
