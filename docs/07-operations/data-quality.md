# Data Quality — 数据质量校验

数据是这个系统的产品。所以本文写得比"性能优化"更严肃。

## 校验分类

```
1. Schema 校验           （写入时强制）
2. 引用完整性校验          （写入时强制）
3. 业务不变量校验          （定期跑）
4. 一致性校验             （Postgres vs Neo4j）
5. 内容质量校验           （cite 长度 / 可访问性）
6. 漂移监控              （趋势）
```

## 1. Schema 校验（写入时）

- 所有 INSERT / UPDATE 都过 zod schema
- DB 层面也加 `CHECK` 约束（如 evidence_level BETWEEN 1 AND 5）
- 没有正确 schema → 拒收 + 写错误日志

## 2. 引用完整性

- evidence.doc_id 必须指向存在的 document
- edge.subject_id / object_id 必须指向 active entity
- chunk_entities.entity_id 必须指向 active entity
- evidence_id 引用必须存在

外键约束已在 schema.md 写入。

## 3. 业务不变量

每日 housekeeping 跑：

```
[ ] 每条 edge 至少有 1 条 evidence
[ ] 每条 evidence 都有非空 cite_text 且长度 ≥ 30
[ ] is_inferred = true 的 edge 都有 needs_review 历史
[ ] evidence_level = 5 的 edge 都不是 LLM 抽取
[ ] 没有"Samsung" 这种孤立 surface 直接 link 到 ENT-SAMSUNG-ELEC（应该消歧到具体业务部门）
[ ] 任何 entity status = "merged_into" 都有 merged_into_entity_id
[ ] 没有 entity 同时被多个 active alias 共享（且无上下文规则）
[ ] 任何 LLM 抽取的 evidence 必须有 llm_meta 字段
[ ] 任何 facility 都有 country
[ ] 任何 product 都至少挂在一个 component (IS_A) 或 owner
```

不变量违反 → 写 `data_quality_issues` 表 + CLI 报警

```sql
CREATE TABLE data_quality_issues (
  issue_id      TEXT PRIMARY KEY,
  rule_id       TEXT NOT NULL,
  severity      TEXT NOT NULL,                 -- error|warn
  scope_kind    TEXT,
  scope_id      TEXT,
  detail        JSONB,
  detected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ,
  resolved_by   TEXT
);
```

CLI:

```
supplystrata dq run                # 跑全部规则
supplystrata dq list [--unresolved]
supplystrata dq resolve <issue_id>
```

当前 alpha 已落地最小只读版本：

```bash
pnpm --silent cli dq run --format markdown
pnpm --silent cli dq run --format json
```

已检查：

- current edge 是否至少有 1 条 active evidence
- active evidence 的 `cite_text` 是否 ≥ 30 字符
- active evidence 是否引用存在的 edge
- active evidence 的 `cite_text` 是否能在对应 chunk 中找到
- active evidence 是否出现明显 HTML 边界粘连
- LLM evidence 是否违反 Level 5 上限 / 缺少 `llm_meta`
- current edge 的 `primary_evidence_id` 是否指向最佳 active evidence
- parsed document 是否至少有 chunk
- NVIDIA unknown map 是否至少有 5 个 open item

`dq list` / `dq resolve` 仍未落地，因为 `data_quality_issues` 持久化表还没建；当前 `dq run` 直接返回即时检查结果。

## 4. 一致性校验（Postgres vs Neo4j）

- entity_master active count == Neo4j (:Entity {status:'active'}) count
- edges (validity='current') count == Neo4j 总关系数
- 抽样比对 100 条 edge，主体客体一致

不一致：

- 优先 `supplystrata graph rebuild`
- 如重建后仍不一致 → 严重错误，开 incident

## 5. 内容质量

```
[ ] cite_text 是 chunk.text 的子串
[ ] company/evidence 输出不能出现明显的 HTML 边界粘连（如 `products.Competition`）
[ ] edge.primary_evidence_id 指向该 edge 当前最佳 evidence（level/confidence/created_at 排序）
[ ] document.source_url 可访问（HEAD 200）—— 抽样 5%
[ ] storage_key 对应的字节存在 + sha256 一致
[ ] entity_master 的 identifiers.cik 都是 10 位数字字符串
[ ] alias_norm 都是合法 NFKC + lower + strip
```

## 6. 漂移监控

每周输出：

- evidence_level 分布（如果 Level 5 比例突然下降，说明抽取规则改了）
- 每个 source_adapter_id 的 evidence 增量
- review queue 通过率（approved / total）
- ambiguous 实体解析率
- LLM 调用 cost 与 token 趋势

## CI 阻塞

数据质量规则**部分**进 CI（在 fixture 数据上）：

- schema 校验
- 引用完整性
- 不变量（除了"Samsung 孤立"这类生产数据特异的）

不让 CI 把生产数据也校了，但生产环境每日 housekeeping 必须跑全集。

## 错误等级

| Severity   | 处理                                       |
| ---------- | ---------------------------------------- |
| error      | 阻塞下游 pipeline；必须修复或显式忽略                   |
| warn       | 不阻塞，但记录                                  |
| info       | 用于趋势分析                                    |

`error` 必须有 owner + 解决方案；`warn` 累积超过阈值（如同一规则 100 条 / 周）会升级为 error。

## 抽样审计

每月人工抽样：

- 50 条 evidence_level 4-5 边 → 检查 cite_text 是否真的支持关系
- 30 条 ambiguous resolver 案例 → 检查上下文规则覆盖
- 20 条 unknown_map 项 → 检查 question 是否合理

抽样结果在 `docs/07-operations/audit-log.md` 留档（PR 时新增）。
