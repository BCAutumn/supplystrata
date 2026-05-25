# @supplystrata/render

`render` 是后端 Markdown/文本渲染包。

## 负责什么

- 渲染 company card、component card、chain card、evidence card、unknown map、pending entity 和 change timeline。
- 定义卡片 DTO 中与展示直接相关的类型。
- 供 CLI 和 research-pack 输出可读 Markdown。

## 不负责什么

- 不查询数据库。
- 不构建 DTO。
- 不写任何数据。
- 不实现正式前端产品。

## 主要入口

- `renderCompanyCard(...)`
- `renderComponentCard(...)`
- `renderChainCard(...)`
- `renderEvidenceCard(...)`
- `renderUnknownMapCard(...)`
- `renderChangeTimelineItems(...)`

## 边界约定

Markdown 是可读输出，不是正式 UI 契约。正式数据契约应以 JSON DTO 为准。
