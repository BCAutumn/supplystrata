import type { DbClient } from "@supplystrata/db/write";
import { parseSourcePolicyConfig } from "./policy-config.js";
import { calculateNextCheckAt } from "./scheduling.js";
import { normalizeSourceCheckTargetSelection } from "./source-check-target-selection.js";
import type { DueSourceCheckRow } from "./db-rows.js";
import type { SourceCheckTargetSelection } from "./types.js";

export { parseSourcePolicyConfig } from "./policy-config.js";
export { calculateNextCheckAt } from "./scheduling.js";
export { listSourceTargetCoverage } from "./coverage.js";
export { enableSourceCheckTargets, ensureSourceCheckTarget, listSourceHealthRows, syncSourcePolicyConfig } from "./source-policy-management.js";
export { classifyDocumentChange, recordDocumentObservation, recordSourceDegraded, recordSourceFailure } from "./source-observation-events.js";
export { syncSourceHealthRegistry } from "./source-health-registry.js";
export {
  claimDueSourceCheckJobs,
  enqueueAndClaimDueSourceCheckJobs,
  enqueueDueSourceCheckJobs,
  markSourceCheckJobFailed,
  markSourceCheckJobSucceeded
} from "./source-check-jobs.js";
export type {
  SourceTargetCoverageInput,
  SourceTargetCoverageItem,
  SourceTargetCoverageJob,
  SourceTargetCoverageMatchKind,
  SourceTargetCoverageState,
  SourceTargetCoverageEvent
} from "./coverage.js";
export type { DueSourceCheckRow, SourceCheckJobRow, SourceCheckJobStateRow, SourceHealthRow, SourcePolicyRow } from "./db-rows.js";
export type {
  DocumentObservationInput,
  DocumentObservationResult,
  SourceCheckJobStatus,
  SourceCheckTargetEnableInput,
  SourceCheckTargetEnableResult,
  SourceCheckTargetSelection,
  SourceCheckTargetInput,
  SourceDegradedInput,
  SourceDocumentChangeType,
  SourceFailureInput,
  SourcePolicyConfig,
  SourcePolicyInput
} from "./types.js";

export async function listDueSourceChecks(
  client: DbClient,
  input: { now?: string; limit?: number } & SourceCheckTargetSelection = {}
): Promise<DueSourceCheckRow[]> {
  const now = input.now ?? new Date().toISOString();
  const limit = input.limit ?? 50;
  const filter = normalizeSourceCheckTargetSelection(input);
  const result = await client.query<DueSourceCheckRow>(
    `SELECT t.check_target_id, t.source_adapter_id, t.target_kind, t.subject_entity_id, t.target_config,
            t.enabled AS target_enabled, t.priority AS target_priority, t.config_source AS target_config_source, t.notes AS target_notes,
            p.enabled AS policy_enabled, p.check_cadence_minutes, p.jitter_minutes, p.priority AS policy_priority,
            COALESCE(t.check_cadence_minutes, p.check_cadence_minutes) AS effective_check_cadence_minutes,
            COALESCE(t.jitter_minutes, p.jitter_minutes) AS effective_jitter_minutes,
            COALESCE(t.max_attempts, p.max_attempts) AS effective_max_attempts,
            COALESCE(t.backoff_base_minutes, p.backoff_base_minutes) AS effective_backoff_base_minutes,
            COALESCE(t.backoff_max_minutes, p.backoff_max_minutes) AS effective_backoff_max_minutes,
            p.config_source AS policy_config_source, COALESCE(t.next_check_at, p.next_check_at) AS next_check_at,
            p.notes AS policy_notes
     FROM source_check_targets t
     JOIN source_policies p ON p.source_adapter_id = t.source_adapter_id
     WHERE t.enabled = true
       AND p.enabled = true
       AND ($3::text[] IS NULL OR t.check_target_id = ANY($3::text[]))
       AND ($4::text[] IS NULL OR t.source_adapter_id = ANY($4::text[]))
       AND (COALESCE(t.next_check_at, p.next_check_at) IS NULL OR COALESCE(t.next_check_at, p.next_check_at) <= $1::timestamptz)
     ORDER BY p.priority, t.priority, COALESCE(t.next_check_at, p.next_check_at) NULLS FIRST, t.check_target_id
     LIMIT $2`,
    [now, limit, filter.check_target_ids, filter.source_adapter_ids]
  );
  return result.rows;
}
