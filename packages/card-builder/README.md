# @supplystrata/card-builder

`card-builder` 是后端卡片 DTO 的读取层。它为公司、组件、链路和证据生成可展示、可导出的聚合模型。

## 负责什么

- 构建 CompanyCard、ComponentCard、ChainCard、EvidenceCard 和 UnknownMap。
- 汇总 L4/L5 current fact edges、primary evidence、source URL、observations、risk view、financial peer metrics、edge strength/freshness 和 unknown map。
- 把 DB row 映射成 `@supplystrata/render` 的卡片 DTO。

## 不负责什么

- 不写数据库。
- 不抓取 source。
- 不执行 source-plan 或 review apply。
- 不生成新的 claim、edge、evidence 或 unknown。
- 不做正式前端 UI。

## 主要入口

- `loadCompanyCard(client, query, options)`：公司卡片。
- `loadComponentCard(client, query, options)`：组件卡片。
- `loadChainCard(client, query, input)`：链路卡片。
- `loadEvidenceCard(client, evidenceId)`：证据卡片。
- `loadUnknownMap(client, query)`：显式 unknown map。

## 边界约定

card-builder 是读模型聚合层。业务判断和派生刷新应在 claim-builder、evidence-maintenance 或 research-pack 中完成，卡片只读取当前已存在的上下文。
