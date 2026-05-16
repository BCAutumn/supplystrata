# Tier G — 政府采购 / 新闻 / 弱信号

最弱的一层。**不直接生成供应链边**；用于：

- 发现新建设 / 新订单 / 新地区扩张的早期线索
- 验证已有 Level 4-5 边在外部环境里的合理性
- 作为 hypothesis_queue 输入

## G.1 SAM.gov (`sam-gov`)

### 用途

- 美国联邦采购机会（pre-solicitation / solicitation / award / sole source）
- 政府对 AI / 数据中心 / 国防 / 半导体设备等的采购意向

### 接入

- 公开 API（需注册 key）
- JSON

### 用法

- 跟踪联邦合同发布与中标
- 中标公告（award）作为该公司的需求确认（evidence_level 3-4）
- 但具体细节（合同价格 / 数量）一般不公开

## G.2 USAspending.gov (`usaspending`)

### 用途

- 美国联邦支出（合同 / 拨款 / 贷款 / 直接付款）
- 详细到 sub-recipient

### 接入

- 公开 API
- JSON / CSV

### 用法

- 验证某公司在政府供应链中的位置
- 跨年趋势

## G.3 EU TED (`eu-ted`)

### 用途

- 欧盟公共采购公告
- 多语言

### 接入

- TED API
- 多语言

### 用法

- 欧洲数据中心 / 能源项目采购的早期信号
- 中标公告

## G.4 GDELT (`gdelt`)

### 用途

- 全球新闻事件监测
- 100+ 语种
- 提取人物 / 地点 / 组织 / 主题 / 事件代码

### 接入

- 公开 API
- BigQuery 数据集（备选）

### 用法

- 触发线索（"某厂宣布建厂"、"某公司签约"）
- 进 hypothesis_queue
- 不直接进图谱

### 反模式

- "GDELT 说某地有事件，所以这是真的" —— GDELT 是聚合，错误率不低
- "GDELT 提到 X 和 Y 一起出现 100 次，所以 X→Y" —— 共现不等于关系

## G.5 公司招聘页面

- 招聘信息常常透露：新工厂、新产品线、新地区扩张
- 各公司招聘页结构不同

### 接入策略

- 不做自动抓取（很多公司明确禁止 scraping）
- MVP 通过手工 + 截图 + 录入 evidence

## G.6 政府许可 / 环评 / 建设公告

- 大型 fab / 数据中心 / 电池厂 / 港口扩建必经流程
- 各国接入方式高度异构

### MVP 处理

- 暂不做
- Phase 4 视情况

## 共同要求

- 这一层数据**默认 evidence_level 1**
- 仅当与 Level 4-5 边一致时，可作为该边的 supporting evidence（不会改 level）
- 单独使用 Level 1 信号时**禁止**生成新边

## 进入 Phase 3 时的接入顺序

```
1. sam-gov（结构化最规范）
2. usaspending（数据丰富但解析略复杂）
3. gdelt（信号大但噪声大）
4. eu-ted（多语言成本）
```

## 何时引入 Level 1 自动入图

不要轻易引入。任何"自动接受 Level 1 信号建边"的策略都必须：

- 开 ADR
- 给出 false-positive 上限指标（建议 < 5%）
- 配套人工审计抽样
- 失败可以一键 rollback
