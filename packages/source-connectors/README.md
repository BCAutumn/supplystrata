# @supplystrata/source-connectors

`source-connectors` 定义 source check connector 的统一接口、能力声明和 target config 校验。

## 负责什么

- 定义 `SourceCheckConnector`、target row、run context、config schema 和 credential requirements。
- 生成 connector key 和 capability 列表。
- 按 target 匹配并运行 connector。
- 校验 source check target config。

## 不负责什么

- 不实现具体来源抓取。
- 不保存 job 状态。
- 不读取凭据值。
- 不写 observation、evidence 或 fact edge。

## 主要入口

- `runSourceCheckConnector(store, target, connectors, context)`：运行匹配 connector。
- `listSourceCheckConnectorCapabilities(connectors)`：导出能力声明。
- `validateSourceCheckTargetConfig(input)`：校验 target config。
- `connectorKey(input)`：稳定 connector id。

## 边界约定

connector capability 是 source-management 和 future UI 的配置契约。新增 connector 必须声明 target kind、config schema 和 credential requirements，避免 CLI 侧硬编码。
