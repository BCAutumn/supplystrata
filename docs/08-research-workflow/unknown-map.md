# Unknown Map Methodology — 未知地图方法论

为什么本系统强调 unknown_map：因为研究类系统最大的失败模式是"输出看起来很完整但其实有大量推测"。unknown_map 是对抗这个失败模式的工具。

## 核心信条

> **诚实地列出我们不知道的事，比强行编出"完整答案"更有研究价值。**

## 标准分类

每个 UnknownMap 内的项应当至少能归到下面四类：

```
NO_PUBLIC_DISCLOSURE        法律/合同上就不公开
OBTAINABLE_BUT_PAID         商业数据库才有
OBTAINABLE_WITH_EFFORT      手工 / 流程 / 翻译能拿到
OBTAINABLE_INFERENCE        通过代理变量可推断（精度有限）
```

## 写法规范

每条 unknown_item：

```yaml
question: "What is NVIDIA's HBM allocation per CSP per quarter?"
why_unknown: "Allocation is contractual and confidential; no public party reports it."
blocking_data_sources:
  - "NVIDIA private contract docs (not public)"
  - "CSP capex breakdown by GPU vendor (not public)"
proxies:
  - "Each CSP's data center capex announcements"
  - "Supplier earnings call commentary on top customers"
status: open
```

要求：

- `question` 是真问题（不是"市场会怎么走"这种泛问）
- `why_unknown` 必须解释**为什么** —— "不公开"不是合格答案，要说清楚是合同约束 / 法律约束 / 文件保密 / 未公开渠道等
- `proxies` 应该是可以查的，不是"猜"

## 何时 resolve

将 unknown 标 `resolved` 当且仅当：

- 出现新数据源或新公开披露明确给出答案（必须挂 evidence_id）
- 或者：决定性的代理变量给出可信答案（仍然 cite 来源）

不允许：

- 仅因"读了几篇分析师报告"就 resolve
- 仅因"LLM 给了一个看似合理的答案"就 resolve
- 仅因"行业人士说"就 resolve

## 何时 abandon

- 长期开放但无任何潜在解锁路径
- 法律明文禁止收集
- 与系统当前研究范围无关

abandon 也要写一行原因。

## Unknown Map 的反模式

| 反模式                                | 后果                       |
| ---------------------------------- | ------------------------ |
| 把 unknown 写得很模糊（"市场情况复杂"）          | unknown_map 失去诊断价值       |
| 在报告里"假装回答"了 unknown                | 系统失去诚实度                  |
| 不给 proxies                          | 永远停在"不知道"，无可推进路径         |
| 把所有 unknown 都标 NO_PUBLIC_DISCLOSURE | 失去优先级；混合不同获取难度的项目        |

## 文化要求

- 写报告时强制要求 unknown_map ≥ 5 项
- 任何"低 unknown 数量"的报告需 reviewer 警惕："是真的全都知道，还是研究员偷懒？"
- 在团队 / 个人 reflection 中，有勇气把"未知"摆在前面

## 与图谱的关系

unknown_map 与图谱**互补**：

- 图谱给"我们知道什么 + 证据"
- unknown_map 给"我们不知道什么 + 为什么 + 怎么可能知道"

两者必须一起出现。任何只展示图谱不展示 unknown_map 的输出，都被视为"半成品"。

## CLI 与协作

```
supplystrata unknown add ...
supplystrata unknown list --scope company:ENT-NVIDIA
supplystrata unknown resolve <UNK-id> --evidence EV-xxx
supplystrata unknown abandon <UNK-id> --reason "..."
```

每个动作落 ChangeRecord。
