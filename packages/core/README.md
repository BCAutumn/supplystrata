# @supplystrata/core

`core` 是全项目共享的领域契约包。它定义供应链情报系统的基础语言：实体、关系、证据等级、语义层、观测、lead、claim、risk、alert 和通用 ID/归一化函数。

## 负责什么

- 定义跨包共享的稳定类型、枚举和轻量纯函数。
- 统一 evidence level、relation type、semantic layer、observation type、claim status 等领域词汇。
- 提供无副作用的基础能力，例如 ID 创建、alias 归一化、edge freshness 计算。

## 不负责什么

- 不访问数据库、文件、网络或环境变量。
- 不放业务编排。
- 不放 package 专属 DTO 或 DB row。
- 不成为临时类型、工具函数或杂项能力的收容处。

## 边界约定

只有多个领域都稳定共享、且生命周期足够长的概念才进入 `core`。如果类型只服务某个 feature，应留在对应 package 的 definitions 中。
