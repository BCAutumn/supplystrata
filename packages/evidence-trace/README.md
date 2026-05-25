# @supplystrata/evidence-trace

`evidence-trace` 生成 evidence 的可审计 trace 字段。

## 负责什么

- 计算 cite text hash 和 normalized cite text hash。
- 在 chunk text 中定位 cite offset。
- 提取 parser version、extractor version 和 relation candidate hash。
- 为 evidence 写入和 backfill 提供一致 trace 计算。

## 不负责什么

- 不读取数据库。
- 不写 evidence。
- 不解析文档。
- 不在找不到 offset 时猜位置。

## 主要入口

- `buildEvidenceTrace(input)`：生成 trace 字段。
- `findCitationOffsets(chunkText, citeText)`：定位引用文本。
- `normalizeCiteTextForHash(text)`：引用文本归一化。

## 边界约定

缺失 offset 比错误 offset 更安全。找不到精确引用时应返回 null，让 data-quality 或人工审计暴露问题。
