# Data Licenses — 数据源许可

每个数据源的 license 状态汇总。**任何与商业化相关的决策必须征询律师**。

| Source                          | License / 性质                              | 我们能做                          | 我们不能做                       |
| ------------------------------- | ------------------------------------------- | --------------------------------- | -------------------------------- |
| SEC EDGAR                       | Public domain (US government)               | 全部使用、引用、重新发布          | 无禁                             |
| 公司 IR                         | 版权属公司                                  | fair use 引用片段；本地存档作证据 | 重新发布全文 / 长片段            |
| Apple Supplier 报告             | 版权属 Apple                                | 引用、抽取关系                    | 把 PDF 重新发布                  |
| OpenCorporates                  | OC ToS（含 attribution 要求）               | 数据使用 + 注明来源               | 商业批量再发布（需付费 license） |
| UK Companies House              | UK Open Government License v3.0             | 商业 / 非商业均可，需注明来源     | 暗示官方背书                     |
| DART (KR)                       | KOFIA / 韩国政府数据                        | 公共使用 + 引用                   | 商业再发布需另问                 |
| TrendForce / DigiTimes 公开新闻 | 版权属各媒体                                | fair use 引用片段                 | 大量复制 / 翻墙获取              |
| UN Comtrade                     | UN License (rather permissive for research) | 引用、研究、非商用                | 大规模商业再发布需许可           |
| U.S. Census trade               | Public domain                               | 全部使用                          |                                  |
| USITC DataWeb                   | 美国政府数据                                | 全部使用                          |                                  |
| Open Supply Hub                 | OSH 数据使用条款（一般公开 / 注明来源）     | 数据使用                          | 不遵守 attribution               |
| EIA / FRED                      | 美国政府数据                                | 全部使用                          |                                  |
| NOAA AIS                        | 公共领域                                    | 全部使用                          |                                  |
| World Bank Pink                 | 公共领域                                    | 全部使用                          |                                  |
| USGS                            | 公共领域                                    | 全部使用                          |                                  |
| SAM.gov / USAspending           | 美国政府数据                                | 全部使用                          |                                  |
| EU TED                          | 欧盟开放数据                                | 全部使用                          |                                  |
| GDELT                           | 公开数据集（特定 dataset 各自许可）         | 一般可使用                        | 大量重发布，注明许可             |
| ImportYeti                      | 平台 ToS（禁止自动化、严格使用条款）        | 仅人工查询                        | 自动化抓取 / 批量保存            |

## 我们仓库的 license 选择

已决议使用 **Apache-2.0**（见 [ADR-005](../10-decisions/ADR-005-open-source-license.md)）。

- 代码、文档和项目维护的 seed metadata 使用 Apache-2.0。
- 第三方原始文档、PDF、HTML、API response 不随仓库许可重新授权。
- 不选 GPL / AGPL：当前目标是方便 agent / 桌面端 / API 产品嵌入。

## 第三方数据的本地存档

- `data/raw/` 中的原始字节**仅作研究证据**
- 不放入 git，不公开分享
- 即使本仓库公开 OSS，data/raw 也不入仓
- 如果某来源 ToS 禁止本地存档，必须改为"不存原文，只存 cite_text + URL"

## attribution 模板

仓库 README + 公开输出中必须保留：

```
This project uses public data from:
- SEC EDGAR (https://www.sec.gov/edgar)
- OpenCorporates (https://opencorporates.com)
- UN Comtrade (https://comtrade.un.org/)
- U.S. Energy Information Administration
- ...
Each citation in the output is linked back to its primary source.
```

## CC-BY 风格的输出

我们自己的产出（图谱结构、抽取规则、CompanyCard schema）建议默认 **CC BY 4.0** 或类似（待 ADR）。

## 公开发布前 checklist

如果未来要公开仓库 / 输出：

- [ ] 检查 data/raw 不在仓库
- [ ] 检查 .env / 密钥不在仓库
- [ ] README 含 attribution 段落
- [ ] LICENSE 文件存在（仓库代码）
- [ ] 公开数据来源附 license 明示
- [ ] 检查是否引用了禁止重发布的内容
- [ ] 检查 CI 配置不泄漏私有 secrets
