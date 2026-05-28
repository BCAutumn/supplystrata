export function renderEvidenceLayerLegend() {
  const layers = [
    {
      level: "L5",
      kind: "fact",
      title: "Regulatory direct disclosure",
      body: "监管文件直接明文披露的公司关系；默认进入 fact graph。"
    },
    {
      level: "L4",
      kind: "fact",
      title: "Official disclosure / supplier list",
      body: "官方供应商名单、公司官方报告或严格官方交叉验证；默认进入 fact graph。"
    },
    {
      level: "L3",
      kind: "context",
      title: "Repeated customs / reviewed inference",
      body: "海关/BOL 反复出现或多源一致推断；默认进入 review queue，不直接画成事实边。"
    },
    {
      level: "L2",
      kind: "context",
      title: "Trend evidence",
      body: "贸易流、价格、新闻和行业报告组成的趋势证据；进入 observation / propagation context。"
    },
    {
      level: "L1",
      kind: "lead",
      title: "Single lead",
      body: "单条新闻、论坛、招聘或爆料；只进入 hypothesis / lead，不进入事实图谱。"
    }
  ];
  return layers
    .map(
      (layer) => `<div class="layer-card ${layer.kind}">
        <span class="layer-level">${escapeHtml(layer.level)}</span>
        <strong>${escapeHtml(layer.title)}</strong>
        <p>${escapeHtml(layer.body)}</p>
      </div>`
    )
    .join("");
}

export function renderComparison(pack, previous) {
  if (previous === null) return `<p class="muted">没有提供上一版 research-pack；当前 HTML 只展示本次结果。</p>`;
  const rows = [
    ["target nodes", "official_disclosure_target_nodes"],
    ["expected source links", "official_disclosure_expected_source_links"],
    ["covered source links", "official_disclosure_expected_source_links_with_coverage"],
    ["runnable suggested targets", "runnable_suggested_targets"],
    ["component dependency leads", "supply_chain_expansion_component_dependency_leads"],
    ["fact-capable leads", "supply_chain_expansion_leads_with_fact_capable_source_path"],
    ["Gate 1 overall progress", "official_disclosure_gate1_overall_progress", true]
  ];
  return `<table><thead><tr><th>Metric</th><th>Previous</th><th>Current</th><th>Delta</th></tr></thead><tbody>${rows
    .map(([label, key, percent]) => {
      const oldValue = previous.manifest.stats[key] ?? 0;
      const newValue = pack.manifest.stats[key] ?? 0;
      const delta = newValue - oldValue;
      return `<tr><td>${escapeHtml(label)}</td><td>${formatValue(oldValue, percent)}</td><td>${formatValue(newValue, percent)}</td><td class="${delta >= 0 ? "spark" : "down"}">${delta >= 0 ? "+" : ""}${formatValue(delta, percent)}</td></tr>`;
    })
    .join("")}</tbody></table>`;
}

function formatValue(value, percent) {
  if (percent === true) return pct(value);
  return escapeHtml(String(value));
}

function pct(value) {
  const number = Number(value ?? 0);
  return `${Math.round(number * 1000) / 10}%`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
