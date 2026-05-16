# Release Criteria — 发布验收标准

本文区分两个概念：

```text
MVP / Phase 2 full acceptance
  完整愿景下的严格验收。

v0.2-alpha release
  可公开、可复现、对 A+B 用户有价值的中间版本。
```

## 为什么要区分

原始 MVP 标准要求：

```text
25 个核心节点
至少 100 条 Level 4/5 边
完整 ComponentCard
完整 entity resolver golden set
```

这个标准方向正确，但容易把发布卡死。v0.2-alpha 应该先证明：

```text
小范围真实研究能复现
证据链可信
变化监控有用
工作台形态正确
```

而不是假装已经覆盖完整 AI compute/memory 产业链。

## v0.2-alpha 发布标准

v0.2-alpha 必须满足：

```text
[ ] 至少 5 个核心公司/业务节点有真实边或可解释 source coverage
[ ] 平均每个核心节点 >= 10 条 Level 4/5 edge 或 reviewed facility edge
[ ] NVIDIA 研究路径仍一条命令可复现
[ ] Apple Supplier List 产生 >= 50 条 reviewed facility edge
[ ] `cli component memory` 可输出 ComponentCard
[x] `cli changes` 可输出最近变化
[ ] EntityResolver golden set >= 200 并进 CI
[ ] research workbench 可打开本地 JSON，展示 chain/evidence/source health/changes
[ ] README 明确当前不是完整供应链数据库
[ ] release-check 通过
```

## Phase 2 full acceptance

Phase 2 完整验收仍保留：

```text
[ ] 25 个核心研究节点全部进入 entity_master
[ ] 至少 100 条 evidence_level >= 4 的边
[ ] 任一 EV 都能 1 跳到原始证据
[ ] Foxconn / Samsung / TSMC 实体消歧检测全过
[ ] CLI 输出无任何无证据陈述
[ ] CLI 输出始终有 unknown_map
```

v0.2 不是降低长期标准，而是允许中间版本诚实发布。

## 禁止发布条件

任何一条成立，都不能发 v0.2：

```text
[ ] 有真实 API key 或原始第三方全文数据进入仓库
[ ] 默认输出包含无 evidence 的事实陈述
[ ] LLM 抽取结果未经 review 入图
[ ] inferred Level 1-3 默认显示为事实边
[ ] ImportYeti / BOL 自动抓取代码进入仓库
[ ] README 暗示项目已经是完整供应链数据库
```
