# @supplystrata/runtime-profile

`runtime-profile` 描述当前运行环境可支持哪些 SupplyStrata 模式。

## 负责什么

- 生成 preview、workbench snapshot、truth store、graph projection 四种运行模式的 doctor report。
- 区分无需 Docker 的静态/预览路径和需要外部服务的 truth store / graph projection 路径。
- 给 CLI、安装向导和未来 host app 提供同一套运行形态判断。

## 不负责什么

- 不读取文件。
- 不连接数据库。
- 不启动 Docker 或服务。
- 不执行 source check 或 research pack。

## 主要入口

- `buildRuntimeDoctorReport(input)`：生成完整报告。
- `runtimeModes(input)`：生成模式列表。

## 边界约定

runtime-profile 只做纯判断。实际检查文件、数据库或服务可达性应在 CLI/app 层完成后传入结果。
