# @supplystrata/source-management

`source-management` 是 source-plan 到持续监控配置之间的管理面。它把计划转换成稳定的 source policy / source check target 配置，并在写库前提供可审计预览和校验。

## 负责什么

- 汇总 source registry、connector capability 和 credential requirements，生成 source catalog。
- 把 `source-plan` 的 runnable suggestions 转成稳定 `check_target_id`。
- 校验 target config、connector 是否存在、manual-only source 是否被误启用、凭据是否需要配置。
- 生成可交给 source monitor 的 policy / target 配置。

## 不负责什么

- 不执行 adapter。
- 不访问外部网络。
- 不写事实层。
- 不决定一个 source target 是否代表数据覆盖完成。

## 主要入口

- `buildSourceManagementCatalog(input)`：生成来源管理目录。
- `previewSourceCheckTargetsFromPlan(input)`：无数据库预览 source-plan 会生成哪些 target。
- `validateSourceManagementConfig(config, input)`：校验监控配置。
- `buildSourceCheckTargetsFromPlan(...)`：从 source-plan 生成 target。
- `buildSourcePolicyConfigFromPlanTargets(...)`：生成 policy/target 配置。

## 边界约定

source-management 只处理“配置是否可执行”。它不运行 source check，也不把 target 已同步或已启用解释成事实证据。
