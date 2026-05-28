**整体判断**
截至 2026-05-28，Tesla 供应链看起来是“规模大、纵向整合强，但关键环节仍有集中风险”。最核心压力在电池、电池材料、半导体/AI 算力、贸易政策和原材料可追溯性。SupplyStrata 当前对 Tesla 的状态是 `partial / observations_only`：SEC source checks 成功 2 个，但已审供应商事实边为 0，open unknown 为 1，所以不能把本地 API 输出当成已确认供应商图。

**关键环节和公司**
- 电池电芯：Tesla 官方 10-K 明确说当前依赖 Panasonic 和 CATL 供应锂离子电芯，且合格供应商数量有限、切换灵活性有限。Panasonic/CATL 是当前最明确的电芯供应节点。 SEC 10-K 同时说明 Tesla 仍在发展自有电芯能力。
- 电池材料：重点是锂、镍、铜、铝、钢等。Tesla 10-K 说明这些材料价格和供应受市场、贸易政策、冶炼能力和全球需求影响，并披露 Texas 自有锂精炼厂已在 2026 年 1 月开始运营。
- 储能电池：Tesla 2026 Q1 披露能源与储能业务受当前关税制度影响相对汽车业务更大，并强调继续扩大、垂直整合和本地化供应链。
- 半导体 / AI：Tesla 2025 10-K 明确提到与 Samsung 合作，在美国制造用于 AI 推理和训练的先进半导体。
- 未来美国储能电芯：Reuters 报道美国政府确认 Tesla 与 LG Energy Solution 的 LFP 电池协议，用于 2027 年起支持 Megapack 3；这是未来供应线索较强，但不等于当前产能已经上线。

**证据较强**
- Tesla 确实依赖大量全球供应商，并存在部分单一供应商风险；这是 Tesla 自己在 10-K 中披露的。
- Panasonic、CATL 是 Tesla 目前披露的电芯供应商；但 Tesla 没披露具体车型、地区、份额或价格。
- 电池材料和电芯是最核心瓶颈；Tesla 自己说电芯供应中断会限制汽车和储能产品生产。
- 贸易政策、关税、出口管制会影响供应链成本和可用性，且储能业务相对更敏感。

**只能算线索 / 不能下结论**
- SupplyStrata 当前没有 reviewed supplier fact edge，因此本地 API 不能证明具体供应商关系或依赖强度。
- BYD/FinDreams、具体 Megapack 电芯份额、车型级电芯供应、上游矿山/冶炼厂名单，本次没有足够官方证据，不能下确定结论。
- LG Energy Solution 更像“未来 Megapack 3 美国本地化供应链”的强线索；实际投产、爬坡、良率和供货规模仍要继续核实。
- SupplyStrata 的当前 reasoning walkthrough 偏 AI compute 传播链，和 Tesla 的 EV/储能主供应链并不完全重合；这是使用当前数据时的一个明显边界。

**最值得继续追踪的上游**
- 电芯：Panasonic、CATL、Tesla 自有 4680/LFP、LGES 未来 LFP。
- 锂与正极材料：Texas 锂精炼、正极材料工厂爬坡、原料来源。
- 镍、铜、铝、钢及关键电池材料可追溯性。
- 半导体：Samsung 合作的 AI 芯片、先进制程产能、封装/内存/HBM/服务器链条。
- 关税、IRA/OBBBA、FEOC、关键矿物来源证明对 Tesla 产品成本和补贴资格的影响。

**下一步研究建议**
1. 用 SupplyStrata 扩展 source targets：Tesla Responsible Sourcing、Conflict Minerals、Smelter/Refiner List、Panasonic、CATL、LGES、Samsung 官方披露。
2. 把研究问题拆成四张表：电芯供应商、储能电芯、原材料/冶炼、半导体/AI。
3. 对每条供应关系只在有官方文件或双来源交叉验证后标成事实；媒体报道先放 lead。
4. 优先核实“产品-地区-供应商”映射，比如 Fremont/Shanghai/Berlin/Texas、Megapack Lathrop/Shanghai/Houston。