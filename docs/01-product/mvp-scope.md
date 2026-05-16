# MVP Scope — 第一版边界与验收标准

## MVP 名字

**Open Supply Chain Evidence Graph — AI Compute / Memory MVP**

不是 "投资 alpha 系统"。

## MVP 范围（IN）

### 1. 单一研究领域：AI 算力 / 内存链

仅覆盖：

```
需求端：Microsoft, Amazon, Alphabet, Meta, Oracle
芯片：NVIDIA, AMD, Broadcom
晶圆：TSMC, Samsung Foundry, Intel
内存：SK Hynix, Micron, Samsung Memory
设备：ASML, Applied Materials, Lam Research, KLA
组装/服务器：Foxconn (Hon Hai), Quanta, Wistron, Inventec, Supermicro, Dell, HPE
```

上述是 **25 个核心研究节点**，其中 `Samsung Foundry` / `Samsung Memory` 是 `business_unit`，不是独立法人。`Samsung Electronics` 作为连接这两个业务部门的母公司/桥接实体进入 seeds，但不计入 25 个核心研究节点。

**不包含**：新能源、汽车、机器人、消费电子整机、光模块（光模块留 Phase 3+）。

### 2. 数据源（仅 P0）

```
SEC EDGAR (10-K, 10-Q, 20-F, 8-K, XBRL)
公司 IR 官网（上面所列公司各自 IR 主页）
Apple Supplier List & Supply Chain Reports（参考用，不是主线）
TSMC / Samsung / SK Hynix / ASML IR
OpenCorporates（实体消歧）
UK Companies House（实体消歧补充）
```

P1 / P2 数据源（Comtrade、Census、USITC、EIA、FRED、NOAA、SAM.gov 等）**不进 MVP**，MVP 通过后再从 Phase 3 开始扩源。

### 3. 关系类型（MVP 必需）

默认查询输出聚焦前 6 种供应链关系；后 3 种是支撑实体层级/设施建模的结构关系，不作为供应链结论单独展示。

```
USES_FOUNDRY
BUYS_FROM (memory / chip)
SUPPLIES_TO
USES_COMPONENT
MANUFACTURES_AT
OWNS_SUBSIDIARY
OWNS_BUSINESS_UNIT
IS_A
OPERATES_FACILITY
```

其他关系（CAPEX_LINKED_TO / PRICE_EXPOSED_TO / DEPENDS_ON）**不在 MVP**。

### 4. 证据等级

完整实现 Level 1-5，但 MVP 阶段所有边必须 ≥ Level 4。Level 1-3 的数据可以入库，但**不出现在默认查询输出里**。

### 5. 输出形态（仅 CLI + JSON + Markdown）

```
$ supplystrata company nvidia --depth 1 --format markdown
$ supplystrata component hbm --format json
$ supplystrata evidence EV-000123
$ supplystrata unknown-map nvidia
```

详细规格见 [output-spec.md](./output-spec.md)。

**MVP 没有 Web UI、没有 GraphQL、没有图谱可视化界面**。Neo4j Browser 内置的查询界面已经够用作内部研究。

### 6. 实体覆盖度

MVP 出场时，`entity_master` 至少覆盖上述 25 个核心研究节点 + 它们一级上下游中已知的至少 50 个法人/桥接实体（含子公司、合资公司、晶圆厂法人、必要业务部门）。

## MVP 范围（OUT）

| 不在 MVP                  | 何时进入                  |
| ----------------------- | --------------------- |
| 贸易 / 海关数据               | Phase 3               |
| 能源 / 商品数据               | Phase 3               |
| AIS / 港口数据              | Phase 3               |
| 政府采购 / 新闻               | Phase 3               |
| 新能源链                    | Phase 4               |
| 汽车 / 半导体设备深链            | Phase 4               |
| Web 前端                  | Phase 4 之后再讨论          |
| 自动化推断（Level 1-3 自动入图）  | Phase 5（且需要 ADR 决议）   |
| 投资推断 / 回测               | 不在本仓库范围，单独立项          |

## 验收标准

MVP 验收 = 下列全部通过。

### A. 完整性

- [ ] 25 个核心研究节点全部进入 `entity_master`。
- [ ] 至少接入 SEC EDGAR + 4 家亚洲 IR + Apple Supplier List。
- [ ] 至少 100 条 `evidence_level >= 4` 的边。

### B. 可追溯性

- [ ] 任意一条边都能 1 跳到 `evidence` 记录。
- [ ] 任意一条 `evidence` 都包含原始文档 URL + 抓取时间 + 原文片段（≥ 30 字符）+ 抽取方法。
- [ ] 原始 PDF / HTML 全部落盘到对象存储（本地 MinIO 或 `data/raw/`）。

### C. 实体消歧

- [ ] `Foxconn / Hon Hai / 鴻海精密 / 富士康` 至少 4 个别名指向同一 `entity_master.id`。
- [ ] `Samsung Electronics` vs `Samsung Foundry` vs `Samsung Memory` 在图谱中是 3 个不同节点（母公司/业务线区分），且通过 `OWNS_BUSINESS_UNIT` 正确连接；孤立的 `Samsung` mention 必须进入 ambiguous review，不能默认 link。
- [ ] 实体消歧的 false-merge 率 < 1%（手动抽检 100 个节点）。

### D. CLI 输出质量

- [ ] `supplystrata company nvidia --depth 1` 输出包含：直接披露的供应商、每条边的证据 ID、来源类型、来源日期、原文片段。
- [ ] `supplystrata unknown-map nvidia` 输出至少 5 项明确的"我们不知道什么"。
- [ ] JSON 输出严格符合 [output-spec.md](./output-spec.md) 中定义的 schema。

### E. 法律合规

- [ ] 所有 P0 数据源都在 [legal-tos.md](../09-risks-compliance/legal-tos.md) 中明确合规。
- [ ] 所有 ingestion 请求带 User-Agent 与适当 rate limit。
- [ ] 不存在违反 robots.txt 的抓取。

### F. 可重现

- [ ] `pnpm install && pnpm db:migrate && pnpm ingest:p0 && pnpm extract` 在干净环境能跑通。
- [ ] 一份完整的 `seeds/entities.csv` + `seeds/aliases.csv` 入仓。
- [ ] `docker-compose up` 能起 Postgres + Neo4j + MinIO。

### G. 不允许的输出

如果以下任一条出现，MVP 算不达标：

- [ ] 系统输出"建议买入 / 建议卖出 / 看多 / 看空"
- [ ] 任何边没有 `evidence_id`
- [ ] LLM 输出未经审核就升级到 evidence_level 4-5
- [ ] 图谱里有"无来源 / 来源不明"的节点或边

## 风险与已知妥协

1. **TS 解析 XBRL 的工具不成熟**。MVP 阶段对 XBRL 的使用降级为：仅读 SEC 提供的 JSON `company-facts` API，不做完整 XBRL 解析。完整 XBRL 留到 Phase 3，可能引入 Python sidecar。
2. **Apple Supplier List PDF 的解析不稳定**。MVP 接受半自动：脚本下载 PDF + 人工 review CSV。
3. **韩文 IR 文件**：SK Hynix / Samsung 的部分原始文件是韩文。MVP 优先使用其英文版本（DART 同时提供英文）；如果英文缺失，标 `unverified` 并跳过。
4. **LLM 抽取的 false positive**。MVP 强制所有进入图谱的 LLM 边走人工 review 队列，不做自动 promote。

## 不达标怎么办

如果到时间窗口（见 [roadmap.md](../06-development/roadmap.md) Phase 2 结束）仍未达成全部验收：

1. 不延迟"声明 MVP 完成"的标准，宁可承认未达标。
2. 公开记录哪条没达成、为什么没达成。
3. 在不达标的前提下，**不**进入 Phase 3 的新数据源接入。
