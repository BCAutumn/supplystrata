import type { AiComputePropagationLayer } from "./ai-compute-propagation-readiness-definitions.js";
import type { ReasoningCannotConcludeItem, ReasoningWalkthrough, ReasoningWalkthroughLayer } from "./reasoning-walkthrough-definitions.js";
import type { ResearchPackManifest } from "./definitions.js";
import type { PropagationReadinessReport } from "./propagation-readiness.js";

export interface ReasoningWalkthroughInput {
  manifest: ResearchPackManifest;
  propagation_readiness: PropagationReadinessReport;
}

export function buildReasoningWalkthrough(pack: ReasoningWalkthroughInput): ReasoningWalkthrough {
  const matrix = pack.propagation_readiness.ai_compute_matrix;
  const layers = matrix.layers.map(toWalkthroughLayer);
  const cannotConclude = layers.flatMap((layer) => layer.cannot_conclude.map((reason) => ({ layer_id: layer.layer_id, reason })));
  return {
    schema_version: "1.0.0",
    walkthrough_id: "gate8_lite_reasoning_walkthrough.v0",
    generated_at: pack.manifest.generated_at,
    company_id: pack.manifest.selected_company_id,
    matrix_id: matrix.matrix_id,
    policy: matrix.policy,
    summary: {
      layers: layers.length,
      known_fact_layers: layers.filter((layer) => layer.known_facts.count > 0).length,
      layers_with_unknowns: layers.filter((layer) => layer.explicit_unknowns.count > 0).length,
      layers_with_blocked_sources: layers.filter((layer) => layer.status === "blocked_source").length,
      next_actions: layers.reduce((count, layer) => count + layer.next_actions.length, 0),
      prohibited_truth_store_writes: uniqueSorted(matrix.layers.flatMap((layer) => layer.prohibited_truth_store_writes))
    },
    layers,
    cannot_conclude: cannotConclude
  };
}

function toWalkthroughLayer(layer: AiComputePropagationLayer): ReasoningWalkthroughLayer {
  return {
    layer_id: layer.layer_id,
    title: layer.title,
    status: layer.status,
    question: layer.question,
    known_facts: {
      count: layer.fact_edge_refs.length,
      refs: [...layer.fact_edge_refs],
      interpretation:
        layer.fact_edge_refs.length === 0
          ? "No reviewed L4/L5 fact edge is visible for this propagation layer."
          : "These refs are reviewed fact-edge inputs visible to the current research pack."
    },
    explicit_unknowns: {
      count: layer.unknown_refs.length + layer.unknown_backlog_seeds.length,
      refs: [...layer.unknown_refs, ...layer.unknown_backlog_seeds.map((seed) => seed.seed_id)],
      interpretation: "Unknown refs and seeds mark public-data gaps; they are not negative evidence."
    },
    constrained_evidence: {
      observation_refs: [...layer.observation_refs, ...layer.observation_series_refs],
      lead_refs: [...layer.component_dependency_refs, ...layer.frontier_refs],
      source_target_refs: [...layer.source_target_refs],
      official_evidence_gaps: layer.official_evidence_gaps.map((gap) => ({
        gap_kind: gap.gap_kind,
        target_kind: gap.target_kind,
        target_id: gap.target_id,
        label: gap.label,
        recommended_action: gap.recommended_action
      }))
    },
    next_actions: layer.execution_queue.items.map((item) => ({
      queue_item_id: item.queue_item_id,
      priority: item.priority,
      action: item.action,
      title: item.title,
      reason: item.reason,
      source_target_refs: [...item.source_target_refs],
      unknown_refs: [...item.unknown_refs]
    })),
    cannot_conclude: cannotConcludeForLayer(layer)
  };
}

function cannotConcludeForLayer(layer: AiComputePropagationLayer): string[] {
  const reasons: string[] = [];
  if (layer.fact_edge_refs.length === 0) {
    reasons.push("Cannot claim a company-level supply-chain relationship for this layer without a reviewed L4/L5 fact edge.");
  }
  if (layer.observation_refs.length > 0 || layer.observation_series_refs.length > 0) {
    reasons.push("Observation signals can support context or alerts, but cannot be converted into fact edges without review evidence.");
  }
  if (layer.official_evidence_gaps.length > 0) {
    reasons.push("Official evidence gaps must remain as backlog or unknowns until the target source is reviewed.");
  }
  if (layer.source_target_status_summary.blocked_targets > 0 || layer.source_target_status_summary.missing_credentials > 0) {
    reasons.push("Blocked source targets mean the absence of evidence cannot be interpreted as evidence of absence.");
  }
  if (layer.prohibited_truth_store_writes.length > 0) {
    reasons.push(`Prohibited truth-store writes: ${layer.prohibited_truth_store_writes.join(", ")}.`);
  }
  return reasons.length === 0 ? ["No unsupported conclusion is required for this layer; keep outputs tied to listed refs."] : reasons;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function renderReasoningWalkthroughMarkdown(walkthrough: ReasoningWalkthrough): string {
  const lines = [
    `# Reasoning Walkthrough ${walkthrough.company_id}`,
    "",
    `Generated at: ${walkthrough.generated_at}`,
    `Matrix: ${walkthrough.matrix_id}`,
    `Policy: ${walkthrough.policy}`,
    "",
    "This walkthrough is deterministic and read-only. It turns propagation readiness into an audit-friendly narrative without creating fact edges, claims, observations, unknowns, or investment conclusions.",
    "",
    "## Summary",
    "",
    `- Layers: ${walkthrough.summary.layers}`,
    `- Layers with known facts: ${walkthrough.summary.known_fact_layers}`,
    `- Layers with unknowns: ${walkthrough.summary.layers_with_unknowns}`,
    `- Layers with blocked sources: ${walkthrough.summary.layers_with_blocked_sources}`,
    `- Next actions: ${walkthrough.summary.next_actions}`,
    `- Prohibited writes: ${formatList(walkthrough.summary.prohibited_truth_store_writes)}`,
    "",
    "## Layers",
    ""
  ];

  for (const layer of walkthrough.layers) {
    lines.push(`### ${layer.layer_id}: ${layer.title}`);
    lines.push("");
    lines.push(`- Status: ${layer.status}`);
    lines.push(`- Question: ${layer.question}`);
    lines.push(`- Known facts: ${formatList(layer.known_facts.refs)} (${layer.known_facts.interpretation})`);
    lines.push(`- Explicit unknowns: ${formatList(layer.explicit_unknowns.refs)} (${layer.explicit_unknowns.interpretation})`);
    lines.push(`- Observations: ${formatList(layer.constrained_evidence.observation_refs)}`);
    lines.push(`- Leads/frontier: ${formatList(layer.constrained_evidence.lead_refs)}`);
    lines.push(`- Source targets: ${formatList(layer.constrained_evidence.source_target_refs)}`);
    lines.push(`- Official evidence gaps: ${formatList(layer.constrained_evidence.official_evidence_gaps.map(formatEvidenceGap))}`);
    lines.push(`- Next actions: ${formatList(layer.next_actions.map(formatNextAction))}`);
    lines.push("- Cannot conclude:");
    for (const reason of layer.cannot_conclude) lines.push(`  - ${reason}`);
    lines.push("");
  }

  lines.push("## Global Cannot-Conclude Rules", "");
  for (const item of walkthrough.cannot_conclude.slice(0, 40)) {
    lines.push(`- ${item.layer_id}: ${item.reason}`);
  }
  return lines.join("\n");
}

function formatEvidenceGap(value: { gap_kind: string; target_kind: string; target_id: string; recommended_action: string }): string {
  return `${value.gap_kind}:${value.target_kind}:${value.target_id} action="${value.recommended_action}"`;
}

function formatNextAction(value: { priority: string; action: string; title: string }): string {
  return `${value.priority}/${value.action}: ${value.title}`;
}

function formatList(values: readonly string[]): string {
  return values.length === 0 ? "(none)" : values.slice(0, 20).join(", ");
}
