# Research Workflow Template — 通用研究流程模板

研究新公司 / 组件时，按这个模板走。每一步必须留下 evidence + cite + 时间戳。

## Step 0 — 写研究问题

把要回答的问题落到具体形式：

```
Q1: <Subject> 的一级上游有谁？
Q2: 哪些上游关系是公开披露的？哪些是推断的？
Q3: 关键组件依赖谁？是否存在单点供应风险？
Q4: 我们不知道什么？
```

## Step 1 — 先确定实体

- 确认 entity_master 中已有该实体（或开 PR 加）
- 确认主要别名 / identifiers 完整
- 确认实体消歧规则覆盖

## Step 2 — 直接披露建立 Level 5/4 边

- 找该实体的 SEC filings / 公司 IR / 监管文件
- 跑 SEC adapter（或 IR adapter）
- 跑 rule extractors
- 不依赖 LLM 抽取直接建立 Level 5（按规则）

## Step 3 — 反向验证

- 找该实体的关键供应商 / 客户的官方文件
- 看是否有交叉披露
- 双向官方披露 → 可触发 Level 5（按 evidence 升级规则）

## Step 4 — 加入第三方公开信号

- 如适用，引用公开行业新闻 / 价格报道（手工录入）
- 注意 evidence_level 上限 2
- 必须 cite 媒体名 + 日期 + URL

## Step 5 — 加入宏观背景（Phase 3+ 才能跑）

- Comtrade / Census / EIA / FRED / USGS 等
- 进 macro_signals 表
- 在 ComponentCard 引用，不进图谱边

## Step 6 — 写 unknown_map

诚实列出"我们不知道什么"。建议至少覆盖：

- [ ] 客户分配 / 订单量
- [ ] 合同价格
- [ ] 内部产能预订
- [ ] 具体物流路径
- [ ] 子公司层级关系（如不清晰）
- [ ] 关键人员决策（不在我们范围）

每条 unknown 必须给：

- `why_unknown`：为什么我们不知道
- `proxies`：可以从哪些代理变量推断（如有）
- `blocking_data_sources`：拿到哪些源能解锁

## Step 7 — 形成 ResearchReport

- 用 CompanyCard / ComponentCard / UnknownMap 拼装
- 任何陈述句必须 cite EV-xxx
- 不写投资建议
- 不"过度精确"——估算用区间表达

## Step 8 — 提交回归

- 这次研究中识别的新规则 / 新别名 / 新组件 / 新关系类型 → 提 PR
- 新发现的 corner case → 加到 entity-resolver / extractor 的 golden set
- 新接入数据源 → 走数据源接入 checklist

## 模板的反向应用：研究退出

不止于"获取信息"。研究也要识别"什么时候停下"：

- 若所有相关 evidence_level >= 4 的边都已建立 + unknown_map 已诚实列出 → 研究阶段完成
- 若不能稳定建立 Level 4 边 → 退一步，先加数据源 / 实体 / 抽取规则，**不**靠 LLM 蒙
- 若 unknown_map 占比过高（如 > 70%）→ 标记本研究为 "low coverage"，不强行输出"看起来完整"的报告

## 时间戳与版本

每份研究报告生成时记录：

- 当前 entity_master 版本（git short hash）
- 当前 evidence 总数
- 报告 generated_at 时间戳
- 用到的 evidence_id 列表（用于将来追溯）

报告本身可以放在 `reports/<topic>/<date>.md`（不入 main，研究产物分支或独立仓库）。
