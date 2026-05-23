import type { ObservationCoverageReport } from "./observation-coverage.js";

export function renderObservationCoverageMarkdown(report: ObservationCoverageReport): string {
  const lines = [
    `# Observation Coverage ${report.company_id}`,
    "",
    `Generated at: ${report.generated_at}`,
    "",
    "## Summary",
    "",
    `- Typed observations: ${report.summary.typed_observations}`,
    `- Chain observation segments: ${report.summary.chain_observation_segments}`,
    `- Observation types present: ${report.summary.observation_types_present}/${report.summary.methodology_types_total}`,
    `- Observation series: ${report.summary.observation_series}`,
    `- Time-series ready: ${report.summary.time_series_ready}`,
    `- Explicit-baseline ready: ${report.summary.explicit_baseline_ready}`,
    `- Sparse series: ${report.summary.sparse_series}`,
    `- Methodology gaps: ${report.summary.methodology_types_missing}`,
    "",
    "## Present observation types",
    ""
  ];

  if (report.types.length === 0) {
    lines.push("(no typed observations are present in this research pack)", "");
  } else {
    for (const item of report.types) {
      lines.push(`- ${item.observation_type}: ${item.observations}`);
      lines.push(`  Sources: ${formatList(item.source_adapters)}`);
      lines.push(`  Scopes: ${formatList(item.scopes)}`);
      lines.push(`  Components: ${formatList(item.components)}`);
      lines.push(`  Geographies: ${formatList(item.geographies)}`);
      lines.push(`  Metrics: ${formatList(item.metrics)}`);
      lines.push(`  Latest window end: ${item.latest_time_window_end ?? "(none)"}`);
      lines.push(`  Samples: ${formatList(item.sample_observation_ids)}`);
    }
    lines.push("");
  }

  lines.push("## Series readiness", "");
  if (report.series.length === 0) {
    lines.push("(no observation series can be evaluated yet)", "");
  } else {
    for (const item of report.series) {
      lines.push(`- ${item.series_key}: ${item.status}`);
      lines.push(
        `  Points: ${item.observations}; numeric ${item.numeric_points}; windowed ${item.windowed_points}; explicit baseline ${item.explicit_baseline_points}; anomaly summaries ${item.anomaly_summaries}`
      );
      lines.push(`  Latest window end: ${item.latest_time_window_end ?? "(none)"}`);
      lines.push(`  Reason: ${item.reason}`);
      lines.push(`  Samples: ${formatList(item.sample_observation_ids)}`);
    }
    lines.push("");
  }

  lines.push("## Missing methodology types", "");
  for (const gap of report.gaps) {
    lines.push(`- ${gap.observation_type}: ${gap.reason}`);
  }
  return lines.join("\n");
}

function formatList(values: readonly string[]): string {
  return values.length === 0 ? "(none)" : values.join(", ");
}
