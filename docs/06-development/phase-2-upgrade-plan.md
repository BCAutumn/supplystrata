# Phase 2 Upgrade Plan — 从 alpha 纵向切片到可信证据图谱引擎

本文记录 `v0.1.0-alpha.1` 公开后，下一阶段的升级顺序。它不是新的愿景稿，而是把 review 中发现的风险改成可以排队执行的 PR、验收标准和明确的“不做”。

核心判断：

> Phase 2 下一步先修可信度，不先追数据量。错误的高置信边、错误实体合并、不能复现的证据定位，比暂时缺数据更危险。

## 当前基线

已经具备：

- TypeScript monorepo、Postgres truth store、Neo4j materialized graph。
- NVIDIA SEC 10-K 纵向切片。
- Apple Supplier List 半自动 review/apply 流程。
- `company` / `evidence` / `unknown-map` CLI 输出。
- `review -> approve -> apply` 审计链。
- `graph rebuild` / `graph check`。
- 本地 `release:check` 和 GitHub Actions CI。

仍未达到 Phase 2/MVP 验收：

- 100 条 `evidence_level >= 4` 边。
- EntityResolver golden set ≥ 200 且高歧义实体验证充分。
- ComponentCard。
- EV 到原文的精确 offset / fingerprint。
- 监控层：source health、fetch run、document diff、change event。

## P0：先堵住错误高置信边

### PR 1 — Component taxonomy + memory/HBM 修正

状态：已开始落地。`v0.1.0-alpha.1` 之后的第一批实现先修正规则抽取器，不再把普通 memory 句子自动升级为 HBM；同时补 `COMP-MEMORY` 父组件 seed，并在 `edges` 写入链增加 `component_id` / `component_specificity` 兼容迁移。

当前风险：NVIDIA 10-K 中类似 “purchase memory from SK hynix, Micron and Samsung” 的句子，只能支持 `BUYS_FROM(memory)`，不能自动升级成 `BUYS_FROM(HBM)`。除非原文明确出现 `HBM` / `High Bandwidth Memory` / `HBM3` / `HBM3e` / `HBM4`。

目标：

- `component` 从自由文本逐步迁移到组件 taxonomy。
- `edge` 保留向后兼容字段，但新增或预留 `component_id`、`component_family`、`component_specificity`。
- 抽取器默认输出 `memory`；只有显式 HBM 证据才输出 HBM。

验收：

- NVIDIA memory 句子输出：
  - `NVIDIA -BUYS_FROM(memory)-> SK Hynix`
  - `NVIDIA -BUYS_FROM(memory)-> Micron`
  - `NVIDIA -BUYS_FROM(memory)-> Samsung`
- 同一 fixture 中没有明确 HBM 原文时，不出现 HBM 边。
- 新增正例、反例、边界例测试。

### PR 2 — Source authority matrix

状态：已落地。`packages/source-registry` 现在暴露 `sourceAuthorityFor()`，把来源发布者、关系证明能力和最高证据等级放到一个显式矩阵里；`packages/evidence-scorer` 通过该矩阵计算 `source_cap` 与 `relation_cap`，不再只靠 `document_type` 粗略封顶。

当前风险：`document_type -> max evidence level` 太粗，会把监管披露、公司官网、注册数据、宏观数据、新闻线索混在一起。

目标：

```ts
type SourceAuthority = {
  source_adapter_id: string;
  document_type: DocumentType;
  publisher_type: "regulator" | "company_official" | "government_registry" | "official_supplier_list" | "macro_statistical_agency" | "news" | "manual";
  relation_authority: "self_disclosure" | "counterparty_disclosure" | "registry_fact" | "facility_claim" | "macro_trend" | "lead_only";
  max_evidence_level: 1 | 2 | 3 | 4 | 5;
};
```

验收：

- 监管自披露最高 Level 5。
- 官方供应商名单 / 公司官方报告最高 Level 4。
- 公司注册数据只能强化实体事实，不默认生成供应链边。
- `registry_fact` 对 `BUYS_FROM` / `SUPPLIES_TO` 只能作为低等级候选，对 `OWNS_SUBSIDIARY` / `OPERATES_FACILITY` 才能保留高等级实体事实。
- 宏观贸易 / 能源 / AIS 数据进入 observations，不能直接生成 Level 4/5 公司边。
- LLM 仍然最高 Level 4，默认 `needs_review = true`。

### PR 3 — EntityResolver hardening

状态：已推进到 CI 门槛。`DbEntityResolver` 与 `SeedEntityResolver` 已共享 exact/fuzzy/special family 规则；fuzzy 命中不再自动 resolved，Samsung / Foxconn / TSMC family 规则已补单测和 DB 集成测试；seed 派生 golden set 已超过 200 条，并覆盖高风险歧义面。

当前风险：模糊匹配一旦自动合并，会把错误扩散到所有边。供应链实体里短别名、集团名、子公司、事业部非常多。

目标：

- exact alias + 强 identifier match 才允许自动 resolved。
- exact alias only 可高置信，但要受 alias type、jurisdiction、source authority 约束。
- fuzzy match 默认 `needs_human_review = true`。
- 长度 `<= 4` 的短别名默认不自动合并，除非有 CIK / LEI / ticker / jurisdiction / address 等交叉验证。
- 保留 group / subsidiary / facility 层级，不把 Samsung、Foxconn、3M 这类实体拍扁。

验收：

- Samsung 不会误合并 Samsung Electronics / Samsung Memory / Samsung Foundry / Samsung SDI / Samsung Display。
- Foxconn / Hon Hai / FII / FIH / Hongfujin 的层级关系可解释。
- `3M` 不会被短别名规则误判或漏 seed。
- golden set ≥ 200 进入 CI。
- 抽取器可以把 `primary_entity_id` 作为 subject surface 交给 resolver，不再需要把公司名硬编码进规则。

### PR 4 — Unknown extractor prefix fail-fast

状态：已落地。`inferExtractionMethod()` 现在只接受 `rule.` / `llm.` / `manual.` / `review.`，未知前缀直接抛错；scorer 与 graph-builder 都会阻断写入。

当前风险：未知 `extractor_id` 前缀如果静默当成 LLM，会隐藏配置错误。系统应该让 pipeline misconfiguration 尽早暴露。

目标：

- `rule.` / `llm.` / `manual.` / `review.` 之外的前缀不再静默降级。
- 可选方案：
  - 直接 throw，并在 CLI 中显示可读错误。
  - 或新增 `ExtractionMethod = "unknown"`，永远 `needs_review = true`，cap 到 Level 2，同时输出告警。

验收：

- 测试覆盖未知 extractor prefix。
- 不再存在“拼错 extractor id 但 pipeline 继续跑”的情况。
- graph-builder 在遇到未知前缀时回滚事务，不留下 edge / evidence 半成品。

### PR 5 — Exact citation offsets + evidence fingerprint

状态：代码已开始落地。新写入的 evidence 会记录 offset、fingerprint、source snapshot hash、parser/extractor version 与 relation candidate hash；历史 evidence 可用 `db backfill-evidence-trace` 分批补齐；下一步是观察 data-quality 重复告警并升级去重约束。

当前风险：`cite_locator` 是弱定位。解析器版本变化后，很难证明某条 evidence 仍能精确复现。

目标字段：

```text
cite_start_char
cite_end_char
cite_text_sha256
normalized_cite_text_sha256
source_snapshot_sha256
parser_version
extractor_version
relation_candidate_hash
```

验收：

- 任意 `EV-xxx` 能跳到 `doc_id`、`storage_key`、`chunk_id`、char offsets、原文片段、source URL、fetch date。
- 同一段原文重复抽取不会产生重复 evidence；现阶段先通过 `relation_candidate_hash` 和 data-quality 暴露，历史 backfill 后再加唯一约束。
- parser / extractor 版本升级后，旧 evidence 可审计。

## P1：把 NVIDIA 样板变成官方披露规则包

当前的 NVIDIA 纵向切片是好样板，但下一步要变成可复用规则包，避免把半导体测试样例写成产品硬编码。

状态：第二版已落地。`rule.sec.official-supply-chain` 现在只要求 `source_adapter_id = sec-edgar`（或离线 `sec-edgar-fixture`）且文档类型是 `10-K` / `10-Q` / `8-K`，subject 使用 `NormalizedDocument.primary_entity_id`，不再限定 NVIDIA。现有 foundry / memory supplier / contract manufacturer 规则被保留为通用 SEC 官方披露规则；新增命名 major customer、命名 purchase obligation / capacity reservation、命名 single-source supplier risk。匿名客户集中度与匿名供应商风险不会写入 company edge，等 observation / unknown schema 完整后再承接。

目标规则包：

```text
rule.sec.official-supply-chain
rule.sec.foundry
rule.sec.memory-supplier
rule.sec.contract-manufacturer
rule.sec.major-customer
rule.sec.customer-concentration
rule.sec.purchase-obligation
rule.sec.inventory
rule.sec.backlog
rule.sec.capacity-reservation
rule.sec.single-source-risk
rule.ir.capacity-expansion
rule.ir.customer-demand-commentary
rule.supplier-list.facility
```

每条规则的最低质量契约：

- 至少 3 个正例 fixture。
- 至少 3 个反例 fixture。
- 至少 2 个边界例 fixture。
- 必须输出 `cite_text`。
- `cite_text` 必须是原文子串。
- 必须输出 `raw_evidence_level_hint`。
- 必须输出 component specificity。
- 必须有 negative-context 规则。

验收：

- NVIDIA、AMD、Micron、Microsoft、Broadcom 至少能跑官方披露抽取。
- NVIDIA 专用规则降级为 fixture，不再作为唯一业务逻辑入口。
- 命名客户披露进入 `SUPPLIES_TO`，CompanyCard JSON/Markdown 分为 upstream 与 downstream，不把客户边混进上游。
- 匿名 customer concentration / anonymous supplier risk 不生成边。
- 任何 Level 5 边都必须能追到官方原文。

## P2：建立 monitoring layer

系统要从“一次性抓取”升级成“知道何时变化、何处失败、哪些边受影响”的监控系统。

状态：第一层已落地。`source_health` / `source_policies` / `source_items` / `document_versions` / `source_change_events` / `fetch_runs` 已进入 schema；`@supplystrata/source-monitor` 负责同步 registry、同步外部 cadence 配置、输出 source health/due list、计算 `DOCUMENT_NEW` / `DOCUMENT_UNCHANGED` / `DOCUMENT_CHANGED`，并记录 `SOURCE_FAILED` / `SOURCE_RECOVERED`。`recordDocumentObservation()` 已接入真实 pipeline 的 `saveNormalizedDocument` 后置路径。

目标数据模型：

```text
source_registry
source_policy
source_health
fetch_plan
fetch_run
source_item
document_version
dataset_release
parser_run
extraction_run
change_event
edge_observation
```

每个 source 至少记录：

```text
source_id
adapter_id
tier
official_name
base_url
tos_url
robots_policy
rate_limit
update_cadence
last_success_at
last_failure_at
failure_count
legal_status
allowed_output
relation_authority
max_evidence_level
```

每次 fetch 至少记录：

```text
fetch_run_id
source_id
url
request_hash
response_status
response_sha256
fetched_at
etag
last_modified
storage_key
normalized_sha256
parser_version
```

事件类型：

```text
DOCUMENT_NEW
DOCUMENT_CHANGED
DOCUMENT_UNCHANGED
EDGE_ADDED
EDGE_UPDATED
EDGE_DEPRECATED
EDGE_CONFLICTED
EVIDENCE_SUPERSEDED
UNKNOWN_RESOLVED
SOURCE_FAILED
SOURCE_RECOVERED
```

验收 CLI：

```bash
supplystrata sources list
supplystrata sources health
supplystrata sources due
supplystrata sources policy sync --file config/source-policies.example.json
supplystrata sources check --source sec-edgar --cik 0001045810 --entity ENT-NVIDIA --forms 10-Q,8-K --limit 3
supplystrata sources run-due --limit 5
supplystrata changes --source sec-edgar --attention-only
```

## P3：免费数据源按证据权重入库

不要按“好玩程度”接数据源。每类数据必须先定义 graph policy。

### A 类：官方披露，可生成 Level 4/5 边

- SEC EDGAR。
- 公司官方 IR / annual report / sustainability report。
- Apple Supplier List。
- DART-KR / EDINET / 同等监管披露。
- Companies House / OpenCorporates 等注册数据。

策略：

- 公司自披露供应商 / 客户：可进入 `edges`，但必须有原文。
- 供应商披露客户：可进入 `edges`，注意匿名客户。
- 注册数据：强化实体，不等于供应链关系。

### B 类：设施和地点，进入 facility candidates

- Open Supply Hub。
- 官方 supplier list。
- ESG / sustainability reports。
- responsible minerals / smelter lists。
- 工厂许可 / 环评 / 政府公告。

策略：

- 官方品牌供应商名单可支撑 Level 4 facility relation。
- 第三方贡献 facility claim 默认 Level 2/3。
- facility 地点事实可以高置信；供应关系仍需谨慎。

### C 类：宏观贸易、能源、价格和物流，只进入 observations

- UN Comtrade。
- U.S. Census International Trade API。
- USITC DataWeb。
- EIA。
- FRED。
- World Bank commodity prices。
- NOAA AIS。

策略：

- 进入 `macro_signals`、`trade_observations`、`commodity_observations`、`energy_observations`、`port_observations`、`route_observations`。
- 不直接生成 `NVIDIA -> TSMC` 这类公司级边。
- 可作为 ComponentCard / UnknownMap 的背景和 proxy。

### D 类：线索源，只进入 leads

- GDELT。
- SAM.gov。
- USAspending。
- EU TED。
- 招聘页面。
- 新闻、博客、社交媒体。

策略：

- 进入 `hypothesis_queue` / `lead_observations`。
- 默认不进 graph。
- 只有经过官方源或人工证据确认后，才能升级为边。

## P4：把 unknown map 变成核心产品能力

unknown map 不是“报告底部的备注”，而是系统诚实度的核心。

目标模型：

```text
unknown_items
unknown_type
affected_entity_id
affected_component_id
affected_edge_id
why_unknown
observable_proxy
data_sources_checked
last_checked_at
confidence_that_unknown
next_best_source
```

标准 unknown types：

```text
PRIVATE_CONTRACT
ANONYMIZED_CUSTOMER
MASKED_MANIFEST
COMPONENT_AMBIGUITY
ENTITY_AMBIGUITY
FACILITY_UNCONFIRMED
ORDER_VOLUME_UNOBSERVABLE
PRICE_DATA_PAYWALLED
LOGISTICS_ATTRIBUTION_UNOBSERVABLE
STALE_DISCLOSURE
CONFLICTING_EVIDENCE
```

验收：

- 每个 CompanyCard / ComponentCard 都必须输出 unknown map。
- unknown item 必须说明查过哪些源、为什么仍未知、下一步最该查什么。
- unknown map 不能为空；无 unknown 也要显式说明“当前未识别到未决问题”，并给出检查范围。

## P5：引入 Claim 层

边是图结构，claim 是可读结论，evidence 是证据，unknown 是边界。报告输出不能直接从 edge 拼自然语言，否则容易写出无证据扩展。

目标模型：

```text
claim_id
claim_text
claim_type
subject_id
object_id
component_id
edge_id
evidence_ids
confidence
evidence_level
language
generated_by
last_verified_at
is_inferred
unknowns
```

验收：

- 报告里的每一句事实性结论都有 `claim_id`。
- `claim_id` 能追到 `edge_id` 和 `evidence_ids`。
- unsupported claim rate = 0。

## PR 顺序

严格建议顺序：

1. Component taxonomy + memory/HBM 修正（规则抽取、`COMP-MEMORY` seed、`edges.component_id` / `component_specificity` 已落地；后续继续扩 taxonomy）。
2. Source authority matrix。
3. EntityResolver hardening。
4. Unknown extractor prefix fail-fast。
5. Exact citation offsets + evidence fingerprint。
6. SourceRegistry + FetchRun + SourceHealth。
7. Generic SEC rule pack。
8. CompanyCard / ComponentCard 升级。
9. Phase 3 observations 数据源接入。
10. ChainView / multi-tier segment contract（详见 [multi-tier-chain-logistics-plan.md](./multi-tier-chain-logistics-plan.md)）。

如果中途发现高置信边错误，暂停扩源，先修可信度。

## 质量门槛

- Unsupported claim rate = 0。
- Level 4/5 precision > 98%。
- Entity false merge rate = 0 tolerance。
- Evidence traceability hit rate = 100%。
- Unknown map coverage = 100%。
- Graph rebuild determinism = 100%。
- Source health visibility = 100%。
- Inferred edge ratio controlled；Phase 3 的 BOL / macro 推断边不得淹没官方证据边。

## 暂时不做

- 不为了演示效果先做漂亮 UI。
- 不在 Phase 2 接 Comtrade / EIA / NOAA / GDELT。
- 不让宏观数据直接生成公司级供应链边。
- 不为了把链画长，把原材料、港口、AIS、BOL 直接混成 Level 4/5 事实边；深链追踪必须按 `edge / observation / lead / unknown` 分层。
- 不把新闻 / 招聘 / 采购线索默认写入 graph。
- 不在本仓库输出投资建议。
- 不把 LLM 输出直接入图。

## 文档/实现一致性待处理

当前架构文档早期把 `pg-boss` 写得像 MVP 当前依赖，但 `v0.1.0-alpha.1` 代码还没有引入 `pg-boss`，实际是 CLI 单进程执行。下一步按这个原则修正：

- Phase 2：继续保持单进程 CLI，先补 source/fetch/change 的数据模型。
- Phase 3：如果开始持续监控和后台任务，再引入 `pg-boss`。
- 任何引入队列的 PR 必须同时补 source health、失败归档、重试和可观测 CLI。
