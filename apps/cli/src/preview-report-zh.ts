import type { RelationType } from "@supplystrata/core";
import type { NvidiaResearchReportPreview, SupplyChainPreview } from "@supplystrata/source-workflows";

export function renderResearchReportZh(result: NvidiaResearchReportPreview): string {
  const nvidiaDate = result.nvidia.source_date === undefined ? "" : ` ${result.nvidia.source_date}`;
  const tsmcDate = result.tsmc.source_date === undefined ? "" : ` ${result.tsmc.source_date}`;
  const lines = [
    "# NVIDIA 供应链研究预览",
    "",
    "## 研究范围",
    "",
    `主来源：NVIDIA ${result.nvidia.document_type}${nvidiaDate}`,
    `背景来源：TSMC 2025 年报${tsmcDate}`,
    "",
    "## 有公开披露支持的一级上游",
    ""
  ];
  for (const candidate of sortPreviewCandidates(result.nvidia.candidates)) {
    const component = candidate.component === undefined ? "" : `（${translateComponent(candidate.component)}）`;
    const object = candidate.object_name ?? candidate.object_surface;
    const objectId = candidate.object_entity_id === undefined ? "" : ` [${candidate.object_entity_id}]`;
    lines.push(
      `- ${translateRelation(candidate.relation)}${component} -> ${object}${objectId} [Level ${candidate.evidence_level}, 置信度 ${candidate.confidence.toFixed(3)}]`
    );
    lines.push(`  证据原文：${translateEvidence(candidate.cite_text)}`);
    lines.push("");
  }
  lines.push("## TSMC 背景证据", "");
  lines.push(
    result.tsmc.mentions_nvidia
      ? "- TSMC 年报直接点名 NVIDIA。"
      : "- 已解析 TSMC 年报背景，但本预览没有发现 TSMC 年报直接点名 NVIDIA。因此这里是能力/背景证据，不是双边确认。"
  );
  for (const signal of result.tsmc.signals) {
    lines.push(`- ${translateTsmcSignal(signal.title)} [Level ${signal.evidence_level}, 置信度 ${signal.confidence.toFixed(3)}]`);
    lines.push(`  证据原文：${translateEvidence(signal.cite_text)}`);
  }
  appendOfficialSignalsZh(lines, "Samsung 背景证据", result.samsung);
  appendOfficialSignalsZh(lines, "SK hynix 背景证据", result.skhynix);
  appendOfficialSignalsZh(lines, "ASML 背景证据", result.asml);
  lines.push("", "## 未知地图", "");
  for (const item of defaultNvidiaUnknownMapZh()) {
    lines.push(`- ${item}`);
  }
  lines.push(
    "",
    "## 结论边界",
    "",
    "当前证据足以支持 NVIDIA 在晶圆代工、内存、组装测试封装服务上的一级上游图谱。当前证据不支持推断客户分配、合同价格、供应商季度出货量，也不输出任何投资结论。"
  );
  return lines.join("\n");
}

function appendOfficialSignalsZh(lines: string[], title: string, source: NvidiaResearchReportPreview["skhynix"]): void {
  lines.push("", `## ${title}`, "");
  if (source.error_message !== undefined) {
    lines.push(`- 当前源暂时不可用：${source.error_message}`);
    return;
  }
  if (source.signals.length === 0) {
    lines.push("- 暂未抽取到高置信背景信号。");
    return;
  }
  for (const signal of source.signals) {
    lines.push(`- ${translateTsmcSignal(signal.title)} [Level ${signal.evidence_level}, 置信度 ${signal.confidence.toFixed(3)}]`);
    lines.push(`  证据原文：${translateEvidence(signal.cite_text)}`);
  }
}

function sortPreviewCandidates(candidates: SupplyChainPreview["candidates"]): SupplyChainPreview["candidates"] {
  const relationRank: ReadonlyMap<RelationType, number> = new Map([
    ["USES_FOUNDRY", 1],
    ["BUYS_FROM", 2],
    ["SUPPLIES_TO", 3]
  ]);
  return [...candidates].sort((left, right) => {
    const relationDelta = (relationRank.get(left.relation) ?? 99) - (relationRank.get(right.relation) ?? 99);
    if (relationDelta !== 0) return relationDelta;
    return (left.object_name ?? left.object_surface).localeCompare(right.object_name ?? right.object_surface);
  });
}

function defaultNvidiaUnknownMapZh(): string[] {
  return [
    "按客户拆分的 HBM 精确分配量没有公开披露。",
    "合同价格、返利、产能预留条款没有公开披露。",
    "这份文件无法给出各上游供应商的季度出货量。",
    "设施级别的生产分配没有公开披露。",
    "运输路线、承运商和库存位置不在这个公开披露预览范围内。"
  ];
}

function translateRelation(relation: RelationType): string {
  if (relation === "USES_FOUNDRY") return "使用晶圆代工";
  if (relation === "BUYS_FROM") return "采购/依赖供应";
  if (relation === "SUPPLIES_TO") return "供应给";
  return relation;
}

function translateComponent(component: string): string {
  if (component === "wafer") return "晶圆";
  if (component === "memory") return "内存";
  if (component === "DRAM") return "DRAM";
  if (component === "HBM") return "HBM";
  if (component === "manufacturing services") return "制造服务";
  return component;
}

function translateTsmcSignal(title: string): string {
  const map = new Map([
    ["TSMC describes itself as a dedicated foundry", "TSMC 明确自身是纯晶圆代工模式"],
    ["TSMC reports broad customer and product coverage", "TSMC 披露客户和产品覆盖很广"],
    ["TSMC links demand to AI and HPC", "TSMC 将需求与 AI/HPC 应用联系起来"],
    ["TSMC highlights advanced packaging capacity", "TSMC 强调先进封装能力"],
    ["SK hynix links results to HBM demand", "SK hynix 将业绩与 HBM 需求联系起来"],
    ["SK hynix describes AI memory momentum", "SK hynix 描述 AI 内存需求动能"],
    ["SK hynix mentions advanced memory products", "SK hynix 提到先进内存产品"],
    ["Samsung describes HBM demand", "Samsung 描述 HBM 需求"],
    ["Samsung links memory business to AI servers", "Samsung 将内存业务与 AI 服务器需求联系起来"],
    ["Samsung mentions foundry performance", "Samsung 提到 Foundry 业务表现"],
    ["ASML reports EUV lithography demand", "ASML 披露 EUV 光刻需求"],
    ["ASML links business to semiconductor capacity", "ASML 将业务与半导体产能/客户需求联系起来"],
    ["ASML highlights AI-driven semiconductor demand", "ASML 强调 AI 带来的半导体需求"]
  ]);
  return map.get(title) ?? title;
}

function translateEvidence(text: string): string {
  const known = new Map([
    [
      "We utilize foundries, such as Taiwan Semiconductor Manufacturing Company Limited, or TSMC, and Samsung Electronics Co., Ltd., or Samsung, to produce our semiconductor wafers.",
      "NVIDIA 披露：公司使用 Taiwan Semiconductor Manufacturing Company Limited（TSMC）和 Samsung Electronics（Samsung）等晶圆代工厂生产半导体晶圆。"
    ],
    ["We purchase memory from SK Hynix Inc., Micron Technology, Inc., and Samsung.", "NVIDIA 披露：公司从 SK Hynix、Micron Technology 和 Samsung 采购内存。"],
    [
      "We engage with independent subcontractors and contract manufacturers such as Hon Hai Precision Industry Co., Ltd., Wistron Corporation, and Fabrinet to perform assembly, testing and packaging of our final products.Competition The market for our products is intensely competitive and is characterized by rapid technological change and evolving industry standards.",
      "NVIDIA 披露：公司与 Hon Hai Precision Industry、Wistron 和 Fabrinet 等独立分包商及合同制造商合作，进行最终产品的组装、测试和封装。"
    ],
    [
      "Our success is predicated on our steadfast adherence to the pure-play foundry business model.",
      "TSMC 披露：公司的成功建立在持续坚持纯晶圆代工商业模式之上。"
    ],
    [
      "We deployed 305 distinct process technologies, and manufactured 12,682 products for 534 customers.",
      "TSMC 披露：公司部署了 305 种不同制程技术，并为 534 个客户制造了 12,682 种产品。"
    ],
    [
      "Our plan will enable TSMC to scale up to an independent GIGAFAB® cluster in Arizona, to support the needs of our leading-edge customers in smartphone, AI and HPC applications.",
      "TSMC 披露：其亚利桑那 GIGAFAB 集群规划将支持智能手机、AI 和 HPC 应用中领先客户的需求。"
    ],
    [
      "We are also developing advanced packaging and 3D chip stacking technologies, including CoWoS®, InFO, TSMC-SoIC® (System on Integrated Chips) and TSMC-COUPETM (Compact Universal Photonic Engine), to enable large-scale interconnectivity for lower power consumption at affordable costs to support our customers’ needs.",
      "TSMC 披露：公司正在发展 CoWoS、InFO、TSMC-SoIC 等先进封装和 3D 芯片堆叠技术，以支持客户需求。"
    ],
    [
      "In addition to HBM, demand on conventional memory solutions for servers increased sharply, to which SK hynix responded proactively.",
      "SK hynix 披露：除 HBM 外，服务器用传统内存解决方案需求也大幅增长，公司对此进行了积极响应。"
    ],
    [
      "The company noted that as the AI market shifts from training to inference while demand for distributed architectures expands, the role of memory will become increasingly critical.",
      "SK hynix 披露：随着 AI 市场从训练转向推理、分布式架构需求扩大，内存的作用会变得越来越关键。"
    ],
    [
      "Conventional DRAM entered full-scale mass production of 1cnm process, or the sixth-generation of the 10-nanometer technology.",
      "SK hynix 披露：传统 DRAM 已进入 1cnm 制程，即第六代 10 纳米级技术的全面量产。"
    ],
    [
      "We deliver value throughout the semiconductor value chain. Our comprehensive lithography portfolio enables cost-effective microchip scaling for our customers.",
      "ASML 披露：公司贯穿半导体价值链交付价值，完整的光刻产品组合帮助客户以具成本效益的方式推进芯片微缩。"
    ],
    ["TWINSCAN NXE:3800E – full-specification system improves throughput by 37%", "ASML 披露：TWINSCAN NXE:3800E 全规格系统将吞吐量提高 37%。"]
  ]);
  return known.get(text) ?? text;
}
