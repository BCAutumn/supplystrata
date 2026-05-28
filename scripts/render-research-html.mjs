#!/usr/bin/env node
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSimulatedAiAnalysis, renderAiAnalystSection, renderAiComparison } from "./research-html-ai.mjs";
import { renderComparison, renderEvidenceLayerLegend } from "./research-html-sections.mjs";

const [packDir, outputPath, previousPackDir] = process.argv.slice(2);
if (packDir === undefined || outputPath === undefined) {
  console.error("Usage: node scripts/render-research-html.mjs <research-pack-dir> <output.html> [previous-pack-dir]");
  process.exit(1);
}

const pack = await loadPack(packDir);
const previous = previousPackDir === undefined ? null : await loadPack(previousPackDir);
await writeFile(outputPath, renderHtml(pack, previous), "utf8");

async function loadPack(dir) {
  const entry = await stat(dir);
  if (!entry.isDirectory()) {
    throw new Error(`Expected a research-pack directory, got: ${dir}`);
  }
  return {
    dir,
    manifest: await readJson(dir, "manifest.json"),
    readiness: await readJson(dir, "official-disclosure-readiness.json"),
    expansion: await readJson(dir, "supply-chain-expansion-plan.json"),
    workbench: await readJson(dir, "gate1-data-depth-workbench.json"),
    ledger: await readJson(dir, "gate1-run-ledger.json"),
    coverage: await readJson(dir, "source-target-coverage.json"),
    propagation: await readJson(dir, "propagation-readiness.json"),
    questions: await readJson(dir, "question-readiness.json"),
    quality: (await readJsonOptional(dir, "quality.json")) ?? emptyQuality(),
    consumer: await readJsonOptional(dir, "consumer-read-model.json"),
    reasoning: await readJsonOptional(dir, "reasoning-walkthrough.json"),
    ai: await readJsonOptional(dir, "ai-analysis.json")
  };
}

function emptyQuality() {
  return { schema_version: "1.0.0", counts: { error: 0, warn: 0, info: 0 }, issues: [] };
}

async function readJson(dir, file) {
  return JSON.parse(await readFile(join(dir, file), "utf8"));
}

async function readJsonOptional(dir, file) {
  try {
    return await readJson(dir, file);
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function renderHtml(pack, previous) {
  const stats = pack.manifest.stats;
  const score = pack.ledger.scorecard;
  const source = pack.ledger.source_path_progress;
  const data = pack.ledger.data_progress;
  const profile = pack.manifest.research_target_profile;
  const actions = pack.ledger.action_queue ?? [];
  const leads = pack.expansion.component_dependency_leads ?? [];
  const edges = pack.readiness.edges ?? [];
  const qualityIssues = pack.quality.issues ?? [];
  const ai = pack.ai ?? buildSimulatedAiAnalysis(pack);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SupplyStrata Gate 1 NVIDIA Research Report</title>
  <style>
    :root {
      color-scheme: light;
      --page: #f4f7fb;
      --panel: #ffffff;
      --ink: #162033;
      --muted: #65748b;
      --line: #d8e0eb;
      --blue: #2358c8;
      --green: #0d766e;
      --gold: #9f620f;
      --red: #b42318;
      --soft-blue: #edf4ff;
      --soft-green: #ebf7f4;
      --soft-gold: #fff6e6;
      --soft-red: #fff0ed;
      --shadow: 0 10px 28px rgba(24, 36, 58, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background: var(--page);
    }
    header {
      background: #fff;
      border-bottom: 1px solid var(--line);
      padding: 26px 32px 18px;
    }
    main {
      width: min(1500px, calc(100vw - 48px));
      margin: 0 auto;
      padding: 22px 0 42px;
    }
    h1 { margin: 0 0 8px; font-size: 30px; line-height: 1.15; letter-spacing: 0; }
    h2 { margin: 0 0 14px; font-size: 19px; letter-spacing: 0; }
    h3 { margin: 0 0 8px; font-size: 15px; letter-spacing: 0; }
    p { margin: 0; line-height: 1.55; }
    a { color: var(--blue); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .muted { color: var(--muted); }
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1.35fr) minmax(360px, 0.65fr);
      gap: 16px;
      align-items: stretch;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      padding: 16px;
    }
    .grid { display: grid; gap: 16px; }
    .metrics { grid-template-columns: repeat(6, minmax(0, 1fr)); margin: 16px 0; }
    .metric strong { display: block; font-size: 25px; line-height: 1.1; }
    .metric span { display: block; margin-top: 5px; color: var(--muted); font-size: 12px; line-height: 1.35; }
    .status {
      display: inline-flex;
      align-items: center;
      min-height: 26px;
      border-radius: 6px;
      padding: 0 8px;
      font-size: 12px;
      font-weight: 700;
      border: 1px solid var(--line);
      background: #fff;
    }
    .status.pass, .status.ready { color: var(--green); background: var(--soft-green); border-color: #b7e3d8; }
    .status.partial, .status.retry_wait, .status.smoke_first { color: var(--gold); background: var(--soft-gold); border-color: #f3d79b; }
    .status.fail, .status.blocked { color: var(--red); background: var(--soft-red); border-color: #f5c2ba; }
    .bar {
      height: 8px;
      background: #e8eef6;
      border-radius: 999px;
      overflow: hidden;
      margin-top: 8px;
    }
    .bar > span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--blue), var(--green)); }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 10px 8px; border-bottom: 1px solid #e7edf5; text-align: left; vertical-align: top; }
    th { color: #42526a; font-size: 12px; font-weight: 800; background: #f8fafc; }
    .two { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    .three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .section { margin-top: 16px; }
    .callout { background: var(--soft-blue); border-color: #c8dcff; }
    .callout strong { display: block; margin-bottom: 6px; }
    .ai-panel {
      display: grid;
      grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
      gap: 16px;
      align-items: stretch;
      background: #111827;
      color: #f8fafc;
      border-color: #1f2937;
    }
    .ai-panel h2, .ai-panel h3 { color: #f8fafc; }
    .ai-panel .muted { color: #cbd5e1; }
    .ai-card {
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 12px;
      background: #182235;
    }
    .ai-card + .ai-card { margin-top: 10px; }
    .ai-card strong { display: block; margin-bottom: 5px; }
    .ai-list { display: grid; gap: 10px; }
    .ai-list li { margin-bottom: 7px; line-height: 1.45; }
    .ai-tag {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 0 8px;
      border-radius: 999px;
      background: #243149;
      border: 1px solid #3d4c65;
      color: #dbeafe;
      font-size: 12px;
      margin: 0 6px 6px 0;
    }
    .list { display: grid; gap: 10px; }
    .item {
      border: 1px solid #e4ebf4;
      border-radius: 8px;
      padding: 11px;
      background: #fff;
    }
    .item-head { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
    .code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; color: #334155; }
    .command-list { display: grid; gap: 6px; margin-top: 10px; }
    .command-list p { padding: 8px; border-radius: 6px; background: #f8fafc; border: 1px solid #e2e8f0; overflow-wrap: anywhere; }
    .ranking-list { display: grid; gap: 6px; margin-top: 10px; }
    .ranking-row { padding: 8px; border-radius: 6px; background: #fbfdff; border: 1px solid #e2e8f0; }
    .ranking-row strong { display: block; font-size: 12px; }
    .ranking-row span { display: block; margin-top: 3px; font-size: 12px; color: var(--muted); }
    .pill-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      border-radius: 999px;
      padding: 0 8px;
      background: #f3f6fa;
      border: 1px solid #e2e8f0;
      color: #475569;
      font-size: 12px;
    }
    .trace-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .trace-box { border: 1px solid #e1e8f2; border-radius: 8px; padding: 11px; background: #fbfdff; }
    .trace-box strong { display: block; font-size: 18px; }
    .layer-grid {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 10px;
    }
    .layer-card {
      border: 1px solid #e3eaf4;
      border-radius: 8px;
      padding: 11px;
      background: #fbfdff;
      min-height: 132px;
    }
    .layer-card.fact {
      background: var(--soft-green);
      border-color: #b7e3d8;
    }
    .layer-card.context {
      background: var(--soft-gold);
      border-color: #f3d79b;
    }
    .layer-card.lead {
      background: #f8fafc;
    }
    .layer-level {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 0 8px;
      border-radius: 6px;
      border: 1px solid #cbd5e1;
      background: #fff;
      font-weight: 800;
      font-size: 12px;
      margin-bottom: 8px;
    }
    .layer-card strong { display: block; font-size: 13px; margin-bottom: 6px; }
    .layer-card p { color: var(--muted); font-size: 12px; line-height: 1.45; }
    .spark { color: var(--green); }
    .down { color: var(--red); }
    .svg-wrap { overflow: auto; border: 1px solid var(--line); border-radius: 8px; background: #fcfdff; }
    svg { min-width: 960px; display: block; width: 100%; height: auto; }
    .node { fill: #fff; stroke: #cbd6e4; stroke-width: 1; filter: drop-shadow(0 4px 9px rgba(24,36,58,0.08)); }
    .node-title { font-size: 12px; font-weight: 800; fill: var(--ink); }
    .node-meta { font-size: 10px; fill: var(--muted); }
    .edge { stroke: #94a3b8; stroke-width: 1.5; marker-end: url(#arrow); }
    .edge.fact { stroke: var(--green); stroke-width: 2.2; }
    .edge.lead { stroke-dasharray: 6 5; }
    @media (max-width: 1100px) {
      .hero, .two, .three, .ai-panel { grid-template-columns: 1fr; }
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .layer-grid { grid-template-columns: 1fr; }
      .trace-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      main { width: min(100vw - 24px, 1500px); }
      header { padding: 22px 18px 16px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>SupplyStrata Gate 1 NVIDIA 供应链情报报告</h1>
    <p class="muted">生成时间 ${escapeHtml(pack.manifest.generated_at)} · depth ${pack.manifest.depth} · ${escapeHtml(profile?.title ?? "no profile")} · 静态 HTML 来自 <span class="code">${escapeHtml(pack.dir)}</span></p>
  </header>
  <main>
    <section class="hero">
      <div class="panel">
        <h2>结论</h2>
        <p>${summarySentence(pack)}</p>
        <div class="pill-row">
          <span class="status ${escapeAttr(score.status)}">Gate 1 ${escapeHtml(score.status)}</span>
          <span class="pill">整体 ${pct(score.overall_progress)}</span>
          <span class="pill">数据 ${pct(score.data_progress)}</span>
          <span class="pill">source path ${pct(score.source_path_progress)}</span>
        </div>
      </div>
      <div class="panel callout">
        <strong>边界声明</strong>
        <p>这份报告没有让模型编事实边。Observation、lead、source-path 只作为研究输入；L4/L5 fact edge 仍必须来自可追溯 evidence 和 review/disposition。</p>
      </div>
    </section>

    ${renderAiAnalystSection(ai, pack, previous)}

    <section class="panel section">
      <h2>Evidence Layer Legend</h2>
      <p class="muted">L 是 evidence_level，只说明证据来源强度，不说明关系重要性或风险大小。默认 fact graph 只展示 L4/L5；L1-L3 会进入 lead / observation / review backlog，避免弱信号污染事实层。</p>
      <div class="layer-grid" style="margin-top:12px">
        ${renderEvidenceLayerLegend()}
      </div>
    </section>

    <section class="grid metrics">
      ${metric(profile?.target_nodes ?? stats.official_disclosure_target_nodes, "目标节点", diff(previous, "official_disclosure_target_nodes", stats.official_disclosure_target_nodes))}
      ${metric(stats.official_disclosure_l4_l5_edges, "L4/L5 fact edges", `目标 ${score.l4_l5_fact_edge_target}`)}
      ${metric(stats.official_disclosure_expected_source_links_with_coverage, "已覆盖 source links", `共 ${stats.official_disclosure_expected_source_links}`)}
      ${metric(stats.source_target_total_observations, "结构化 observations", `${stats.source_target_targets_with_observations} 个 targets 有观察值`)}
      ${metric(stats.supply_chain_expansion_component_dependency_leads, "递归上游 leads", `${stats.supply_chain_expansion_leads_with_fact_capable_source_path} 条 fact-capable path`)}
      ${metric(stats.gate1_data_depth_adjacent_official_fact_edges ?? 0, "相邻官方事实", `${stats.gate1_data_depth_adjacent_official_fact_companies ?? 0} 个相关公司`)}
      ${metric(stats.gate1_data_depth_p0, "P0 下一步", `${stats.gate1_data_depth_items} 个 workbench items`)}
    </section>

    <section class="grid two section">
      <div class="panel">
        <h2>Gate 1 Scorecard</h2>
        <table>
          <thead><tr><th>Criterion</th><th>Status</th><th>Progress</th><th>Measured / Target</th></tr></thead>
          <tbody>${(pack.readiness.scorecard.criteria ?? []).map(renderCriterion).join("")}</tbody>
        </table>
      </div>
      <div class="panel">
        <h2>Source Monitoring</h2>
        <div class="trace-grid">
          ${traceBox(source.expected_source_links, "expected links")}
          ${traceBox(source.synced_targets, "synced targets")}
          ${traceBox(source.retry_wait_targets, "retry wait")}
          ${traceBox(source.targets_with_observations, "with observations")}
        </div>
        <div class="list" style="margin-top:12px">${(pack.ledger.monitoring_config.batches ?? []).map(renderMonitoringBatch).join("")}</div>
      </div>
    </section>

    <section class="panel section">
      <h2>递归供应链 Frontier</h2>
      <p class="muted">实线是已经进入 L4/L5 图谱的事实边，虚线是“可研究但不能自动写 fact edge”的上游 lead。</p>
      <div class="svg-wrap" style="margin-top:12px">${renderFrontierSvg(edges, leads)}</div>
    </section>

    <section class="grid two section">
      <div class="panel">
        <h2>L4/L5 Fact Edges</h2>
        <table>
          <thead><tr><th>Subject</th><th>Relation</th><th>Object</th><th>Evidence</th><th>State</th></tr></thead>
          <tbody>${edges.slice(0, 14).map(renderEdge).join("")}</tbody>
        </table>
      </div>
      <div class="panel">
        <h2>上游 Leads</h2>
        <table>
          <thead><tr><th>From</th><th>To</th><th>Authority</th><th>Policy</th></tr></thead>
          <tbody>${leads.slice(0, 16).map(renderLead).join("")}</tbody>
        </table>
      </div>
    </section>

    <section class="grid two section">
      <div class="panel">
        <h2>Data-depth Workbench</h2>
        <div class="trace-grid">
          ${traceBox(pack.workbench.summary.fact_edge_gap_to_target, "fact edge gap")}
          ${traceBox(pack.workbench.summary.adjacent_official_fact_edges ?? 0, "adjacent facts")}
          ${traceBox(pack.workbench.summary.source_blockers, "source blockers")}
          ${traceBox(pack.workbench.summary.entity_context_items ?? 0, "entity context")}
          ${traceBox(pack.workbench.summary.strength_missing_edges, "missing strength")}
          ${traceBox(pack.workbench.summary.observation_labeling_batch, "labeling batch")}
        </div>
        <div class="list" style="margin-top:12px">${(pack.workbench.items ?? []).slice(0, 6).map(renderWorkbenchItem).join("")}</div>
        ${renderRankingCalibrationQueue(pack.workbench)}
      </div>
      <div class="panel">
        <h2>质量与可解释性</h2>
        <div class="trace-grid">
          ${traceBox(pack.quality.counts?.error ?? 0, "quality errors")}
          ${traceBox(pack.quality.counts?.warn ?? 0, "quality warnings")}
          ${traceBox(data.corroboration_queue_recorded_disposition, "recorded dispositions")}
          ${traceBox(stats.unknown_items, "explicit unknowns")}
        </div>
        <div class="list" style="margin-top:12px">${qualityIssues.slice(0, 5).map(renderQualityIssue).join("")}</div>
      </div>
    </section>

    <section class="grid two section">
      <div class="panel">
        <h2>现在能回答什么</h2>
        <table>
          <thead><tr><th>Question</th><th>Status</th><th>Confidence</th><th>Missing</th></tr></thead>
          <tbody>${(pack.questions.items ?? []).map(renderQuestion).join("")}</tbody>
        </table>
      </div>
      <div class="panel">
        <h2>Propagation Readiness</h2>
        <table>
          <thead><tr><th>Context</th><th>Status</th><th>Confidence</th><th>Policy</th></tr></thead>
          <tbody>${(pack.propagation.items ?? []).map(renderPropagation).join("")}</tbody>
        </table>
      </div>
    </section>

    <section class="panel section">
      <h2>下一步行动队列</h2>
      <div class="list">${actions.slice(0, 8).map(renderAction).join("")}</div>
    </section>

    <section class="panel section">
      <h2>和上一版相比</h2>
      ${renderComparison(pack, previous)}
      ${renderAiComparison(ai, previous)}
    </section>
  </main>
</body>
</html>`;
}

function summarySentence(pack) {
  const stats = pack.manifest.stats;
  return [
    `这版已经把 NVIDIA 示例从“供应商列表预览”推进到 Gate 1 研究执行面板：${stats.official_disclosure_target_nodes} 个目标节点、${stats.official_disclosure_l4_l5_edges} 条 L4/L5 fact edge、${stats.source_target_total_observations} 条结构化 observation。`,
    `但距离 Gate 1 完成还差 ${stats.gate1_data_depth_fact_edge_gap} 条 L4/L5 边，cross-source corroboration 仍为 ${pct(stats.official_disclosure_corroboration_ratio)}；${stats.gate1_data_depth_adjacent_official_fact_edges ?? 0} 条相邻官方事实会作为递归研究入口展示，不会被伪装成 NVIDIA 已确认链路。`
  ].join(" ");
}

function renderCriterion(item) {
  return `<tr>
    <td><strong>${escapeHtml(item.label)}</strong><br><span class="muted">${escapeHtml(item.rationale ?? "")}</span></td>
    <td><span class="status ${escapeAttr(item.status)}">${escapeHtml(item.status)}</span></td>
    <td>${pct(item.progress)}<div class="bar"><span style="width:${Math.min(100, Math.round((item.progress ?? 0) * 100))}%"></span></div></td>
    <td>${escapeHtml(String(item.measured ?? "-"))} / ${escapeHtml(String(item.target ?? "-"))}</td>
  </tr>`;
}

function renderMonitoringBatch(batch) {
  return `<div class="item">
    <div class="item-head"><strong>${escapeHtml(batch.batch_id)}</strong><span class="status ${escapeAttr(batch.current_state)}">${escapeHtml(batch.current_state)}</span></div>
    <p class="muted">${escapeHtml(batch.attention_hint ?? "No immediate attention item.")}</p>
    <div class="pill-row">
      <span class="pill">${escapeHtml(batch.recommended_operational_action)}</span>
      <span class="pill">${escapeHtml(batch.target_count)} targets</span>
      <span class="pill">observations ${escapeHtml(String(batch.state_counts?.targets_with_observations ?? 0))}</span>
    </div>
  </div>`;
}

function renderFrontierSvg(edges, leads) {
  const factRows = edges
    .slice(0, 8)
    .map((edge, index) => ({ type: "fact", index, left: edge.from_name, right: edge.to_name, meta: edge.component_id ?? edge.relation }));
  const leadRows = leads.slice(0, 10).map((lead, index) => ({
    type: "lead",
    index: index + factRows.length,
    left: lead.parent_component_id,
    right: lead.target_name,
    meta: lead.source_path_authority
  }));
  const rows = [...factRows, ...leadRows];
  const height = Math.max(220, rows.length * 54 + 60);
  return `<svg viewBox="0 0 1040 ${height}" role="img" aria-label="Gate 1 frontier graph">
    <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#64748b" /></marker></defs>
    <text x="32" y="28" class="node-title">Current fact frontier</text>
    <text x="610" y="28" class="node-title">Next upstream research leads</text>
    ${rows.map(renderSvgRow).join("")}
  </svg>`;
}

function renderSvgRow(row) {
  const y = 54 + row.index * 54;
  const lineClass = row.type === "fact" ? "fact" : "lead";
  const x1 = row.type === "fact" ? 70 : 640;
  const x2 = row.type === "fact" ? 430 : 940;
  const mid = row.type === "fact" ? 250 : 790;
  return `<g>
    <rect class="node" x="${x1 - 38}" y="${y - 21}" width="210" height="42" rx="7" />
    <text class="node-title" x="${x1 - 26}" y="${y - 4}">${escapeSvg(short(row.left, 24))}</text>
    <text class="node-meta" x="${x1 - 26}" y="${y + 12}">${escapeSvg(row.type === "fact" ? "fact edge" : "component lead")}</text>
    <line class="edge ${lineClass}" x1="${mid}" y1="${y}" x2="${x2 - 48}" y2="${y}" />
    <rect class="node" x="${x2 - 38}" y="${y - 21}" width="210" height="42" rx="7" />
    <text class="node-title" x="${x2 - 26}" y="${y - 4}">${escapeSvg(short(row.right, 24))}</text>
    <text class="node-meta" x="${x2 - 26}" y="${y + 12}">${escapeSvg(short(row.meta, 28))}</text>
  </g>`;
}

function renderEdge(edge) {
  return `<tr>
    <td>${escapeHtml(edge.from_name)}</td>
    <td>${escapeHtml(edge.relation)}<br><span class="muted">${escapeHtml(edge.component_id ?? "component unknown")}</span></td>
    <td>${escapeHtml(edge.to_name)}</td>
    <td>L${escapeHtml(String(edge.evidence_level))} · ${escapeHtml((edge.source_adapters ?? []).join(", "))}</td>
    <td>${escapeHtml(edge.traceability_state)} / ${escapeHtml(edge.corroboration_state)}<br><span class="muted">fresh ${edge.has_freshness ? "yes" : "no"} · strength ${edge.has_strength ? "yes" : "unknown"}</span></td>
  </tr>`;
}

function renderLead(lead) {
  return `<tr>
    <td>${escapeHtml(lead.parent_component_id)}</td>
    <td>${escapeHtml(lead.target_name)}<br><span class="muted">${escapeHtml(lead.category)}</span></td>
    <td>${escapeHtml(lead.source_path_authority)}<br><span class="muted">${escapeHtml(lead.state)}</span></td>
    <td>${escapeHtml(lead.expansion_policy)}<br><span class="muted">${escapeHtml((lead.source_ids ?? []).slice(0, 4).join(", "))}</span></td>
  </tr>`;
}

function renderWorkbenchItem(item) {
  return `<div class="item">
    <div class="item-head"><strong>${escapeHtml(item.title)}</strong><span class="status ${escapeAttr(item.priority.toLowerCase())}">${escapeHtml(item.priority)}</span></div>
    <p class="muted">${escapeHtml(item.rationale)}</p>
    ${renderCommandHints(item.command_hints ?? [])}
    ${renderRankingContexts(item.ranking_contexts ?? [])}
    <div class="pill-row"><span class="pill">${escapeHtml(item.workstream)}</span><span class="pill">${escapeHtml(item.frontend_action_kind)}</span><span class="pill">${escapeHtml(item.review_policy)}</span></div>
  </div>`;
}

function renderCommandHints(commandHints) {
  const hints = commandHints.slice(0, 2);
  if (hints.length === 0) return "";
  return `<div class="command-list">${hints
    .map(
      (hint) =>
        `<p><strong>${escapeHtml(hint.label)}</strong><br><span class="code">${escapeHtml(hint.command)}</span><br><span class="muted">writes truth store: ${escapeHtml(
          String(hint.writes_truth_store)
        )} · requires database: ${escapeHtml(String(hint.requires_database))}</span></p>`
    )
    .join("")}</div>`;
}

function renderRankingContexts(contexts) {
  const candidates = contexts.flatMap((context) =>
    (context.candidates ?? []).slice(0, 3).map((candidate) => ({
      ...candidate,
      context_id: context.context_id,
      model_version: context.model_version,
      policy: context.policy
    }))
  );
  if (candidates.length === 0) return "";
  return `<div class="ranking-list">${candidates
    .map(
      (candidate) => `<div class="ranking-row">
        <strong>#${escapeHtml(candidate.rank)} ${escapeHtml(candidate.entity_name)} · suggested ${escapeHtml(candidate.suggested_label)}</strong>
        <span>${escapeHtml(candidate.suggested_label_reason)}</span>
        <span>review=${escapeHtml(candidate.review_status)} · latest=${escapeHtml(candidate.latest_label?.label ?? "none")} · policy=${escapeHtml(
          candidate.suggested_label_policy
        )}</span>
        <span class="code">${escapeHtml(candidate.candidate_id)}</span>
      </div>`
    )
    .join("")}</div>`;
}

function renderRankingCalibrationQueue(workbench) {
  const candidates = (workbench.items ?? []).flatMap((item) =>
    (item.ranking_contexts ?? []).flatMap((context) =>
      (context.candidates ?? []).map((candidate) => ({
        ...candidate,
        context_id: context.context_id,
        item_title: item.title
      }))
    )
  );
  if (candidates.length === 0) return "";
  return `<h3 style="margin-top:16px">Ranking calibration queue</h3>
    <p class="muted">这些是规则建议，不是 gold label；只有写入 ranking_calibration_labels 后才会成为 latest label。</p>
    <div class="ranking-list">${candidates
      .slice(0, 12)
      .map(
        (candidate) => `<div class="ranking-row">
          <strong>${escapeHtml(candidate.item_title)} · #${escapeHtml(candidate.rank)} ${escapeHtml(candidate.entity_name)} · suggested ${escapeHtml(
            candidate.suggested_label
          )}</strong>
          <span>${escapeHtml(candidate.suggested_label_reason)}</span>
          <span>review=${escapeHtml(candidate.review_status)} · latest=${escapeHtml(candidate.latest_label?.label ?? "none")} · policy=${escapeHtml(
            candidate.suggested_label_policy
          )}</span>
          <span class="code">${escapeHtml(candidate.candidate_id)}</span>
        </div>`
      )
      .join("")}</div>`;
}

function renderQualityIssue(issue) {
  return `<div class="item">
    <div class="item-head"><strong>${escapeHtml(issue.rule_id)}</strong><span class="status ${issue.severity === "error" ? "fail" : "partial"}">${escapeHtml(issue.severity)}</span></div>
    <p class="muted">${escapeHtml(issue.message)}</p>
    <span class="code">${escapeHtml(issue.scope_id ?? "")}</span>
  </div>`;
}

function renderQuestion(item) {
  return `<tr>
    <td>${escapeHtml(item.question)}</td>
    <td><span class="status ${escapeAttr(item.status)}">${escapeHtml(item.status)}</span></td>
    <td>${pct(item.confidence)}</td>
    <td>${escapeHtml((item.missing_requirements ?? []).slice(0, 2).join("; ") || "none")}</td>
  </tr>`;
}

function renderPropagation(item) {
  return `<tr>
    <td>${escapeHtml(item.title)}<br><span class="muted">${escapeHtml(item.question)}</span></td>
    <td><span class="status ${escapeAttr(item.status)}">${escapeHtml(item.status)}</span></td>
    <td>${pct(item.confidence)}</td>
    <td>${escapeHtml(item.policy)}</td>
  </tr>`;
}

function renderAction(action) {
  return `<div class="item">
    <div class="item-head"><strong>${escapeHtml(action.title)}</strong><span class="status ${escapeAttr(action.priority.toLowerCase())}">${escapeHtml(action.priority)}</span></div>
    <p class="muted">${escapeHtml(action.rationale)}</p>
    ${action.command_hint === null ? "" : `<p class="code" style="margin-top:8px">${escapeHtml(action.command_hint)}</p>`}
  </div>`;
}

function metric(value, label, sub) {
  return `<div class="panel metric"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}${sub === "" ? "" : `<br>${escapeHtml(sub)}`}</span></div>`;
}

function traceBox(value, label) {
  return `<div class="trace-box"><strong>${escapeHtml(String(value))}</strong><span class="muted">${escapeHtml(label)}</span></div>`;
}

function diff(previous, key, current) {
  if (previous === null) return "";
  const oldValue = previous.manifest.stats[key] ?? 0;
  const delta = current - oldValue;
  return `${delta >= 0 ? "+" : ""}${delta} vs previous`;
}

function pct(value) {
  const number = Number(value ?? 0);
  return `${Math.round(number * 1000) / 10}%`;
}

function short(value, max) {
  const text = String(value ?? "");
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(
    String(value ?? "")
      .replace(/[^a-z0-9_-]+/giu, "-")
      .toLowerCase()
  );
}

function escapeSvg(value) {
  return escapeHtml(value);
}
