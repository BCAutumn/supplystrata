# Legal & ToS Overview — 法律与 ToS 概览

> **本文件不是法律意见**。任何重大决定前请咨询律师。但本文给出工程层面应当遵循的最低标准。

## 通用红线

**禁止**：

- 抓取明确禁止抓取的网站（robots.txt / ToS）
- 绕过登录、支付、API rate limit、付费墙
- 模仿浏览器伪装人类行为以欺骗反爬
- 重新发布版权材料的全文（仅 fair use 引用 + 链接到原文）
- 抓取 / 存储个人隐私（人脸、姓名 + 联系方式 + 偏好等）
- 未经授权使用商标 / 公司 logo

**允许**（一般而言）：

- 使用官方提供的 API / RSS / 公开 datasets
- 抓取 robots.txt 允许的公开 HTML
- 引用公开文档的片段（cite_text + URL，且不重发布全文）
- 用本地副本作为研究中间产物（不在外部分享）

## 各 P0/P1 数据源态度

| Source            | 状态              | 关键依据                                                  |
| ----------------- | --------------- | ----------------------------------------------------- |
| SEC EDGAR         | approved        | 官方 API + 强制 UA + 限速；公开文件                                |
| 公司 IR (各家)        | per-site review | 各家 robots.txt + ToS 单独检查；不抓动态接口；适当限速                    |
| Apple Supplier 报告 | approved        | 官方静态 PDF                                              |
| OpenCorporates    | approved        | 官方公开 API；遵守归因                                          |
| UK Companies House | approved      | 官方 API + 注册 key                                       |
| DART (KR)         | approved        | 官方 OPEN API + key                                     |
| TrendForce / DigiTimes 公开新闻文章 | manual only | 不做自动化抓取；仅手工录入引用片段                                     |
| ImportYeti        | manual only     | ToS 严禁自动化                                              |
| UN Comtrade       | approved        | 官方 API + 限速                                            |
| U.S. Census trade | approved        | 官方 API                                                |
| USITC DataWeb     | approved        | 官方 + 注册                                               |
| Open Supply Hub   | approved        | 官方 API + 注明来源                                          |
| EIA / FRED        | approved        | 官方 API                                                |
| NOAA AIS          | approved        | 公共领域                                                  |
| World Bank Pink   | approved        | 公共领域                                                  |
| USGS              | approved        | 公共领域                                                  |
| IEA Critical Minerals | approved    | 官方公开数据 / 下载；按 IEA 条款归因                            |
| RMI facility lists | per-source review | 官方列表；接入前确认下载、归因、再分发限制                         |
| EU CRMA           | approved        | 欧盟官方公开政策资料                                           |
| SAM.gov / USAspending | approved    | 官方 API                                                |
| EU TED            | approved        | 官方 API                                                |
| GDELT             | approved        | 公开数据集                                                  |

每个 source adapter 启动时必须在自身 README 注明 ToS 链接 + 限速 + UA 设置。CI 在每月 housekeeping 检查 ToS 链接仍可访问。

## SEC EDGAR 特别注意

- 官方建议 UA 含可联系邮箱
- 同 IP 限速：无 key 时建议 ≤ 10 req/s（保守用 5）
- 不允许在 robots.txt 禁区域抓取
- 不允许 RSS 订阅高频轮询（建议 ≥ 5 分钟）

## 公司 IR 特别注意

每家 IR 网站不一样。接 IR adapter 时必须：

1. 抓 robots.txt 验证路径
2. 单独写一份 README 注明
3. 遇到 Cloudflare / Akamai 严格反爬时不强行突破，留作 manual only

## ImportYeti 与海关数据

- ImportYeti 等聚合平台 ToS 通常禁止自动化
- 即使数据本身（CBP manifest）部分公开，**通过聚合平台抓取**仍受平台 ToS 约束
- 直接获取 CBP manifest 数据需要单独的法律合规路径（FOIA 等）—— 不在 MVP 范围
- MVP 阶段通过 manual evidence 录入 ImportYeti / Panjiva 提供的关键 BOL 信息时：
  - 必须人工 review
  - 不批量复制
  - 不与外界分享

## CBP Manifest Confidentiality

详见 [manifest-confidentiality.md](./manifest-confidentiality.md)。简言之：

- 美国 importer / consignee / shipper 可申请保密
- 公开 BOL 数据存在系统性盲区
- 系统输出必须明示这种盲区，不假装"看到了全部"

## LLM 调用合规

- 调用 LLM 时不向其传送用户敏感数据（本系统主要传文档片段，不涉及 PII）
- LLM 提供商的 ToS 中若有"训练数据使用条款"，确保 Opt-out（OpenAI / Anthropic 都允许）
- 输出的 LLM 内容不再标注 LLM 版权声明（属抽取，非 generation）

## 数据归属与重发布

- 我们不重发布：原始 PDF / HTML 全文（仅本地存档作研究证据）
- 我们引用：cite_text 片段（fair use）+ 来源 URL + 来源日期
- 我们公开（如本仓库 open source）：抽取出的结构化关系 + 我们自己的代码
- 公开仓库**禁止**包含：data/raw/ 下的原始字节

## 用户数据 / 隐私

MVP 没有用户系统。但仍需注意：

- log 中不记录个人邮箱 / 姓名（除了团队成员）
- 引用的高管 / 公开人物姓名属于公开信息，但不做个人追踪
- 不对个人决策做评级或预测

## 知识产权

- 仓库代码：Apache-2.0（见 ADR-005）
- seeds CSV：原创可放仓库
- 引用的第三方数据：仅引用，不再许可
- LLM 输出：默认归仓库所有（按 OpenAI / Anthropic ToS）

## 出口管制 / 制裁

- 不向被制裁实体提供数据
- 不对被制裁国家进行商业活动相关的供应链建模（个人研究层面尚可）

## 法律 / 政策审查触发条件

- 接入新数据源
- 公开发布 / 商业化
- 跨境数据传输
- 任何"灰色地带"的抓取需求
- 任何"投资建议"功能（明确排除！）

## 失败模式

如果发现某次抓取违反 ToS：

1. 立即停止该 adapter
2. 删除已抓数据（如适用）
3. 在 incidents.md 记录
4. 评估对图谱的影响
5. 提 PR 修正 adapter 或将该数据源 status 改为 `rejected`
