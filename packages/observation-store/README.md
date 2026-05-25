# @supplystrata/observation-store

`observation-store` 是 observation / lead 的幂等写入边界。

## 负责什么

- 把 observation draft 写入 `observations`。
- 把 lead draft 写入 `lead_observations`。
- 生成 deterministic observation / lead id。
- 记录 observation / lead semantic change。
- 校验 confidence 和时间窗口。

## 不负责什么

- 不抽取 observation。
- 不写 fact edge。
- 不把 lead 提升为事实。
- 不决定 observation anomaly 或 alert。

## 主要入口

- `storeObservation(client, input)`：写入观测。
- `storeLeadObservation(client, input)`：写入 lead。
- `deterministicObservationId(input)` / `deterministicLeadId(input)`：稳定 ID。

## 边界约定

observation-store 只保存可复现信号。事实关系必须通过 review、evidence scoring 和 graph-builder 的受控路径进入事实层。
