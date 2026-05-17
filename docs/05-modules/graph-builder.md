# Module: Graph Builder — 写图谱

`packages/graph-builder`。把通过 review 的候选写入 Postgres 的 `edges` / `evidence` / `change_records`，并在配置了 `GraphStore` adapter 时同步图谱投影。

Neo4j 只是当前内置 adapter，位于 `packages/graph`。`packages/graph-store` 才是稳定接口，未来可以接宿主 app 自带的图存储、内存图、SQLite 投影或远程图服务。没有传入 GraphStore 时，GraphBuilder 默认 `graph_sync.status = "deferred"`，不会要求启动 Neo4j。

## 接口

```ts
interface GraphBuilder {
  apply(approved: ApprovedCandidate): Promise<ApplyResult>;
  deprecate(edgeId: string, reason: string, evidence: Provenance): Promise<void>;
  rebuild(): Promise<{ nodes: number; edges: number }>;
}
```

## apply 流程

```
1. 在 Postgres 事务内：
   a. 写 evidence 表（含 confidence_breakdown）
   b. 找/建 edge
      - 唯一键 = (subject_id, object_id, relation, COALESCE(component, ''),
                  effective_period_or_null)
      - 如已存在：append evidence_ids, 更新 last_verified_at
      - 如不存在：建新 edge
   c. 计算 edge.evidence_level = max(evidence levels)
   d. 计算 edge.confidence (按公式 in confidence-scoring.md)
   e. 写 change_records（new_edge | evidence_added | level_changed | confidence_changed）

2. 在 GraphStore 物化视图（可选；当前 CLI 默认 adapter 是 Neo4j）：
   MERGE (s:Entity { entity_id: $subject_id })
   ON CREATE SET s += $subject_props
   ON MATCH SET s += $subject_props_minimal
   MERGE (o:Entity { entity_id: $object_id }) ...
   MERGE (s)-[r:<RELATION> {edge_id: $edge_id}]->(o)
   SET r += $edge_props

3. 输出 ApplyResult { edge_id, evidence_id, change_id, is_new_edge, graph_sync }
```

事务边界：

- Postgres 事务保证 evidence + edge + change 同时可见或同时不写
- GraphStore 写在 Postgres commit 之后；失败不会回滚 Postgres，也不会让 review apply 停在半完成状态
- `ApplyResult.graph_sync.status = "failed"` 时，CLI/API 调用方应该提示运行 `supplystrata graph rebuild`
- 如果 Postgres commit 后 GraphStore 长期失败，可以全量 `rebuild()` 恢复；后续再引入 outbox/后台重试

## Primary evidence 选择

同一条 edge 可以累积多条 evidence。`edges.primary_evidence_id` 只是输出层默认展示的代表证据，不是唯一证据。

每次 `apply()` 新 evidence 后，都必须重新选择 primary evidence：

1. `evidence_level` 高者优先
2. `confidence` 高者优先
3. `created_at` 新者优先
4. `evidence_id` 作为最后稳定排序

这样做有两个原因：

- 后续重跑 parser / extractor 后，修正过的更干净 cite_text 可以替换旧展示，不会被第一条 evidence 永久占位。
- edge 的事实强度来自所有 evidence 的累积，但对外输出必须默认展示最有解释力、最新且质量最高的一条。

## 边的归一化

抽取阶段的 candidate 可能是 `SUPPLIES_TO` 方向，graph-builder 统一归一为 `BUYS_FROM`：

```
if relation == "SUPPLIES_TO":
    swap subject and object
    relation = "BUYS_FROM"
```

evidence 内仍保留原始关系语句（在 cite_text 中）。

## Evidence Trace

`apply()` 写入 evidence 时必须同时写入可复现定位信息。计算规则由 `@supplystrata/evidence-trace` 提供，graph-builder、backfill 和未来 API 必须复用同一套规则，避免不同入口算出不同 fingerprint：

- `cite_start_char` / `cite_end_char`：`chunk_id` 对应 chunk 内的 0-based 字符偏移，end 为 exclusive。
- `cite_text_sha256`：原始 `cite_text` 的 sha256。
- `normalized_cite_text_sha256`：NFKC + 空白归一后的 `cite_text` sha256。
- `source_snapshot_sha256`：对应 `documents.bytes_sha256`，用于确认引用来自哪个源快照。
- `parser_version`：产生当前 `document_chunks` 的 parser 版本；未知时写 `unknown`，不能靠空值假装没问题。
- `extractor_version`：产生 candidate 的规则/模型/prompt 版本；LLM prompt 先记录为 `prompt:<prompt_hash>`。
- `relation_candidate_hash`：subject/object/relation/component/extractor/cite hash 的稳定指纹，用于后续重复 evidence 检测与 backfill。

如果 `chunk_id` 缺失或 `cite_text` 在 chunk 中找不到，graph-builder 不猜测偏移，保持 offset 为空并交给 data-quality 报告。自动 pipeline 在进入 review/apply 前仍必须做 `cite_text` 子串校验。

历史 evidence 通过维护命令补齐：

```bash
pnpm --silent cli db backfill-evidence-trace --limit 1000
```

## Deprecate

```ts
deprecate(edge_id, reason, evidence): {
  Postgres:
    UPDATE edges SET validity = "deprecated", deprecated_reason = ?, superseded_by_edge_id = ?
    INSERT into change_records ('edge_supersession', edge_id, evidence_ids)
  GraphStore:
    MATCH ()-[r {edge_id: ?}]->() DELETE r       # 真删图谱里的边（保持当前态干净）
    OR
    SET r.validity = "deprecated"                # 二选一；MVP 选删除
}
```

MVP 选择"图投影中删除 deprecated 边"以保持当前态可读性。Postgres 永远保留历史。

## Rebuild

`rebuild()` 必须满足：

- 幂等
- 可中断重跑
- 进度可观测
- 不依赖 GraphStore 现有内容

伪代码：

```
1. lock graph rebuild（同时只允许一个）
2. clear GraphStore
3. 逐批从 entity_master 读 active entities → CREATE 节点
4. 创建索引/约束
5. 逐批从 edges 读 validity = current → MERGE 关系
6. 写一行 change_record (system: graph_rebuilt)
7. 输出统计
```

执行频率：

- Phase 0-2：手动触发
- Phase 3 起：每周 housekeeping 自动 rebuild + 校验

## 一致性检查（housekeeping）

MVP 已落地轻量检查：

```bash
supplystrata graph check --format markdown
```

当前检查 GraphStore 可达性，以及 Postgres truth projection 与图投影的节点数 / 当前边数是否一致。状态含义：

- `synced`：计数一致
- `out_of_sync`：GraphStore 可达但计数不一致，执行 `supplystrata graph rebuild`
- `unreachable`：GraphStore 不可达，先修 adapter 连接，再执行 `supplystrata graph rebuild`

后续 housekeeping 每日跑一次，并扩展到逐边检查：

- Postgres edges (validity=current) 数量 vs GraphStore 关系数量 → 必须一致
- 任一边的 evidence_level / confidence 与 Postgres 不一致 → 重写 GraphStore
- 任一节点缺 entity_master 记录 → 报警 + 删除 GraphStore 孤儿节点

## 节点属性的最小集

写入 GraphStore 节点的属性只有：

- `entity_id`
- `kind`
- `canonical_name`
- `display_name`
- `primary_country`
- `status`
- `industry`（数组）

其它属性（identifiers、attrs、createdAt 等）一律去 Postgres 拉。GraphStore 是查询缓存，不是元数据库。

## 关系属性的最小集

写入 GraphStore 关系的属性：

- `edge_id`
- `evidence_level`
- `confidence`
- `is_inferred`
- `validity`（在 MVP 中我们删 deprecated 边，因此实际只有 current；保留属性以便将来策略变化）
- `component`
- `last_verified_at`

不写：cite_text / evidence_ids / 详细 attrs（去 Postgres 拉）。

关系类型必须从 core 的 `RelationType` 穷举映射进入各 adapter 的后端表示。Neo4j adapter 里不能把外部字符串直接拼成 Cypher 关系类型；新增关系类型时需要同时更新 `RELATION_TYPES`、Postgres/GraphStore 投影逻辑和对应测试。

## 测试

- apply 的事务原子性测试（人为打断 Postgres / GraphStore）
- rebuild 在中断时重跑必须收敛到一致结果
- deprecate / undeprecate 测试（虽然 MVP 不做 undeprecate，但接口要预留）

## CLI

```
supplystrata graph apply --review-id REV-xxx
supplystrata graph rebuild
supplystrata graph stats
supplystrata graph check                # 一致性校验
supplystrata graph deprecate --edge EDGE-xxx --reason "..."
```
