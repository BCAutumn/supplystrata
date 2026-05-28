export function buildSimulatedAiAnalysis(pack) {
  const stats = pack.manifest.stats;
  const score = pack.ledger.scorecard;
  const consumer = pack.consumer;
  const reasoning = pack.reasoning;
  const layers = reasoning?.layers ?? [];
  const sourceMonitoring = consumer?.source_monitoring;
  const openUnknowns = consumer?.unknowns?.top_open ?? [];
  const nextActions = consumer?.next_actions?.top_items ?? [];
  const cannotConclude = reasoning?.cannot_conclude ?? [];
  const blockedLayers = layers.filter((layer) => layer.status === "blocked_source" || layer.explicit_unknowns?.count > 0);
  const factLayers = layers.filter((layer) => layer.known_facts?.count > 0);
  return {
    schema_version: "1.0.0",
    generated_at: pack.manifest.generated_at,
    mode: "simulated_local_ai_v0",
    scope_id: pack.manifest.selected_company_id,
    node_id: "company_context_explanation_v0",
    status: "cannot_conclude",
    policy: {
      fact_mutation_allowed: false,
      agent_behavior_allowed: false,
      source_connector_allowed: false
    },
    headline: `AI 解读：这版已经有 ${stats.official_disclosure_l4_l5_edges} 条 L4/L5 fact edge，但 Gate 1 仍是 ${score.status}，核心缺口在 source coverage、二源 corroboration 和可扩展上游证据。`,
    executive_summary: [
      `当前报告最强的部分是事实层可追溯：${stats.official_disclosure_traceable_edges} 条 traceable edge，${stats.source_target_total_observations} 条 observation 被明确留在上下文层。`,
      `AI 不应把 ${stats.supply_chain_expansion_component_dependency_leads} 条上游 lead 说成已确认关系；它们更适合作为下一轮 source target 或人工 review 的入口。`,
      sourceMonitoring === undefined
        ? "source monitor 摘要未进入 consumer read model，AI 只能根据 readiness 和 ledger 做有限解释。"
        : `source monitor 显示 ${sourceMonitoring.expected_targets} 个 expected target、${sourceMonitoring.synced_targets} 个 synced target、${sourceMonitoring.due_targets} 个 due target；这说明报告已经知道下一步该跑哪里，而不是泛泛说“继续研究”。`
    ],
    key_insights: [
      {
        title: "事实层和研究层已经分开",
        body: `${stats.official_disclosure_l4_l5_edges} 条 L4/L5 edge 可以作为当前事实底座；${stats.supply_chain_expansion_component_dependency_leads} 条 dependency lead 只作为扩展线索。`
      },
      {
        title: "不能下结论的地方被显式列出",
        body:
          cannotConclude.length === 0
            ? "当前 reasoning walkthrough 没有列出全局 cannot_conclude；仍需保守引用 refs。"
            : cannotConclude
                .slice(0, 3)
                .map((item) => item.reason)
                .join(" ")
      },
      {
        title: "下一步行动更像工作队列，不像摘要结尾",
        body:
          nextActions.length === 0
            ? `${pack.ledger.action_queue?.length ?? 0} 个 ledger action 可作为人工队列。`
            : nextActions
                .slice(0, 3)
                .map((item) => item.title)
                .join("；")
      }
    ],
    evidence_boundaries: [
      `${factLayers.length} 个 reasoning layer 有已审查事实输入；${blockedLayers.length} 个 layer 仍被 unknown 或 source 状态阻塞。`,
      "Observation、lead、policy constraint 只能支持解释和排队，不能提升 evidence_level。",
      "AI 输出只能引用现有 evidence/claim/observation/unknown/source target ref，不能创造新 ref。"
    ],
    cannot_conclude: cannotConclude.slice(0, 8).map((item) => `${item.layer_id}: ${item.reason}`),
    next_human_actions: nextActions.slice(0, 5).map((item) => ({
      title: item.title,
      action: item.recommended_action,
      refs: item.refs ?? []
    })),
    open_unknowns: openUnknowns.slice(0, 5).map((item) => `${item.unknown_id}: ${item.question}`),
    quality_lift: {
      before: "上一版 HTML 主要展示指标、表格和队列，需要读者自己拼出叙事。",
      after: "加入 AI 解读后，报告先给出事实边界、不能结论和下一步动作，再进入细表；可读性更强，同时不突破证据边界。"
    }
  };
}

export function renderAiAnalystSection(ai, pack, previous) {
  if (ai === null) return "";
  return `<section class="panel ai-panel section">
      <div>
        <h2>AI Analyst</h2>
        <p>${escapeHtml(ai.headline ?? "AI analysis is available for this pack.")}</p>
        <div class="pill-row" style="margin-top:12px">
          <span class="ai-tag">${escapeHtml(ai.mode ?? "ai_analysis")}</span>
          <span class="ai-tag">${escapeHtml(ai.status ?? "read_only")}</span>
          <span class="ai-tag">${escapeHtml(ai.provider ?? "provider_unknown")}</span>
          <span class="ai-tag">${escapeHtml(ai.model ?? "model_unknown")}</span>
          <span class="ai-tag">simulated: ${escapeHtml(String(ai.model_metadata?.simulated ?? true))}</span>
          <span class="ai-tag">fact write: ${escapeHtml(String(ai.policy?.fact_mutation_allowed ?? false))}</span>
          <span class="ai-tag">agent: ${escapeHtml(String(ai.policy?.agent_behavior_allowed ?? false))}</span>
        </div>
        <div class="ai-card">
          <strong>报告质量提升</strong>
          <p class="muted">${escapeHtml(ai.quality_lift?.after ?? "AI summary turns structured metrics into a readable audit narrative.")}</p>
          ${
            previous === null
              ? `<p class="muted" style="margin-top:8px">${escapeHtml(ai.quality_lift?.before ?? "No previous pack was provided for comparison.")}</p>`
              : `<p class="muted" style="margin-top:8px">${escapeHtml(aiQualityDelta(pack, previous))}</p>`
          }
        </div>
      </div>
      <div class="ai-list">
        <div class="ai-card">
          <strong>综合判断</strong>
          <ul>${(ai.executive_summary ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </div>
        <div class="ai-card">
          <strong>关键洞察</strong>
          <ul>${(ai.key_insights ?? []).map((item) => `<li><strong>${escapeHtml(item.title)}</strong><br><span class="muted">${escapeHtml(item.body)}</span></li>`).join("")}</ul>
        </div>
        <div class="ai-card">
          <strong>Cannot conclude</strong>
          <ul>${
            (ai.cannot_conclude ?? [])
              .slice(0, 5)
              .map((item) => `<li>${escapeHtml(item)}</li>`)
              .join("") || "<li>无显式 cannot_conclude，但仍需绑定 refs。</li>"
          }</ul>
        </div>
        <div class="ai-card">
          <strong>下一步人工动作</strong>
          <ul>${
            (ai.next_human_actions ?? [])
              .slice(0, 5)
              .map((item) => `<li>${escapeHtml(item.title)}<br><span class="muted">${escapeHtml(item.action)}</span></li>`)
              .join("") || "<li>暂无 consumer next action。</li>"
          }</ul>
        </div>
      </div>
    </section>`;
}

export function renderAiComparison(ai, previous) {
  if (ai === null) return "";
  const previousAi = previous?.ai ?? null;
  if (previous === null) {
    return `<p class="muted" style="margin-top:12px">AI Analyst 是本版新增的本地模拟解读层；没有上一版 pack 时无法做逐项 delta。</p>`;
  }
  if (previousAi === null) {
    return `<p class="muted" style="margin-top:12px">上一版没有 AI analysis artifact；本版新增了 executive summary、evidence boundaries、cannot_conclude 和 next_human_actions。质量提升主要体现在读者不用从多个表格里手工拼接叙事。</p>`;
  }
  return `<p class="muted" style="margin-top:12px">AI analysis artifact 已可跨版本比较：上一版 ${escapeHtml(previousAi.status ?? "unknown")}，本版 ${escapeHtml(ai.status ?? "unknown")}。</p>`;
}

function aiQualityDelta(pack, previous) {
  const currentStats = pack.manifest.stats;
  const previousStats = previous.manifest.stats;
  const targetDelta = (currentStats.official_disclosure_target_nodes ?? 0) - (previousStats.official_disclosure_target_nodes ?? 0);
  const observationDelta = (currentStats.source_target_total_observations ?? 0) - (previousStats.source_target_total_observations ?? 0);
  const leadDelta =
    (currentStats.supply_chain_expansion_component_dependency_leads ?? 0) - (previousStats.supply_chain_expansion_component_dependency_leads ?? 0);
  return `和上一版相比，本版多覆盖 ${targetDelta} 个目标节点、${observationDelta} 条 observation、${leadDelta} 条上游 lead；AI 解读把这些变化翻译成“事实边界 + 不能结论 + 下一步动作”。`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
