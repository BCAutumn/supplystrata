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

## Theming surface

默认主题刻意保持中性，只提供干净的只读 viewer 外壳。宿主应用可以通过 CSS custom properties、`::part()` 与 slots 接管视觉层；如果需要完全关闭默认外壳，可在组件上设置 `unstyled` attribute。

### CSS variables

| Variable                         | Scope                                           |
| -------------------------------- | ----------------------------------------------- |
| `--scbom-color-surface`          | shared surface background                       |
| `--scbom-color-text`             | shared primary text                             |
| `--scbom-color-muted`            | shared secondary text                           |
| `--scbom-color-border`           | shared borders                                  |
| `--scbom-color-accent`           | shared accent text and default graph node color |
| `--scbom-radius`                 | shared border radius                            |
| `--scbom-font-family`            | shared font family                              |
| `--scbom-evidence-level-5`       | evidence level 5 label color                    |
| `--scbom-evidence-level-4`       | evidence level 4 label color                    |
| `--scbom-evidence-level-3`       | evidence level 3 label color                    |
| `--scbom-evidence-level-2`       | evidence level 2 label color                    |
| `--scbom-evidence-level-1`       | evidence level 1 label and deprecated color     |
| `--scbom-evidence-level-unknown` | unknown evidence label color                    |
| `--scbom-graph-background`       | graph canvas and SVG background                 |
| `--scbom-graph-edge`             | graph SVG edge and arrow color                  |
| `--scbom-graph-node`             | graph SVG node fill                             |
| `--scbom-graph-node-stroke`      | graph SVG node stroke                           |
| `--scbom-graph-label-stroke`     | graph SVG label halo                            |

### Parts

Common shell parts: `surface`, `header`, `title`, `status`, `meta`, `accent`.

Evidence parts: `relationship-row`, `relationship-title`, `relationship-meta`, `evidence-level`, `validity`, `deprecated`, `evidence-list`, `citation`, `empty`, `evidence-ref`, `unresolved`, `source-link`, `locator`.

Unknown map parts: `unknown-item`, `unknown-question`, `unknown-scope`, `unknown-reason`.

Graph parts: `graph-canvas`, `graph-fallback`, `graph-list-title`, `graph-svg`, `graph-svg-edge`, `graph-svg-node`, `graph-svg-label`, `graph-node-list`, `graph-edge-list`.

### Slots

`toolbar` is available in every component header. `label` is available on `scbom-ping`.
