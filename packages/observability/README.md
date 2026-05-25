# @supplystrata/observability

`observability` 是日志接口和错误消息归一化的基础包。

## 负责什么

- 定义 `SupplyStrataLogger` 窄接口。
- 提供 `noopLogger`，让库层默认无副作用。
- 在 app 顶层按环境创建 pino logger。
- 把 unknown error 转成稳定 message。

## 不负责什么

- 不在导入时读取 `.env`。
- 不强制所有库使用全局 logger。
- 不做业务指标、trace 或告警策略。

## 主要入口

- `noopLogger`：库层默认 logger。
- `createLogger(env)` / `createLoggerFromEnv()`：app 顶层创建 logger。
- `setLogger(logger)` / `getLogger()`：显式设置和读取默认 logger。
- `messageFromUnknown(error)`：错误消息归一化。

## 边界约定

库代码优先通过 options/context 注入 logger。`getLogger()` 只能作为应用层便利入口，不应成为隐藏依赖。
