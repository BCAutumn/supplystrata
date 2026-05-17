# Coding Standards — 编码规范

只列与本项目特别相关的部分。一般 TS / Node 规范沿用社区惯例。

## TS 配置

`tsconfig.base.json` 已经在 [tech-stack.md](../02-architecture/tech-stack.md) 给出。每个包的 `tsconfig.json` 必须 `extends` 这一份。

不允许：

- `// @ts-ignore` 不写理由
- `as any` / `any` / `unknown as T` 这类绕过类型系统的写法
- `any` 出现在任何源码、测试或文档示例代码中
- 使用 `unknown` 之后不进行 narrow

## 命名约定

| 类型           | 规则                                       | 例                                           |
| ------------ | ---------------------------------------- | ------------------------------------------- |
| ID prefix    | 全大写连字符                                   | `ENT-`, `EV-`, `EDGE-`, `DOC-`, `CHK-`, `CHG-`, `REV-`, `PND-`, `UNK-`, `ALIAS-` |
| 包名           | `@supplystrata/<kebab>`                  | `@supplystrata/sources-sec-edgar`           |
| 文件名          | kebab-case + `.ts`                       | `entity-resolver.ts`                        |
| Class        | PascalCase                              | `EvidenceScorer`                             |
| Interface    | PascalCase（不要前缀 `I`）                     | `SourceAdapter`                              |
| Type alias   | PascalCase                              | `RelationType`                               |
| 常量           | SCREAMING_SNAKE                         | `MAX_LLM_CHUNKS`                             |
| 枚举字符串字面量    | 用字符串 union 而非 enum                       | `type Status = "ok" \| "fail"`               |
| 测试文件         | `<src>.test.ts` 或 `tests/...`           |                                             |
| Fixture      | `tests/fixtures/<topic>/<name>.<ext>`    |                                             |

## 模块导出

- 每个包 `src/index.ts` 是唯一对外入口
- 内部文件不被外部 import（CI 校验）
- export 的类型 / 函数附 JSDoc，描述参数与不变量
- 代码文件接近 700 行时必须先拆职责再继续加功能；CLI 命令注册、渲染、参数解析、DB schema 不应混在一个文件里。

当前 MVP 的边界：

- `apps/cli/src/main.ts`：只注册命令、连接 handler，不放大段渲染逻辑。
- `apps/cli/src/preview-render.ts` / `source-render.ts` / `entity-render.ts` / `review-render.ts`：只负责 CLI 展示。
- `apps/cli/src/cli-utils.ts`：只负责参数解析、输出、DB pool 生命周期。
- `packages/db/src/migration-sql/*.ts`：只放 PostgreSQL DDL；运行时查询留在 `packages/db/src/*` 的职责文件中。

## 函数 / 方法

- 单函数行数硬限 80（不含空行注释）
- 单方法参数 ≤ 4；超过用对象参数
- async 函数必须 await（禁止悬空 Promise）
- 不允许默认导出（除了 React 组件这类——本项目无）

## 不变量与异常

- **预期错误**用返回 `Result<T, E>`（要么沿用 `neverthrow`，要么自定义；选 ADR）
- **真正的不变量违反**才抛异常
- 所有异常类继承自项目根的 `BaseError`，含 `code` 字段

## 日志

```ts
import { logger } from "@supplystrata/core/logger";

logger.info({ stage: "ingest", task_id, doc_id }, "ingest task ok");
logger.warn({ ... }, "...");
logger.error({ err }, "...");                // err 必须是 Error 或带 stack 的对象
```

不允许 `console.log` 进生产代码（CI 校验）。

## 配置 / 环境变量

- 所有 env 由 `packages/core/config` 集中读
- 用 zod schema 校验（类型 + 必填）
- 不允许散落 `process.env.XXX`

`packages/core/config/env.ts`（示例）：

```ts
const Env = z.object({
  POSTGRES_URL: z.string().url(),
  NEO4J_URI: z.string(),
  NEO4J_USER: z.string(),
  NEO4J_PASSWORD: z.string(),
  OBJECT_STORE: z.enum(["fs", "minio"]).default("fs"),
  OBJECT_STORE_FS_BASE: z.string().default("./data/raw"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  LLM_PROVIDER: z.enum(["anthropic", "openai", "none"]).default("none"),
  LLM_RESOLVER_ENABLED: z.coerce.boolean().default(false),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});
export const env = Env.parse(process.env);
```

启动时 fail-fast：env 不合法直接退出。

## 注释风格

- 不写"代码做什么"的废话注释
- 写"为什么"和"约束 / 不变量"
- 公开 API 的 JSDoc 必须含示例（如适用）

反例：

```ts
// 增加计数
counter += 1;
```

正例：

```ts
// 必须在写 Postgres 之后再写 Neo4j；否则一致性校验任务无法识别孤儿。
await graph.upsertEdge(edge);
```

## 提交前自检

每个 PR 跑：

```
pnpm lint
pnpm type-check
pnpm test
pnpm dep-check         # dependency-cruiser
pnpm db:check          # 迁移 forward+back 测试
```

任意失败 → 不允许合并。

## 第三方库

新增依赖必须 PR 标 `[deps]`，并且：

- 在 PR 描述里说明替代品对比
- 不引入弃用 / 长期未维护的库
- 不引入 license 不兼容的库（GPL / AGPL 等需走法律审查）

## API / Schema 变更

- 任何 zod schema 修改 → 对应 schema_version bump
- 任何 DB schema 修改 → 新 migration
- 任何 ChangeRecord 字段修改 → 反向兼容必须 6 个月

## 私密数据

- 不允许把 API key / 密钥进仓
- `.env` 入 `.gitignore`
- `.env.example` 入仓（含变量名 + 注释 + 类型）
- pre-commit hook 跑 `git-secrets` 或类似扫描

## 性能预算

- 任何模块的"快路径"在 PR 描述中标 expected p95 latency
- 慢路径（cron / housekeeping）允许长，但要可中断 + 进度可观测
