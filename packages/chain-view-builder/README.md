# @supplystrata/chain-view-builder

`chain-view-builder` 从 truth store 构建 company supply-chain chain view。

## 负责什么

- 从 root company 出发查询 L4/L5 current fact edge。
- 构建 edge segment、claim segment、observation segment、lead segment 和 unknown segment。
- 按 component taxonomy 补上可解释的上游 lead 和 source hints。
- 输出 `@supplystrata/chain-view` 的 DTO。

## 不负责什么

- 不写数据库。
- 不生成新事实边。
- 不抓取 source。
- 不渲染最终 UI。

## 主要入口

- `buildCompanyChainView(client, input)`：构建 company chain view。
- `segmentFromComponentUpstreamLead(...)`：把 taxonomy lead 变成 segment。

## 边界约定

chain-view-builder 可以展示 observation/lead/unknown，但这些语义层不能被消费者误读成 fact edge。
