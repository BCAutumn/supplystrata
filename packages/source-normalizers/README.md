# @supplystrata/source-normalizers

`source-normalizers` 把 raw source document 转成统一 `NormalizedDocument`。

## 负责什么

- 规范化 HTML 文档。
- 规范化已提取文本或结构化 JSON 文本。
- 统一文本清洗、chunking、parser metadata、primary entity 和 source date。

## 不负责什么

- 不抓取 source。
- 不写 object store 或数据库。
- 不抽取 relation、observation 或 signal。
- 不改变 source authority。

## 主要入口

- `normalizeHtmlDocument(input)`：HTML raw document 归一化。
- `normalizeTextDocument(input)`：文本 raw document 归一化。
- `stringMetadata(raw, key)`：读取字符串 metadata。

## 边界约定

normalizer 只处理文档形状。业务语义抽取必须留在 extractor / pipeline / review flow。
