# User Stories — 典型使用场景

MVP 阶段唯一的"用户"是研究员本人（含其他能读 10-K 的同等水平研究者）。这里不写散户用户故事——那是 Phase 4 之后才考虑的事情。

## US-1: 摸清一家公司的一级上游

**Persona**：分析师 A，刚开始研究某公司，希望快速了解它的供应链结构。

**故事**：

> A 想了解 NVIDIA 的一级上游有谁、证据来自哪里。她在 CLI 输入：
>
> ```
> supplystrata company NVIDIA --depth 1 --format markdown > nvidia.md
> ```
>
> 输出包含：
> - 直接披露的供应商列表（Level 4-5）
> - 每条边的证据 ID 和原文片段
> - 一份未知地图，写明"具体客户分配 / 订单量 / 运输路线"等明确不知道的事情
> - 最近 30 天的变化记录（如有）
>
> 她不需要打开任何浏览器就能拿到一份带源头的初步结构。

**验收**：

- 输出 < 5 秒
- 不含任何无证据的陈述
- unknown_map 至少 5 项
- Markdown 中所有 EV-xxx 在 evidence 表中都查得到

---

## US-2: 追问一条具体边的证据

**Persona**：分析师 B，看到 `NVIDIA → BUYS_FROM → SK Hynix`，想知道这条到底来自哪儿。

**故事**：

> B 想检查这条边的可信度：
>
> ```
> supplystrata edge EDGE-000234
> supplystrata evidence EV-000102
> ```
>
> 系统返回：
> - 证据等级
> - 抽取方法（rule / llm / manual）
> - 原文片段
> - 原始文档 URL（指向 SEC EDGAR 上的 10-K）
> - 抓取时间
> - 该证据是否被后续证据覆盖（superseded_by）

**验收**：

- 任意 EV-xxx 都能拿到完整 provenance
- 原始 URL 仍然可访问（或在本地对象存储中有备份）

---

## US-3: 了解一个组件的供给图

**Persona**：行业研究员 C，关心 HBM 供需。

**故事**：

> C 想拿一份 HBM 的快照：
>
> ```
> supplystrata component HBM --format markdown
> ```
>
> 输出包含：
> - 已知供应商及其证据（SK Hynix / Samsung / Micron 三家）
> - 已知主要消费方（NVIDIA / AMD / 部分 ASIC 玩家）
> - 公开的需求驱动因素（cite 各家 10-K / IR 中关于 AI 服务器需求的段落）
> - 公开价格信号（cite TrendForce 2026 Q2 公开新闻稿）
> - 明确标注"我们没有完整价格数据库，下面只是公开片段"
> - unknown_map：具体合同价格、客户分配、产能预订量

**验收**：

- `is_full_database = false` 字段必须出现在 price_signals 上
- 引用的新闻稿都带 fetched_at 和 evidence_text

---

## US-4: 检查一个实体是否被错误合并

**Persona**：研究员 D，怀疑系统把 Foxconn Industrial Internet 错误合并到了 Hon Hai 母公司。

**故事**：

> D 想审计某个实体：
>
> ```
> supplystrata entity ENT-FOXCONN --show-aliases --show-subsidiaries
> ```
>
> 系统返回：
> - canonical_name + 全部别名 + 别名来源
> - 直接持股的子公司列表（OWNS_SUBSIDIARY）
> - 内部业务部门（`OWNS_BUSINESS_UNIT`）与别名表引用
> - 每个关系的证据
>
> 她发现 FII 应该是独立法人节点，提交 PR 修正 `seeds/aliases.csv`。

**验收**：

- 实体编辑必须经过 PR + 落 ChangeRecord
- 实体合并/拆分会自动重写所有受影响边的归属

---

## US-5: 看最近发生了什么变化

**Persona**：研究员 E，要做月度 review，想知道这一个月图谱新增/变化了什么。

**故事**：

> ```
> supplystrata changes --since 2026-04-15
> ```
>
> 输出按 ChangeRecord 列出：
> - 新增的边（new_edge）
> - 被升级的证据等级
> - 新加入的别名
> - 新接入的文件（filing_filed）

**验收**：

- 任何边的修改都进入 changes 流
- 不存在"图谱里有数据但 changes 流里没记录"的情况

---

## US-6: 提一个未知问题

**Persona**：研究员 F，发现一个值得回答但目前没数据的问题。

**故事**：

> F 把一个未知项加进系统：
>
> ```
> supplystrata unknown add \
>   --scope company:ENT-NVIDIA \
>   --question "How is HBM3e allocation split between NVIDIA's top 5 customers?" \
>   --why-unknown "No public disclosure; allocation is contractual and confidential" \
>   --proxies "Customer capex announcements; supplier earnings call commentary"
> ```
>
> 这个问题进入 `unknown_map`，未来如果有新数据源（如某次 earnings call 透露），可以 resolve。

**验收**：

- unknown items 持久化在 Postgres
- 可以被关联到具体公司/组件
- 状态变化要落 ChangeRecord

---

## US-7: 将研究产物嵌入对外报告

**Persona**：研究员 G，要写一份月度报告。

**故事**：

> G 通过 CLI 把卡片导出成 Markdown，手动整合到自己的报告里。MVP 不提供报告自动构建（那是 Phase 3 的 `report build` 命令）。

**验收**：

- Markdown 输出可直接放进 Notion / Obsidian / GitHub Wiki
- 引用格式（EV-xxx）可保留

---

## 反向用户故事（不支持）

| 不支持的请求                              | 系统应当返回                              |
| ----------------------------------- | ----------------------------------- |
| "告诉我 NVIDIA 下季度业绩好不好"               | "本系统不做业绩预测。可参考的相关边：…"               |
| "推荐我买什么 AI 概念股"                     | 拒绝。明确返回：本系统不输出投资建议                  |
| "猜一下 SK Hynix 给 NVIDIA 的分配比例"       | 进 unknown_map，不进图谱                  |
| "把所有 Level 1-3 的边显示成确定关系"           | 默认隐藏 + 必须 `--include-inferred` 才显示，且渲染时显著标注  |

不支持的请求也是产品规格的一部分。
