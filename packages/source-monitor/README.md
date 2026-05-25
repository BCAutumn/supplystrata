# @supplystrata/source-monitor

`source-monitor` 是 source policy、source check target、job、source health、document change 和 source target coverage 的持久化监控层。

## 负责什么

- 读取 due source check target。
- 维护 source policy / source check target。
- 入队、领取、完成或失败 source check job。
- 记录 source degraded / failure / document observation / document change event。
- 输出 source target coverage 和 failure kind，供 research-pack、backlog 和 Gate 1 ledger 消费。

## 不负责什么

- 不实现具体外部 adapter。
- 不解析业务关系。
- 不写 fact edge、evidence 或 claim。
- 不把 source check 成功解释成二源 corroboration。

## 主要入口

- `listDueSourceChecks(client, input)`：列出 due target。
- `syncSourcePolicyConfig(...)` / `enableSourceCheckTargets(...)`：同步和启用监控配置。
- `enqueueAndClaimDueSourceCheckJobs(...)`：入队并领取 due job。
- `markSourceCheckJobSucceeded(...)` / `markSourceCheckJobFailed(...)`：记录 job 结果。
- `listSourceTargetCoverage(...)`：生成 target coverage。

## 边界约定

source-monitor 只表达“监控执行状态”。业务信号进入 observation/review 后，仍需要 pipeline、review 或 evidence-maintenance 的受控路径继续处理。
