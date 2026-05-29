# @supplystrata/web

`@supplystrata/web` 是中立 SCBOM viewer 的交付包。

## 负责什么

- L0 headless core：把任意 SCBOM document 规范化成 `ScbomView`。
- L1 Web Components：以 `scbom-*` 自定义元素渲染只读视图。
- 产出 ESM 与 IIFE，供 npm 构建链和 `<script>` 嵌入使用。

## 不负责什么

- 不读取 SupplyStrata DB、WorkbenchModel 或 MCP write tool。
- 不触发 source check、review、research session 等写入流程。
- 不内置 React、Vue、Svelte wrapper。

## 边界约定

L0 入口必须保持零 DOM、零网络、零框架依赖。L1 可以使用 Lit 编写标准 Web Components，但组件输入仍然只接受 SCBOM。
