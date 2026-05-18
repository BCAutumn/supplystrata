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
- `DOCUMENT_NEW / DOCUMENT_CHANGED / DOCUMENT_UNCHANGED / SOURCE_FAILED / SOURCE_RECOVERED`
- `cli changes` 第一版已落地，能合并输出 `change_records` 和 `source_change_events`。
- edge/evidence 写入事件：`EDGE_ADDED`、`EVIDENCE_ADDED`、`EVIDENCE_SUPERSEDED`。
- 语义级写入事件第一版：`CLAIM_ADDED / CLAIM_UPDATED`、`OBSERVATION_ADDED / OBSERVATION_UPDATED`、`LEAD_ADDED / LEAD_UPDATED`、`REVIEW_APPROVED / REVIEW_REJECTED / REVIEW_APPLIED / REVIEW_BLOCKED`、`UNKNOWN_ADDED / UNKNOWN_UPDATED / UNKNOWN_RESOLVED`。
- research workbench changes timeline。
- 官方披露 section fingerprint diff：客户集中、库存、backlog、capex、采购义务等段落级事件。
- 官方披露 relation fingerprint diff：供应商、客户、foundry 新增/移除，以及采购义务、产能预留、单一供应商风险变化。
- 高价值 relation semantic change 会进入 `review_candidates(kind='semantic_change')`，供研究员确认；确认后只是 acknowledge，不自动写事实边。

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
UNKNOWN_UPDATED
UNKNOWN_RESOLVED
CLAIM_ADDED
CLAIM_UPDATED
OBSERVATION_ADDED
OBSERVATION_UPDATED
LEAD_ADDED
LEAD_UPDATED
```

当前事件族：

| event_family | 来源表                 | 含义                                          |
| ------------ | ---------------------- | --------------------------------------------- |
| source       | `source_change_events` | 文档抓取、版本变化、源健康                    |
| graph        | `change_records`       | edge / evidence 事实图谱变化                  |
| semantic     | `change_records`       | claim / observation / lead / review / unknown |

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

- `graph-builder.apply()` 创建新 edge。（已落地）
- `graph-builder.apply()` 给现有 edge 增加 evidence。（已落地）
- `graph-builder.apply()` 标记旧 evidence 被新 evidence 覆盖。（已落地）
- `claim-builder` 创建或更新 claim。（已落地）
- `observation-store` 创建或更新 observation / lead。（已落地）
- `review-store` approve / reject / apply / block。（已落地）
- unknown add / resolve。（已落地）
- `graph-builder.deprecate()`。（已落地）
- Apple Supplier List import / apply。（facility import 和 apply 已落地）
- source monitor 记录文档变化。（已落地到 `source_change_events`）
- 官方披露文档的语义 section fingerprint 变化：客户集中、库存、backlog、capex、采购义务。（已落地）
- 官方披露规则候选关系 fingerprint 变化：供应商、客户、foundry 新增/移除；采购义务、产能预留、单一供应商风险专门拆分。（已落地；只写 semantic change，不自动写 fact edge）
- relation semantic change 入 review queue。（已落地；`review apply` 对这类候选会生成 `CLAIM_DRAFT_ADDED / CLAIM_DRAFT_UPDATED`，但不产生 edge/evidence）

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
