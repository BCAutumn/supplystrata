# @supplystrata/supplier-list

`supplier-list` 是固定宽度供应商名单文本的候选抽取器。

## 负责什么

- 从 supplier list 文本中抽取 supplier、facility/location、country 或 region。
- 生成需要 review 的 `SupplierListCandidate`。
- 保留原始行文本、locator、buyer、fiscal year 和 relation hints。

## 不负责什么

- 不写 review queue。
- 不创建 supplier 或 facility entity。
- 不写 buyer-supplier fact edge。
- 不判断候选是否真实有效。

## 主要入口

- `extractFixedWidthSupplierListCandidates(text, config)`：抽取固定宽度供应商名单候选。

## 边界约定

supplier list candidate 必须走 review/apply。即使来源是官方名单，也不能绕过实体解析、证据评分和受控图写入。
