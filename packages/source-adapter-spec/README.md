# @supplystrata/source-adapter-spec

`source-adapter-spec` 是外部 source adapter 的最小协议定义。

## 负责什么

- 定义 `SourceAdapter<TFetchInput, TRawDoc>`。
- 定义 `plan -> fetch -> normalize` 三段式 adapter 生命周期。
- 定义 adapter context、snapshot store 和 rate limit 结构。
- 校验 rate limit 参数。

## 不负责什么

- 不实现 HTTP、缓存或文件系统。
- 不保存数据库。
- 不知道 source check job。
- 不解释 normalized document 的业务含义。

## 边界约定

adapter spec 只描述技术协议。具体来源实现应放在 source workflow 或 source package 中，业务持久化应由 pipeline / source-monitor 承接。
