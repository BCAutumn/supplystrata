# Compliance — 数据许可、ToS 与伦理边界

本文不是法律意见，只定义工程执行时必须遵守的最低边界。

## 通用红线

禁止：

- 抓取明确禁止自动化的网站。
- 绕过登录、付费墙、rate limit 或反爬。
- 重新发布版权材料全文。
- 抓取或存储个人隐私。
- 把 ToS 灰色来源批量自动化。
- 把新闻、BOL、AIS 或贸易 observation 直接写成公司级 fact edge。

允许：

- 使用官方 API、RSS、公开 dataset。
- 抓取 robots.txt 允许的公开 HTML。
- 保存本地研究副本，但不外部分享原始 PDF / HTML / API 响应。
- 在输出中保留必要 cite text、source URL 和 source date。

## 数据源态度

| Source                          | 状态              | 说明                                  |
| ------------------------------- | ----------------- | ------------------------------------- |
| SEC EDGAR                       | approved          | 官方 API / 公开文件 / 限速 / UA       |
| 公司 IR                         | per-site review   | 每家 robots.txt / ToS 单独确认        |
| Apple Supplier 报告             | approved          | 官方静态报告                          |
| DART-KR / EDINET / TWSE / HKEX  | approved/reviewed | 官方披露路径，按各自 API/页面规则执行 |
| GLEIF / OpenCorporates / CH UK  | approved          | 官方或公开 API，遵守归因和限速        |
| Open Supply Hub                 | approved          | 官方 API，注明来源                    |
| UN Comtrade / Census / USITC    | approved          | 官方贸易数据，只进 observation        |
| EIA / FRED / World Bank / USGS  | approved          | 官方/公共数据，只进 observation       |
| NOAA AIS                        | approved          | 公共数据；不自动推导公司货物流向      |
| GDELT                           | approved          | 新闻 observation / lead，不进 facts   |
| ImportYeti / Panjiva            | manual only       | 不自动化抓取，只允许人工 review 路径  |
| TrendForce / DigiTimes 公开文章 | manual only       | 不批量抓取；仅手工引用公开片段        |

## CBP / BOL 边界

- 美国 importer / consignee / shipper 可申请 manifest confidentiality。
- BOL 数据存在系统性盲区，不能假装完整。
- 聚合平台 ToS 通常禁止自动化，不能绕过。
- 手工录入 BOL 线索时只能作为 lead 或低等级 evidence，并且必须人工 review。

## LLM / AI 边界

核心架构：

- 核心代码**不内置 agent loop**；`@supplystrata/agent` 是独立 npm 包，optional dependency。
- 核心 LLM 调用**只能经过 `@supplystrata/llm-helpers`**，全局可禁用；任何写 `edges` / `evidence` / `claims` 的代码路径不允许 import 该包。
- 外部 agent（Cursor / Claude Desktop / 自建）通过 MCP 接入；MCP write tools 必须经过 server-side pending state + 单次 `confirmation_token`，agent 不能自动批准。
- 详见 [decisions.md](../10-decisions/decisions.md) #3、#7、#9。

执行约束：

- LLM 只做候选抽取、片段定位、只读解释、entity 消歧、dynamic profile derive、source target 建议。
- LLM 输出必须有 cite text，且不能生成 Level 5。
- LLM 不写本地 cache、不审批 review、不关闭 unknown、不修改 fact edge。
- 外部 AI 不提供 evidence / review / 爬虫结果回写接口；MCP 暴露的写工具只能触发受控 source-check 或研究 run，不能直接写事实。
- 不公开未脱敏 prompt / response；prompt / output hash 写入 `ai_analysis_runs` 审计表。

## License

- 仓库代码、文档和项目维护的 seed metadata 使用 Apache-2.0。
- 第三方原始数据不随仓库 license 重新授权。
- `data/`、`reports/`、`.env` 不进入公开仓库。

## 伦理边界

拒绝实现：

- 自动交易或荐股。
- 攻击性供应链弱点定位。
- 针对个人的监控。
- 绕过 ToS 或技术限制的数据抓取。

维护者责任：

- 错误不能甩锅给模型。
- 数据质量、证据链和 unknown map 必须可审计。
- 为了“看起来完整”而牺牲诚实度，是系统性失败。
