# Tier B — 实体解析数据源

不直接产生供应链边，但是**整个系统的地基**：保证我们抽到的 "Foxconn" / "Hon Hai" / "鸿海" 在数据库里指向同一个实体（或正确的不同实体）。

## B.1 OpenCorporates (`opencorporates`)

### 用途

- 全球公司基础登记
- 别名 / 前称 / 注册地址
- 注册号、注册管辖区
- 来源追踪（每条数据都标注其 primary public source）

### 接入

- 官方 REST API（限速；有付费层提高额度）
- MVP 阶段使用免费/低额度 token；通过 `OPEN_CORPORATES_API_TOKEN` 配置
- 必须遵守归因（attribution）要求
- 当前实现状态：`preview`。`entity lookup` 只输出候选，不自动 merge 到 `entity_master`

### 字段映射

| OC 字段                          | entity_master 映射                |
| ------------------------------ | ------------------------------- |
| `name`                         | canonical_name 候选               |
| `previous_names[]`             | aliases (`alias_kind="former"`) |
| `alternative_names[]`          | aliases (`alias_kind="informal"`) |
| `jurisdiction_code`            | primary_country (映射 ISO 2)      |
| `incorporation_date`           | founded_year                    |
| `company_number`               | identifiers.open_corporates_id  |
| `registered_address`           | hq_location                    |

### 已知坑

- 一家集团下可能有数十个法人，名称非常相似
- 历史改名链不完整
- 某些司法辖区数据稀疏（开曼/BVI 子公司常见缺数据）

### 用法

- 拉取 P0 名单中每家公司的 OC 实体记录
- 对比 SEC / IR 上的命名，补别名表
- 不直接生成边

## B.2 UK Companies House (`companies-house`)

### 用途

- 英国公司精确登记
- 控股关系（PSC, Persons with Significant Control）
- Filing history

### 接入

- 官方免费 API（需注册 key）
- 通过 `COMPANIES_HOUSE_API_KEY` 配置；HTTP Basic Auth，API key 作为 username
- 限速：官方文档口径为 5 分钟 600 次
- 必须 `https`
- 当前实现状态：`preview`。只输出英国公司候选，不自动 merge 到 `entity_master`

### 字段映射

| CH 字段                  | entity_master 映射                |
| ---------------------- | ------------------------------- |
| `company_name`         | canonical_name 候选               |
| `company_number`       | identifiers.companies_house_number |
| `registered_office_address` | hq_location                |
| `previous_company_names`    | aliases (former)              |
| `accounts.next_due`         | metadata                      |

### 用法

- 主要用于英国公司（如 ARM Ltd. 历史身份等）
- PSC 数据可推断少量 OWNS_SUBSIDIARY 关系（evidence_level 4 — 政府登记）

## B.3 LEI（Legal Entity Identifier）查询

LEI 不是一个独立 adapter；它是一种 identifier 标准。

### 接入

- GLEIF 公开数据集（CSV / JSON 下载）
- LEI ROC 提供 lookup API

### 用法

- 当某实体有 LEI 时，写入 `identifiers.lei`
- 集团结构（parent / ultimate parent）可作为 OWNS_SUBSIDIARY 推断（evidence_level 3-4）

### 注意

- LEI 关系树有时不全（不是所有实体都报告）
- 但 LEI 是优先级最高的 identifier；命中即等价于 evidence_level 5

## B.4 SEC CIK / ticker mapping

- SEC 提供 `company_tickers.json` 公共文件
- 用于将 ticker → CIK → entity_master 映射
- 静态文件，每天 refresh 一次即可

## B.5 公司官网 legal entity / subsidiary 列表

- 大公司的"corporate structure"页面或年报附录会列出主要子公司
- 解析后作为 OWNS_SUBSIDIARY edges（evidence_level 4-5）
- 这些数据归 `company-ir` adapter，但服务于 entity-resolution

## B.6 `seeds/aliases.csv` 手工补全

- 人工导入的别名（中文 / 简繁 / 缩写）
- 必须有 source_type（默认 `manual`）
- PR 增量更新

## 实施顺序

```
Phase 0:
  seeds/entities.csv
  seeds/aliases.csv (手工)
  CIK / ticker / LEI 静态映射

Phase 2 (MVP Core):
  opencorporates 接入（已实现 lookup preview；下一步做 review/import）
  companies-house 接入（已实现 lookup preview；下一步做 review/import）

Phase 3+:
  GLEIF bulk 接入
  ESG / corporate structure 自动抽取
```

## 实体消歧算法（高层）

详细见 [05-modules/entity-resolution.md](../05-modules/entity-resolution.md)。这里只列依赖于 Tier B 的部分：

1. **identifier match**：LEI / CIK / ISIN / Ticker → 直接命中
2. **strict alias match**：alias_norm 完全匹配 + 上下文一致
3. **fuzzy alias + context**：编辑距离 + 共现实体 + 行业线索
4. **LLM 辅助**：上述都失败时调用 LLM，并要求引用上下文。结果默认进 review

## 已知 false-merge / false-split 风险

- "Samsung" 单独出现 → 大概率 false-merge 到母公司，但应该解析到具体业务部门
- "Foxconn" 看似明确但可能指 FII / Hon Hai / 富士康某子公司
- "Apple" 在某些供应链场景指 Apple Operations International（开曼实体），需根据上下文判断
- "TSMC" vs "TSMC Arizona" vs "JASM"

EntityResolver 必须对这几个实体 hard-code 上下文消歧规则。
