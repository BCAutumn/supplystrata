**整体判断**

截至 2026-05-27，Tesla 的供应链看起来是“规模很大、正在继续垂直整合，但关键环节仍高度依赖少数电池与材料来源”。SupplyStrata 本地 API 当前只给出 `partial` 报告：SEC source checks 成功 2 个、无失败/待处理，但没有已审 L4/L5 供应链事实边，因此不能把具体供应关系当成项目内已确认事实。

**关键环节和公司**

| 环节          | 关键公司/对象                        | 判断                                                                                                                                                |
| ------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 电池电芯      | Panasonic、CATL                      | Tesla 2025 10-K 明确称当前依赖 Panasonic 和 CATL 等供应商提供锂电池电芯；这是最强证据之一。                                                         |
| 储能 LFP 电芯 | LG Energy Solution                   | Reuters 报道称美国政府确认 Tesla 与 LGES 的 43 亿美元 LFP 电芯项目，计划 2027 年在密歇根供应 Megapack 3；强线索，但 SupplyStrata 未审成 fact edge。 |
| 电池材料      | 锂、镍、铜、铝、钢；Tesla 德州锂精炼 | Tesla 10-K 明确列出原材料暴露，并称德州内部锂精炼厂 2026 年 1 月开始运营。                                                                          |
| 镍            | Talon Metals                         | Talon 官方披露与 Tesla 有 Tamarack 镍精矿供应协议，但条件包括项目商业化生产，不能视为已稳定供货。                                                   |
| 石墨负极材料  | Syrah Resources                      | Syrah/Tesla graphite offtake 存在，但 2025-2026 年有“alleged default/qualification”延期问题，当前更像风险点。                                       |
| AI / 半导体   | Samsung Electronics                  | 公开报道称 Tesla 与 Samsung 有 AI6 芯片制造协议；Tesla 10-Q 也强调半导体供应链垂直整合，但具体量产、节点、良率不能下结论。                          |

**证据比较强的判断**

- Tesla 官方披露：产品来自全球数千家供应商，存在单一供应商风险，并会在关键零部件上做多源认证与安全库存。
- Tesla 官方披露：电芯供应仍是关键瓶颈，明确点名 Panasonic 和 CATL；锂、镍等原材料价格和可得性会影响电芯供应与盈利。
- Tesla 官方披露：贸易政策和关税对供应链成本有明显影响，且当前关税对储能业务影响大于汽车业务。
- SupplyStrata API：当前没有已审供应链事实边，所以它不能证明任何具体 Tesla-供应商关系。

**只能算线索，不能下结论**

- LGES、Samsung 的大额合作属于高可信公开线索，但还没有进入 SupplyStrata 的已审事实层。
- Talon、Syrah、Piedmont 等上游协议证明“有过/存在协议”，不等于已经稳定交付、占比重要或替代了现有来源。
- 不能确认 Tesla 各车型、各工厂、各产品线分别使用哪些供应商、具体份额、价格、产能分配或合同履约状态。
- 不能从当前 API 结论推断 Tesla 已经完成电池、半导体或材料供应链本土化。

**最值得继续追踪的上游**

1. LFP 电芯：CATL 相关中国供应、LGES 美国供应项目、关税和原产地规则。
2. 锂精炼与正极材料：Tesla 德州锂精炼和 cathode material ramp 是否真正放量。
3. 石墨负极：Syrah Vidalia 与 Tesla offtake 的资格认证/违约争议是否解决。
4. 镍：Talon Tamarack 是否按条件进入商业化生产。
5. AI 芯片：Samsung Texas fab、AI6 时间表、先进制程设备和 HBM/服务器链路。

**下一步研究建议**

优先把 Tesla 10-K/10-Q 中已点名的 Panasonic、CATL、电池原材料风险做成 SupplyStrata fact candidates；其次核实 LGES、Samsung、Syrah、Talon 的最新官方文件或监管公告；最后补一轮 source checks，专门覆盖电池、石墨、镍、半导体和储能 LFP 项目。这样能把“新闻线索”逐步升级为可审计事实，或者明确保留为 unknown。
