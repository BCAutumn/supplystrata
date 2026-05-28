# @supplystrata/source-adapter-runtime

`source-adapter-runtime` 是 source adapter 的运行时基础设施。

## 负责什么

- 创建 adapter context。
- 提供 rate limiter。
- 提供 HTML snapshot adapter 模板。
- 提供文件系统 snapshot store。
- 支持 fetch 失败时读取本地缓存快照，并保留 `source_fetch_status`。

## 不负责什么

- 不定义来源权威。
- 不保存 source check job。
- 不抽取 observation 或 fact edge。
- 不替代 source-management 的 target config 校验。

## 主要入口

- `createRateLimitedSourceAdapter(adapter, limiter)`：给 adapter 加限速。
- `fetchBytesWithTimeout(url, options)`：统一 GET/POST 抓取、超时、可选 retry/backoff 和错误归一。
- `defineHtmlSnapshotAdapter(definition)`：定义 HTML snapshot adapter。
- `createFsSnapshotStore(baseDir)`：创建本地 snapshot store。
- `createAdapterContext(input)`：构造 adapter context。

## 边界约定

runtime 可以处理抓取、缓存和限速，但不能判断数据是否足够可信。source_fetch fallback 只能表示来源退化，不是成功验证。
