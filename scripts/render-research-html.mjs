#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

const [inputPath, outputPath] = process.argv.slice(2);
if (inputPath === undefined || outputPath === undefined) {
  console.error("Usage: node scripts/render-research-html.mjs <input.json> <output.html>");
  process.exit(1);
}

const payload = JSON.parse(await readFile(inputPath, "utf8"));
const report = payload.report;
if (report === undefined || report.nvidia === undefined) {
  throw new Error("Expected preview report JSON with report.nvidia");
}

const candidates = report.nvidia.candidates ?? [];
const edgeRows = candidates.map((candidate, index) => ({
  id: `edge-${index + 1}`,
  subject: candidate.subject_name ?? candidate.subject_surface,
  relation: candidate.relation,
  object: candidate.object_name ?? candidate.object_surface,
  component: candidate.component ?? "unspecified",
  level: candidate.evidence_level,
  confidence: candidate.confidence,
  cite: candidate.cite_text,
  locator: candidate.cite_locator,
  extractorId: candidate.extractor_id,
  category: edgeCategory(candidate)
}));
const signals = [
  ...sourceSignals("TSMC", report.tsmc),
  ...sourceSignals("Samsung", report.samsung),
  ...sourceSignals("SK hynix", report.skhynix),
  ...sourceSignals("ASML", report.asml)
];
const sourceCards = [
  sourceCard("NVIDIA SEC 10-K", report.nvidia.fetched_url, report.nvidia.source_date, report.nvidia.chunks, `${candidates.length} edges`),
  sourceCard("TSMC IR", report.tsmc?.fetched_url, report.tsmc?.source_date, report.tsmc?.chunks, `${report.tsmc?.signals?.length ?? 0} signals`),
  sourceCard("Samsung IR", report.samsung?.fetched_url, report.samsung?.source_date, report.samsung?.chunks, `${report.samsung?.signals?.length ?? 0} signals`),
  sourceCard(
    "SK hynix IR",
    report.skhynix?.fetched_url,
    report.skhynix?.source_date,
    report.skhynix?.chunks,
    `${report.skhynix?.signals?.length ?? 0} signals`
  ),
  sourceCard("ASML IR", report.asml?.fetched_url, report.asml?.source_date, report.asml?.chunks, `${report.asml?.signals?.length ?? 0} signals`)
];

const unknowns = [
  {
    type: "PRIVATE_CONTRACT",
    title: "具体 HBM / memory allocation",
    body: "公开 10-K 可确认 memory supplier，但不能确认每家供应商的具体代际、季度份额和订单量。"
  },
  {
    type: "ORDER_VOLUME_UNOBSERVABLE",
    title: "采购量与合同价格",
    body: "公开披露没有给出 NVIDIA 对每个供应商的采购金额、价格条款和容量预留细节。"
  },
  {
    type: "LOGISTICS_ATTRIBUTION_UNOBSERVABLE",
    title: "运输路线与承运商",
    body: "SEC 披露不能推出具体物流路线、库存位置或承运商；这些只能作为后续弱信号/观测层。"
  },
  {
    type: "FACILITY_UNCONFIRMED",
    title: "具体制造设施",
    body: "供应商公司级关系已确认，但对应到 wafer fab、OSAT、EMS 工厂仍需要 Apple/OSH/IR 等来源交叉验证。"
  },
  {
    type: "COMPONENT_AMBIGUITY",
    title: "memory 不能自动升级为 HBM",
    body: "没有出现 HBM / High Bandwidth Memory 等原文时，图上必须保持 memory 粒度，避免伪精确。"
  }
];

const graph = buildGraph(edgeRows, signals);

await writeFile(outputPath, html(), "utf8");

function sourceSignals(source, item) {
  return (item?.signals ?? []).map((signal, index) => ({ source, id: `${source.toLowerCase().replaceAll(" ", "-")}-${index + 1}`, ...signal }));
}

function sourceCard(name, url, date, chunks, summary) {
  return {
    name,
    url: url ?? "",
    date: date ?? "unknown",
    chunks: chunks ?? 0,
    summary
  };
}

function edgeCategory(candidate) {
  const relation = candidate.relation ?? "";
  const component = candidate.component ?? "";
  if (relation === "USES_FOUNDRY") return "foundry";
  if (component.toLowerCase().includes("memory")) return "memory";
  if (component.toLowerCase().includes("manufacturing")) return "manufacturing";
  return "other";
}

function buildGraph(edges, signalRows) {
  const rows = edges.map((edge, index) => ({
    ...edge,
    y: 116 + index * 72,
    color: categoryColor(edge.category),
    categoryLabel: categoryLabel(edge.category)
  }));
  const signalNodes = signalRows.map((signal, index) => ({
    ...signal,
    y: 102 + index * 48,
    sourceKey: canonicalName(signal.source)
  }));
  const height = Math.max(720, Math.max(rows.length * 72 + 210, signalNodes.length * 48 + 210));
  return { rows, signalNodes, height, width: 1240 };
}

function categoryColor(category) {
  if (category === "foundry") return "#2758c4";
  if (category === "memory") return "#0f766e";
  if (category === "manufacturing") return "#9a5b13";
  return "#596579";
}

function categoryLabel(category) {
  if (category === "foundry") return "Wafer Foundry";
  if (category === "memory") return "Memory";
  if (category === "manufacturing") return "Manufacturing Services";
  return "Other";
}

function html() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SupplyStrata NVIDIA Chain Graph Preview</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #17212b;
      --muted: #667085;
      --soft: #eef2f7;
      --line: #d7dee8;
      --panel: #ffffff;
      --page: #f5f7fb;
      --evidence: #0f766e;
      --blue: #2758c4;
      --gold: #9a5b13;
      --danger: #b42318;
      --good: #087443;
      --shadow: 0 14px 35px rgba(21, 31, 46, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background: var(--page);
    }
    header {
      padding: 26px 32px 18px;
      background: #ffffff;
      border-bottom: 1px solid var(--line);
    }
    main {
      padding: 20px 32px 40px;
      max-width: 1500px;
      margin: 0 auto;
    }
    h1 { margin: 0 0 8px; font-size: 28px; letter-spacing: 0; }
    h2 { margin: 0 0 14px; font-size: 18px; letter-spacing: 0; }
    h3 { margin: 0 0 8px; font-size: 15px; letter-spacing: 0; }
    p { margin: 0; line-height: 1.55; }
    a { color: var(--blue); text-decoration: none; }
    a:hover { text-decoration: underline; }
    button {
      font: inherit;
      border: 1px solid var(--line);
      background: #fff;
      color: var(--ink);
      border-radius: 6px;
      min-height: 32px;
      padding: 0 10px;
      cursor: pointer;
    }
    button:hover { border-color: var(--blue); }
    .subhead { color: var(--muted); max-width: 1080px; }
    .toolbar { display: flex; gap: 10px; align-items: center; margin-top: 18px; flex-wrap: wrap; }
    .chip {
      display: inline-flex;
      align-items: center;
      min-height: 30px;
      padding: 0 10px;
      border: 1px solid var(--line);
      background: #fff;
      border-radius: 6px;
      color: var(--muted);
      font-size: 13px;
    }
    .grid { display: grid; gap: 16px; }
    .metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 16px; }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
      box-shadow: var(--shadow);
    }
    .metric strong { display: block; font-size: 26px; margin-bottom: 4px; }
    .metric span { color: var(--muted); font-size: 13px; }
    .chain-shell {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 390px;
      gap: 16px;
      align-items: stretch;
    }
    .chain-panel { padding: 0; overflow: hidden; }
    .chain-header {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      align-items: flex-start;
      padding: 16px 16px 10px;
      border-bottom: 1px solid var(--line);
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
      color: var(--muted);
      font-size: 12px;
    }
    .legend-item { display: inline-flex; align-items: center; gap: 6px; }
    .swatch { width: 20px; height: 3px; border-radius: 999px; background: var(--ink); }
    .swatch.dashed { border-top: 2px dashed #8a95a5; height: 0; background: transparent; }
    .chain-canvas {
      width: 100%;
      overflow: auto;
      background:
        linear-gradient(90deg, rgba(247,249,252,0.98), rgba(255,255,255,0.94)),
        repeating-linear-gradient(0deg, transparent 0, transparent 47px, rgba(215,222,232,0.45) 48px);
    }
    svg { display: block; min-width: 1120px; width: 100%; height: auto; }
    .lane-title { font-size: 13px; font-weight: 700; fill: #344054; }
    .lane-subtitle { font-size: 11px; fill: #667085; }
    .node-rect {
      fill: #ffffff;
      stroke: #cdd5e1;
      stroke-width: 1;
      filter: drop-shadow(0 6px 14px rgba(21,31,46,0.08));
    }
    .node-title { fill: #17212b; font-size: 13px; font-weight: 800; }
    .node-meta { fill: #667085; font-size: 11px; }
    .edge-line {
      fill: none;
      stroke-linecap: round;
      stroke-width: 3.5;
      cursor: pointer;
    }
    .edge-hit {
      fill: none;
      stroke: transparent;
      stroke-width: 18;
      cursor: pointer;
    }
    .edge-line.active { stroke-width: 6; }
    .signal-link {
      fill: none;
      stroke: #8a95a5;
      stroke-width: 2;
      stroke-dasharray: 5 6;
    }
    .unknown-boundary {
      fill: #fff7ed;
      stroke: #f0b56d;
      stroke-width: 1;
    }
    .unknown-line {
      stroke: #d97d13;
      stroke-width: 2;
      stroke-dasharray: 6 7;
    }
    .pill { fill: #f8fafc; stroke: #d7dee8; }
    .pill-text { fill: #344054; font-size: 11px; font-weight: 700; }
    .side-panel {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      gap: 14px;
    }
    .detail-card {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
      background: #fbfcfe;
    }
    .detail-label {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .detail-title { margin-top: 4px; font-weight: 800; font-size: 18px; }
    .detail-meta { margin-top: 8px; color: var(--muted); font-size: 13px; }
    .quote {
      margin-top: 12px;
      padding: 12px;
      border-left: 3px solid var(--evidence);
      background: #ffffff;
      color: #475467;
      font-size: 13px;
      line-height: 1.5;
    }
    .unknown-list {
      display: grid;
      gap: 9px;
      max-height: 330px;
      overflow: auto;
      padding-right: 4px;
    }
    .unknown-item {
      border: 1px solid #f1c48b;
      border-radius: 8px;
      padding: 10px;
      background: #fffaf3;
    }
    .unknown-item strong { display: block; font-size: 13px; }
    .unknown-item span { display: block; color: #7a4b13; font-size: 12px; margin-top: 3px; line-height: 1.45; }
    .source-list { grid-template-columns: repeat(5, minmax(0, 1fr)); margin-top: 16px; }
    .source-card { min-height: 120px; box-shadow: none; }
    .source-card .name { font-weight: 800; margin-bottom: 6px; }
    .source-card .meta { color: var(--muted); font-size: 12px; margin-top: 8px; line-height: 1.4; }
    .lower-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(340px, 0.9fr);
      gap: 16px;
      margin-top: 16px;
      align-items: start;
    }
    .edge-table, .signal-table { display: grid; gap: 10px; }
    .row-card {
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
    }
    .row-card.active { outline: 2px solid var(--blue); outline-offset: 1px; }
    .row-top {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: flex-start;
      margin-bottom: 6px;
    }
    .row-top strong { overflow-wrap: anywhere; }
    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 0 8px;
      border-radius: 999px;
      background: #ecfdf3;
      color: var(--good);
      font-size: 12px;
      font-weight: 800;
      white-space: nowrap;
    }
    .muted { color: var(--muted); }
    .small { font-size: 12px; line-height: 1.45; }
    .product-note {
      margin-top: 16px;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    .note-card {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      background: #fff;
    }
    .note-card strong { display: block; margin-bottom: 6px; }
    footer {
      color: var(--muted);
      padding: 0 32px 28px;
      max-width: 1500px;
      margin: 0 auto;
      font-size: 12px;
    }
    @media (max-width: 1120px) {
      main, header, footer { padding-left: 18px; padding-right: 18px; }
      .metrics, .chain-shell, .source-list, .lower-grid, .product-note { grid-template-columns: 1fr; }
      .chain-header { display: block; }
      .legend { justify-content: flex-start; margin-top: 10px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>SupplyStrata NVIDIA 供应链链路图</h1>
    <p class="subhead">这版把“链”放在第一屏：左侧是 NVIDIA，中间是直接披露的一级供应商，右侧是供应侧官方信号与未知边界。实线是可入图的高等级证据边，虚线只是观测信号，不偷偷升级成供应链事实。</p>
    <div class="toolbar">
      <span class="chip">NVIDIA 10-K: ${escapeHtml(report.nvidia.source_date ?? "unknown")}</span>
      <span class="chip">文档 chunks: ${escapeHtml(String(report.nvidia.chunks))}</span>
      <span class="chip">Level 4/5 边: ${escapeHtml(String(candidates.filter((candidate) => candidate.evidence_level >= 4).length))}</span>
      <span class="chip">官方信号: ${escapeHtml(String(signals.length))}</span>
      <span class="chip">Generated: ${escapeHtml(new Date().toISOString())}</span>
    </div>
  </header>
  <main>
    <section class="grid metrics">
      ${metric("证据边", candidates.length, "直接供应链边")}
      ${metric("一级供应商", new Set(edgeRows.map((edge) => edge.object)).size, "公司级节点")}
      ${metric("官方信号", signals.length, "供应侧观测")}
      ${metric("Unknowns", unknowns.length, "显式边界")}
    </section>

    <section class="chain-shell">
      <div class="panel chain-panel">
        <div class="chain-header">
          <div>
            <h2>Chain Graph</h2>
            <p class="muted small">点击任意实线或边列表，可在右侧查看对应证据。ASML 等供应侧信号保持为虚线观测层，避免把宏观/行业信息误写成公司边。</p>
          </div>
          <div class="legend" aria-label="legend">
            <span class="legend-item"><span class="swatch" style="background:#2758c4"></span>foundry</span>
            <span class="legend-item"><span class="swatch" style="background:#0f766e"></span>memory</span>
            <span class="legend-item"><span class="swatch" style="background:#9a5b13"></span>manufacturing</span>
            <span class="legend-item"><span class="swatch dashed"></span>official signal</span>
          </div>
        </div>
        <div class="chain-canvas">
          ${renderGraphSvg(graph)}
        </div>
      </div>

      <aside class="panel side-panel">
        <div>
          <h2>Evidence Card</h2>
          <div class="detail-card" id="edge-detail">
            ${renderInitialDetail(edgeRows[0])}
          </div>
        </div>
        <div>
          <h2>Unknown Boundary</h2>
          <div class="unknown-list">
            ${unknowns.map(renderUnknown).join("")}
          </div>
        </div>
        <div class="detail-card">
          <div class="detail-label">Product rule</div>
          <p class="small muted" style="margin-top:6px">前端必须默认展示证据强度、source health、unknown map。未来投资/金融决策层可以消费这些事实 API，但不能污染事实图谱。</p>
        </div>
      </aside>
    </section>

    <section class="grid source-list">
      ${sourceCards.map(renderSourceCard).join("")}
    </section>

    <section class="lower-grid">
      <div class="panel">
        <h2>直接证据边</h2>
        <div class="edge-table">${edgeRows.map(renderEdgeRow).join("")}</div>
      </div>
      <div class="panel">
        <h2>供应侧官方信号</h2>
        <div class="signal-table">${signals.map(renderSignal).join("")}</div>
      </div>
    </section>

    <section class="product-note">
      <div class="note-card">
        <strong>参考后的产品判断</strong>
        <p class="small muted">供应链软件的核心不是漂亮卡片，而是多层网络、证据链、持续监控和风险/未知边界。</p>
      </div>
      <div class="note-card">
        <strong>下一步 UI 契约</strong>
        <p class="small muted">后续正式前端应提供 CompanyGraph、ComponentGraph、EvidenceDrawer、SourceHealthPanel、UnknownMapPanel 五个独立视图模块。</p>
      </div>
      <div class="note-card">
        <strong>诚实边界</strong>
        <p class="small muted">当前公开官方源只确认公司级一级边；二级/三级链路需要更多文件、供应商名单、设施数据和监控事件逐步填充。</p>
      </div>
    </section>
  </main>
  <footer>Source JSON: ${escapeHtml(inputPath)} · HTML generated by scripts/render-research-html.mjs</footer>
  <script>
    const edgeRows = ${JSON.stringify(edgeRows)};
    const detail = document.getElementById("edge-detail");
    const cards = Array.from(document.querySelectorAll("[data-edge-card]"));
    const paths = Array.from(document.querySelectorAll("[data-edge-path]"));

    function renderDetail(edge) {
      return [
        '<div class="detail-label">' + escapeHtml(edge.categoryLabel ?? edge.category) + '</div>',
        '<div class="detail-title">' + escapeHtml(edge.subject) + ' → ' + escapeHtml(edge.object) + '</div>',
        '<div class="detail-meta">' + escapeHtml(edge.relation) + ' · ' + escapeHtml(edge.component) + ' · Level ' + edge.level + ' · confidence ' + Math.round(edge.confidence * 100) + '%</div>',
        '<div class="quote">' + escapeHtml(edge.cite) + '<br><span class="muted">Locator: ' + escapeHtml(edge.locator) + ' · Extractor: ' + escapeHtml(edge.extractorId) + '</span></div>'
      ].join("");
    }

    function selectEdge(edgeId) {
      const edge = edgeRows.find((item) => item.id === edgeId);
      if (!edge || !detail) return;
      detail.innerHTML = renderDetail(edge);
      for (const card of cards) card.classList.toggle("active", card.dataset.edgeCard === edgeId);
      for (const path of paths) path.classList.toggle("active", path.dataset.edgePath === edgeId);
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
    }

    for (const card of cards) {
      card.addEventListener("click", () => selectEdge(card.dataset.edgeCard));
    }
    for (const path of paths) {
      path.addEventListener("click", () => selectEdge(path.dataset.edgePath));
    }
  </script>
</body>
</html>`;
}

function renderGraphSvg(model) {
  const { width, height, rows, signalNodes } = model;
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="NVIDIA supply chain graph">
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#8a95a5"></path>
      </marker>
    </defs>
    ${renderLane(24, 26, 244, height - 52, "Demand anchor", "研究对象")}
    ${renderLane(304, 26, 314, height - 52, "Tier 1 official edges", "可入图关系")}
    ${renderLane(676, 26, 288, height - 52, "Supplier official signals", "观测层，不直接入边")}
    ${renderUnknownLane(1010, 26, 200, height - 52)}
    ${renderAnchorNode(82, height / 2 - 40)}
    ${rows.map((edge) => renderEdgePath(edge, height / 2, 318, edge.y, 448)).join("")}
    ${rows.map((edge) => renderSupplierNode(edge, 420, edge.y - 24)).join("")}
    ${signalNodes.map((signal) => renderSignalNode(signal, 704, signal.y - 18)).join("")}
    ${signalNodes.map((signal) => renderSignalLink(signal, rows)).join("")}
    ${rows.map((edge, index) => renderUnknownProbe(edge, index, 1010)).join("")}
    ${renderUnknownLabels(1032, 120)}
  </svg>`;
}

function renderLane(x, y, width, height, title, subtitle) {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="12" fill="#f8fafc" stroke="#e3e8ef"></rect>
    <text x="${x + 16}" y="${y + 28}" class="lane-title">${escapeHtml(title)}</text>
    <text x="${x + 16}" y="${y + 46}" class="lane-subtitle">${escapeHtml(subtitle)}</text>`;
}

function renderUnknownLane(x, y, width, height) {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="12" class="unknown-boundary"></rect>
    <line x1="${x + 18}" y1="${y + 62}" x2="${x + 18}" y2="${y + height - 24}" class="unknown-line"></line>
    <text x="${x + 36}" y="${y + 28}" class="lane-title">Unknown boundary</text>
    <text x="${x + 36}" y="${y + 46}" class="lane-subtitle">不能公开确认的部分</text>`;
}

function renderAnchorNode(x, y) {
  return `<g>
    <rect x="${x}" y="${y}" width="152" height="80" rx="10" class="node-rect"></rect>
    <text x="${x + 18}" y="${y + 30}" class="node-title">NVIDIA</text>
    <text x="${x + 18}" y="${y + 50}" class="node-meta">SEC 10-K disclosed buyer</text>
    <rect x="${x + 18}" y="${y + 58}" width="70" height="18" rx="9" class="pill"></rect>
    <text x="${x + 32}" y="${y + 71}" class="pill-text">anchor</text>
  </g>`;
}

function renderEdgePath(edge, anchorY, startX, targetY, endX) {
  const path = `M ${startX} ${anchorY} C ${startX + 88} ${anchorY}, ${endX - 90} ${targetY}, ${endX} ${targetY}`;
  return `<path d="${path}" class="edge-line" data-edge-path="${escapeAttr(edge.id)}" stroke="${edge.color}" opacity="0.82"></path>
    <path d="${path}" class="edge-hit" data-edge-path="${escapeAttr(edge.id)}"></path>`;
}

function renderSupplierNode(edge, x, y) {
  const title = trimLabel(edge.object, 23);
  return `<g data-edge-path="${escapeAttr(edge.id)}">
    <rect x="${x}" y="${y}" width="178" height="52" rx="9" class="node-rect"></rect>
    <circle cx="${x + 18}" cy="${y + 26}" r="5" fill="${edge.color}"></circle>
    <text x="${x + 32}" y="${y + 21}" class="node-title">${escapeHtml(title)}</text>
    <text x="${x + 32}" y="${y + 39}" class="node-meta">${escapeHtml(edge.categoryLabel)} · L${escapeHtml(String(edge.level))}</text>
  </g>`;
}

function renderSignalNode(signal, x, y) {
  const source = trimLabel(signal.source, 18);
  const title = trimLabel(signal.title, 32);
  return `<g>
    <rect x="${x}" y="${y}" width="230" height="42" rx="9" class="node-rect"></rect>
    <text x="${x + 14}" y="${y + 17}" class="node-title">${escapeHtml(source)}</text>
    <text x="${x + 14}" y="${y + 34}" class="node-meta">${escapeHtml(title)}</text>
  </g>`;
}

function renderSignalLink(signal, rows) {
  const matched = rows.find((edge) => canonicalName(edge.object).includes(signal.sourceKey) || signal.sourceKey.includes(canonicalName(edge.object)));
  const fromX = matched === undefined ? 598 : 598;
  const fromY = matched === undefined ? signal.y : matched.y;
  const path = `M ${fromX} ${fromY} C 640 ${fromY}, 664 ${signal.y}, 704 ${signal.y}`;
  return `<path d="${path}" class="signal-link" marker-end="url(#arrow)"></path>`;
}

function renderUnknownProbe(edge, index, unknownX) {
  if (index > 4) return "";
  const y = 124 + index * 72;
  const path = `M 598 ${edge.y} C 762 ${edge.y}, 882 ${y}, ${unknownX} ${y}`;
  return `<path d="${path}" fill="none" stroke="#d97d13" stroke-width="1.5" stroke-dasharray="4 7" opacity="0.55"></path>`;
}

function renderUnknownLabels(x, y) {
  return `<text x="${x}" y="${y}" class="node-title">仍未知</text>
    <text x="${x}" y="${y + 22}" class="node-meta">allocation</text>
    <text x="${x}" y="${y + 42}" class="node-meta">volume / price</text>
    <text x="${x}" y="${y + 62}" class="node-meta">facility mapping</text>
    <text x="${x}" y="${y + 82}" class="node-meta">logistics route</text>
    <text x="${x}" y="${y + 102}" class="node-meta">contract terms</text>`;
}

function renderInitialDetail(edge) {
  if (edge === undefined) {
    return `<div class="detail-label">No edge</div><div class="detail-title">没有可展示的供应链边</div>`;
  }
  return `<div class="detail-label">${escapeHtml(categoryLabel(edge.category))}</div>
    <div class="detail-title">${escapeHtml(edge.subject)} → ${escapeHtml(edge.object)}</div>
    <div class="detail-meta">${escapeHtml(edge.relation)} · ${escapeHtml(edge.component)} · Level ${escapeHtml(String(edge.level))} · confidence ${(edge.confidence * 100).toFixed(0)}%</div>
    <div class="quote">${escapeHtml(edge.cite)}<br><span class="muted">Locator: ${escapeHtml(edge.locator)} · Extractor: ${escapeHtml(edge.extractorId)}</span></div>`;
}

function metric(label, value, sublabel) {
  return `<div class="panel metric"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)} · ${escapeHtml(sublabel)}</span></div>`;
}

function renderSourceCard(source) {
  const link = source.url.length > 0 ? `<a href="${escapeAttr(source.url)}">${escapeHtml(shortUrl(source.url))}</a>` : `<span class="muted">no url</span>`;
  return `<article class="panel source-card">
    <div class="name">${escapeHtml(source.name)}</div>
    ${link}
    <div class="meta">date ${escapeHtml(source.date)} · chunks ${escapeHtml(String(source.chunks))} · ${escapeHtml(source.summary)}</div>
  </article>`;
}

function renderEdgeRow(edge) {
  return `<article class="row-card" data-edge-card="${escapeAttr(edge.id)}">
    <div class="row-top">
      <strong>${escapeHtml(edge.subject)} → ${escapeHtml(edge.object)}</strong>
      <span class="badge">L${escapeHtml(String(edge.level))} · ${(edge.confidence * 100).toFixed(0)}%</span>
    </div>
    <p class="small muted">${escapeHtml(edge.relation)} · ${escapeHtml(edge.component)} · ${escapeHtml(categoryLabel(edge.category))}</p>
    <p class="small muted" style="margin-top:6px">${escapeHtml(edge.cite)}</p>
  </article>`;
}

function renderSignal(signal) {
  return `<article class="row-card">
    <div class="row-top">
      <strong>${escapeHtml(signal.source)} · ${escapeHtml(signal.title)}</strong>
      <span class="badge">L${escapeHtml(String(signal.evidence_level))}</span>
    </div>
    <p class="small muted">${escapeHtml(signal.cite_text)}</p>
  </article>`;
}

function renderUnknown(item) {
  return `<article class="unknown-item">
    <strong>${escapeHtml(item.title)}</strong>
    <span>${escapeHtml(item.type)} · ${escapeHtml(item.body)}</span>
  </article>`;
}

function shortUrl(url) {
  if (url.length <= 48) return url;
  return `${url.slice(0, 44)}...`;
}

function trimLabel(value, maxLength) {
  const text = String(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function canonicalName(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value);
}
