import type { AlertCandidateRecord, AlertSeverity, ChangeTimelineItem } from "@supplystrata/db/read";
import type { WorkbenchAttentionItem, WorkbenchAttentionPriority, WorkbenchClaim, WorkbenchSourceHealth } from "./definitions.js";

export function buildWorkbenchAttentionQueue(input: {
  claims: readonly WorkbenchClaim[];
  draftClaims: readonly WorkbenchClaim[];
  alerts: readonly AlertCandidateRecord[];
  sources: readonly WorkbenchSourceHealth[];
  changes: readonly ChangeTimelineItem[];
  limit?: number;
}): WorkbenchAttentionItem[] {
  const items = [
    ...attentionItemsFromClaimConflicts(input.claims, input.draftClaims),
    ...attentionItemsFromClaimLifecycle(input.claims),
    ...input.alerts.map(attentionItemFromAlert),
    ...input.sources.flatMap(attentionItemsFromSourceHealth),
    ...input.changes.flatMap(attentionItemsFromChange)
  ];
  return items.sort(compareAttentionItems).slice(0, input.limit ?? 100);
}

function attentionItemsFromClaimConflicts(claims: readonly WorkbenchClaim[], draftClaims: readonly WorkbenchClaim[]): WorkbenchAttentionItem[] {
  return [...claims, ...draftClaims].flatMap((claim) => {
    if (claim.conflict_review.review_queue_kind !== "claim_conflict_review") return [];
    return [
      {
        attention_id: `ATTN-CLAIM-CONFLICT-${claim.claim_id}`,
        kind: "claim_conflict",
        priority: priorityFromClaimConflict(claim),
        status: "open",
        title: "Claim conflict needs review",
        summary: claim.conflict_review.fact_write_policy.reason_codes.join(", "),
        action: "Review supporting evidence, contradicting evidence, and linked unknowns before changing any fact edge.",
        scope_kind: "claim",
        scope_id: claim.claim_id,
        refs: uniqueStrings([
          `claim:${claim.claim_id}`,
          ...(claim.edge_id === null ? [] : [`edge:${claim.edge_id}`]),
          ...claim.evidence_refs.map((ref) => `evidence:${ref.evidence_id}`),
          ...claim.unknown_refs.map((ref) => `unknown:${ref.unknown_id}`)
        ]),
        detected_at: claim.updated_at
      }
    ];
  });
}

function priorityFromClaimConflict(claim: WorkbenchClaim): WorkbenchAttentionPriority {
  if (claim.conflict_review.edge_review_required || claim.conflict_review.severity === "high") return "P0";
  if (claim.conflict_review.severity === "medium") return "P1";
  if (claim.conflict_review.severity === "low") return "P2";
  return "P3";
}

function attentionItemsFromClaimLifecycle(claims: readonly WorkbenchClaim[]): WorkbenchAttentionItem[] {
  return claims.flatMap((claim) =>
    claim.lifecycle_warnings.map((warning) => ({
      attention_id: `ATTN-CLAIM-LIFECYCLE-${claim.claim_id}-${warning.code}`,
      kind: "claim_lifecycle",
      priority: "P0",
      status: "open",
      title: "Active claim is attached to an inactive fact edge",
      summary: warning.message,
      action: "Resolve the claim lifecycle before using the claim as current evidence context.",
      scope_kind: "claim",
      scope_id: claim.claim_id,
      refs: uniqueStrings([`claim:${claim.claim_id}`, ...(claim.edge_id === null ? [] : [`edge:${claim.edge_id}`])]),
      detected_at: claim.updated_at
    }))
  );
}

function attentionItemFromAlert(alert: AlertCandidateRecord): WorkbenchAttentionItem {
  return {
    attention_id: `ATTN-ALERT-${alert.alert_id}`,
    kind: "alert",
    priority: priorityFromAlertSeverity(alert.severity),
    status: alert.status,
    title: alert.title,
    summary: alert.summary,
    action: "Review alert provenance and either acknowledge, resolve, suppress, or convert it into follow-up research.",
    scope_kind: alert.scope_kind,
    scope_id: alert.scope_id,
    refs: uniqueStrings([
      `alert:${alert.alert_id}`,
      ...(alert.observation_id === undefined ? [] : [`observation:${alert.observation_id}`]),
      ...(alert.risk_view_id === undefined ? [] : [`risk_view:${alert.risk_view_id}`]),
      ...(alert.risk_metric_id === undefined ? [] : [`risk_metric:${alert.risk_metric_id}`]),
      ...(alert.change_id === undefined ? [] : [`change:${alert.change_id}`]),
      ...(alert.source_event_id === undefined ? [] : [`source_event:${alert.source_event_id}`]),
      ...(alert.source_adapter_id === undefined ? [] : [`source:${alert.source_adapter_id}`])
    ]),
    detected_at: alert.detected_at
  };
}

function priorityFromAlertSeverity(severity: AlertSeverity): WorkbenchAttentionPriority {
  if (severity === "critical") return "P0";
  if (severity === "high") return "P1";
  if (severity === "medium") return "P2";
  return "P3";
}

function attentionItemsFromSourceHealth(source: WorkbenchSourceHealth): WorkbenchAttentionItem[] {
  if (source.failure_count <= 0 && source.last_error_message === null) return [];
  return [
    {
      attention_id: `ATTN-SOURCE-DEGRADED-${source.source_adapter_id}`,
      kind: "source_degraded",
      priority: source.failure_count >= 3 ? "P1" : "P2",
      status: "open",
      title: "Source monitor is degraded",
      summary: source.last_error_message ?? `Source has ${source.failure_count} recorded monitor failure(s).`,
      action: "Inspect the source monitor policy and latest run before trusting freshness or missing-data conclusions from this source.",
      scope_kind: "source",
      scope_id: source.source_adapter_id,
      refs: [`source:${source.source_adapter_id}`],
      detected_at: source.last_failure_at ?? source.last_checked_at
    }
  ];
}

function attentionItemsFromChange(change: ChangeTimelineItem): WorkbenchAttentionItem[] {
  if (!change.requires_attention) return [];
  const scope = changeAttentionScope(change);
  return [
    {
      attention_id: `ATTN-CHANGE-${change.event_id}`,
      kind: "change_requires_attention",
      priority: "P1",
      status: "open",
      title: "Semantic change requires attention",
      summary: `${change.event_family}/${change.event_type} changed ${scope.kind}:${scope.id}.`,
      action: "Review before/after payloads and decide whether the change affects claims, evidence, source policy, or downstream research output.",
      scope_kind: scope.kind,
      scope_id: scope.id,
      refs: [`change:${change.event_id}`],
      detected_at: change.occurred_at
    }
  ];
}

function changeAttentionScope(change: ChangeTimelineItem): { kind: string; id: string } {
  if (change.scope_kind !== undefined && change.scope_id !== undefined) return { kind: change.scope_kind, id: change.scope_id };
  if (change.source_adapter_id !== undefined) return { kind: "source", id: change.source_adapter_id };
  if (change.edge_id !== undefined) return { kind: "edge", id: change.edge_id };
  if (change.evidence_id !== undefined) return { kind: "evidence", id: change.evidence_id };
  return { kind: "change", id: change.event_id };
}

function compareAttentionItems(left: WorkbenchAttentionItem, right: WorkbenchAttentionItem): number {
  const priorityOrder = attentionPriorityRank(left.priority) - attentionPriorityRank(right.priority);
  if (priorityOrder !== 0) return priorityOrder;
  const timeOrder = timestampRank(right.detected_at) - timestampRank(left.detected_at);
  if (timeOrder !== 0) return timeOrder;
  return left.attention_id.localeCompare(right.attention_id);
}

function attentionPriorityRank(priority: WorkbenchAttentionPriority): number {
  if (priority === "P0") return 0;
  if (priority === "P1") return 1;
  if (priority === "P2") return 2;
  return 3;
}

function timestampRank(value: string | null): number {
  if (value === null) return 0;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
