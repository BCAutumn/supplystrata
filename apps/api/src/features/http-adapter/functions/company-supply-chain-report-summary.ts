import type {
  CompanySupplyChainReport,
  CompanySupplyChainReportReadiness,
  CompanySupplyChainResearchSummary
} from "../../api-contract/definitions/api-dtos.js";

export function buildCompanySupplyChainResearchSummary(input: {
  company_query: string;
  report_quality: CompanySupplyChainReport["report_quality"];
  refresh: CompanySupplyChainReport["refresh"];
  current: CompanySupplyChainReport["current"];
}): CompanySupplyChainResearchSummary {
  const extractionCounts = extractionCountsForReport(input.refresh, input.current);
  const readiness = reportReadiness({
    reportQuality: input.report_quality,
    runStatus: input.refresh.run.status,
    sourceCheckStatus: input.refresh.run.source_check_summary,
    extractionCounts
  });
  return {
    company_entity_id: input.refresh.run.company_entity_id,
    readiness,
    plain_language_status: plainLanguageStatus(readiness, input.refresh.run.company_entity_id),
    evidence_boundary: evidenceBoundary(readiness),
    source_check_status: input.refresh.run.source_check_summary,
    extraction_counts: extractionCounts,
    recommended_next_calls: recommendedNextCalls(input.company_query, input.refresh.run),
    agent_instructions: agentInstructions(readiness)
  };
}

function extractionCountsForReport(
  refresh: CompanySupplyChainReport["refresh"],
  current: CompanySupplyChainReport["current"]
): CompanySupplyChainResearchSummary["extraction_counts"] {
  const inlineSummary = refresh.source_check_execution?.extraction_summary;
  const consumer = current.consumer_read_model;
  return {
    checked_documents: inlineSummary?.checked_documents ?? 0,
    observations: inlineSummary?.observations ?? consumer?.source_monitoring.total_observations ?? 0,
    review_candidates: inlineSummary?.review_candidates ?? 0,
    semantic_changes: inlineSummary?.semantic_changes ?? 0,
    relation_changes: inlineSummary?.relation_changes ?? 0,
    fact_edges: consumer?.research_pack.fact_edges ?? null,
    unknown_items: consumer?.unknowns.open ?? null
  };
}

function reportReadiness(input: {
  reportQuality: CompanySupplyChainReport["report_quality"];
  runStatus: CompanySupplyChainReport["refresh"]["run"]["status"];
  sourceCheckStatus: CompanySupplyChainReport["refresh"]["run"]["source_check_summary"];
  extractionCounts: CompanySupplyChainResearchSummary["extraction_counts"];
}): CompanySupplyChainReportReadiness {
  if (input.extractionCounts.fact_edges !== null && input.extractionCounts.fact_edges > 0) return "facts_ready";
  if (input.extractionCounts.review_candidates > 0 || input.extractionCounts.semantic_changes > 0 || input.extractionCounts.relation_changes > 0)
    return "review_needed";
  if (input.runStatus === "failed" || input.sourceCheckStatus.failed > 0 || input.sourceCheckStatus.dead > 0) return "source_checks_failed";
  if (input.extractionCounts.observations > 0 || input.extractionCounts.checked_documents > 0) return "observations_only";
  if (input.sourceCheckStatus.pending > 0 || input.sourceCheckStatus.in_progress > 0) return "source_checks_pending";
  if (input.reportQuality === "partial") return "observations_only";
  return "no_coverage";
}

function plainLanguageStatus(readiness: CompanySupplyChainReportReadiness, companyEntityId: string | null): string {
  const company = companyEntityId ?? "the requested company";
  if (readiness === "facts_ready") return `SupplyStrata has evidence-backed supply-chain facts for ${company}.`;
  if (readiness === "review_needed")
    return `SupplyStrata found official-source relationship candidates for ${company}, but they still require review before becoming facts.`;
  if (readiness === "observations_only")
    return `SupplyStrata found official filings or structured observations for ${company}, but has not established reviewed supplier fact edges yet.`;
  if (readiness === "source_checks_pending") return `SupplyStrata has queued or running source checks for ${company}; poll the run before drawing conclusions.`;
  if (readiness === "source_checks_failed")
    return `SupplyStrata could not complete the official source checks for ${company}; inspect run and source-check errors.`;
  return `SupplyStrata has no usable coverage for ${company} yet.`;
}

function evidenceBoundary(readiness: CompanySupplyChainReportReadiness): string {
  if (readiness === "facts_ready") return "Treat fact_edges as reviewed evidence-backed relationships; still preserve cited evidence and unknowns.";
  if (readiness === "review_needed") return "Treat review candidates as leads from official text, not confirmed supplier relationships.";
  if (readiness === "observations_only")
    return "Financial observations, official filings, and unknowns can support context, but they do not prove a supplier graph by themselves.";
  if (readiness === "source_checks_pending") return "Do not conclude supply-chain state until pending checks finish or time out visibly.";
  if (readiness === "source_checks_failed") return "Do not infer absence of supply-chain facts from failed source checks.";
  return "Do not infer company supply-chain coverage from an empty response.";
}

function recommendedNextCalls(companyQuery: string, run: CompanySupplyChainReport["refresh"]["run"]): string[] {
  const companyPathId = run.company_entity_id ?? companyQuery;
  return [
    `/research-runs/${run.run_id}`,
    ...run.source_check_target_ids.map((id) => `/runs/source-checks?check_target_id=${encodeURIComponent(id)}`),
    `/companies/${encodeURIComponent(companyPathId)}/consumer-read-model`,
    `/companies/${encodeURIComponent(companyPathId)}/reasoning-walkthrough`,
    `/companies/${encodeURIComponent(companyPathId)}/ai-analysis/latest`
  ];
}

function agentInstructions(readiness: CompanySupplyChainReportReadiness): string[] {
  const instructions = [
    "State the readiness value before making a supply-chain claim.",
    "Separate reviewed facts, review candidates, observations, and unknowns.",
    "Do not treat source-check success as proof that supplier fact edges exist."
  ];
  if (readiness !== "facts_ready") {
    instructions.push("When no reviewed fact edges exist, explain that SupplyStrata cannot yet provide a confirmed supplier graph.");
  }
  return instructions;
}
