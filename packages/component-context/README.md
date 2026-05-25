# @supplystrata/component-context

`component-context` 是组件、上游依赖、HS/材料代理码和材料观测目标的静态 taxonomy。

## 负责什么

- 维护 component upstream lead catalog。
- 维护 component trade taxonomy 和 material taxonomy。
- 输出材料暴露、HS 代理码和 material observation target。
- 支撑 source-plan、chain-view-builder、card-builder 和 research-pack 的组件语义。

## 不负责什么

- 不写数据库。
- 不抓取贸易或材料数据。
- 不把 taxonomy lead 当作 fact edge。
- 不给未审计组件关系生成证据等级。

## 主要入口

- `listComponentUpstreamLeads(componentId, maxTierDepth)`：列出上游依赖线索。
- `listComponentHsCodes(componentId)`：列出 HS 代理码。
- `listComponentMaterialExposures(componentId)`：列出材料暴露。
- `listComponentMaterialObservationTargets(componentId)`：列出材料数据源目标。

## 边界约定

taxonomy 是研究导航，不是事实图谱。它可以提示下一层该研究什么，不能证明某家公司与某家公司存在供应关系。
