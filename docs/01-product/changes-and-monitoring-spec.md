# Changes & Monitoring Spec — 变化监控产品规格

研究员每天真正关心的问题不是“重新看一遍 NVIDIA”，而是：

```text
今天有什么变了？
哪些源失败了？
哪些证据被新文件覆盖？
哪些边新增、升级、失效？
```

本文定义 `cli changes`、ChangeRecord 和工作台 timeline 的产品契约。

## 当前基础

已经有：

- `source_health`
- `source_policies`
- `source_items`
- `document_versions`
- `source_change_events`
- `fetch_runs` schema
- `DOCUMENT_NEW / DOCUMENT_CHANGED / DOCUMENT_UNCHANGED`

还缺：

- edge-level change events。
- evidence supersession timeline。
- `cli changes`。
- research workbench changes timeline。

## ChangeRecord 事件类型

v0.2 必须至少支持：

```text
DOCUMENT_NEW
DOCUMENT_CHANGED
DOCUMENT_UNCHANGED
EDGE_ADDED
EDGE_UPDATED
EDGE_DEPRECATED
EVIDENCE_ADDED
EVIDENCE_SUPERSEDED
REVIEW_APPROVED
REVIEW_REJECTED
REVIEW_APPLIED
SOURCE_FAILED
SOURCE_RECOVERED
UNKNOWN_ADDED
UNKNOWN_RESOLVED
```

事件必须带：

```ts
interface ChangeRecordOutput {
  change_id: string;
  event_type: string;
  occurred_at: string;
  source_id?: string;
  source_item_id?: string;
  doc_id?: string;
  edge_id?: string;
  evidence_id?: string;
  review_id?: string;
  entity_id?: string;
  component_id?: string;
  summary: string;
  evidence_level?: 1 | 2 | 3 | 4 | 5;
  requires_attention: boolean;
}
```

## CLI 契约

```bash
supplystrata changes --since 2026-05-01
supplystrata changes --scope company:ENT-NVIDIA
supplystrata changes --source sec-edgar
supplystrata changes --attention-only
supplystrata changes --format json
```

默认 Markdown 输出：

```text
# Changes since 2026-05-01

## Requires attention
- SOURCE_FAILED sec-edgar: ...
- EDGE_CONFLICTED EDGE-...

## New evidence
- EVIDENCE_ADDED EV-... for EDGE-...

## Documents
- DOCUMENT_CHANGED DOC-...
```

## 写入规则

必须写 ChangeRecord 的路径：

- `graph-builder.apply()` 创建新 edge。
- `graph-builder.apply()` 给现有 edge 增加 evidence。
- `graph-builder.deprecate()`。
- `review approve / reject / apply`。
- Apple Supplier List import / apply。
- source monitor 记录文档变化。
- unknown add / resolve。

不允许：

- 图谱里有边变化，但 changes 流没有记录。
- source monitor 失败只写日志不落库。
- review 状态变化不出现在 timeline。

## 工作台 timeline

Research Workbench 底部 timeline 展示：

- source health。
- 最近文档变化。
- 最近 edge/evidence 变化。
- review queue stats。
- attention items。

timeline 是研究工具，不是 marketing feed。默认按 `requires_attention` 和时间排序。

