# @supplystrata/entity-resolver

`entity-resolver` 是实体消歧接口和实现包。

## 负责什么

- 定义 `EntityResolver` 接口。
- 通过 DB alias / identifier 解析实体。
- 通过 seed CSV 解析实体，用于本地和测试路径。
- 处理少量 curated special entity 规则。

## 不负责什么

- 不导入新实体。
- 不写 `entity_master` 或 `entity_alias`。
- 不抓取外部登记源。
- 不把模糊匹配自动当作高置信事实。

## 主要入口

- `DbEntityResolver`：基于 truth store 的实体解析。
- `SeedEntityResolver.fromCsv(rootDir)`：基于 seed CSV 的实体解析。
- `resolve(input, context)`：统一解析接口。

## 边界约定

实体消歧必须先于关系写入。低置信或多义结果应进入 review / pending entity，不应靠调用方临时补丁绕过。
