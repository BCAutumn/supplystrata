import type { DbClient } from "@supplystrata/db/read";
import type { SourceTargetCoverageRow } from "./db-rows.js";
import type { SourceCheckJobStatus, SourceCheckTargetInput } from "./types.js";

export type SourceTargetCoverageState =
  | "not_synced"
  | "disabled"
  | "policy_disabled"
  | "due"
  | "scheduled"
  | "active_job"
  | "retry_wait"
  | "degraded"
  | "succeeded"
  | "dead";

export type SourceTargetCoverageMatchKind = "check_target_id" | "target_config" | "none";

export interface SourceTargetCoverageJob {
  job_id: string;
  status: SourceCheckJobStatus;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SourceTargetCoverageEvent {
  event_id: string;
  event_type: string;
  doc_id: string | null;
  detected_at: string;
  caused_by: string;
}

export interface SourceTargetCoverageItem {
  expected_target: SourceCheckTargetInput;
  synced: boolean;
  match_kind: SourceTargetCoverageMatchKind;
  matched_check_target_id: string | null;
  state: SourceTargetCoverageState;
  target_enabled: boolean | null;
  policy_enabled: boolean | null;
  next_check_at: string | null;
  effective_check_cadence_minutes: number | null;
  effective_jitter_minutes: number | null;
  latest_job: SourceTargetCoverageJob | null;
  latest_event: SourceTargetCoverageEvent | null;
  observations: number;
  latest_observation_at: string | null;
}

export interface SourceTargetCoverageInput {
  expected_targets: readonly SourceCheckTargetInput[];
  now: string;
}

export async function listSourceTargetCoverage(client: DbClient, input: SourceTargetCoverageInput): Promise<SourceTargetCoverageItem[]> {
  const items: SourceTargetCoverageItem[] = [];
  for (const target of input.expected_targets) {
    items.push(await loadSourceTargetCoverage(client, target, input.now));
  }
  return items;
}

async function loadSourceTargetCoverage(client: DbClient, expectedTarget: SourceCheckTargetInput, now: string): Promise<SourceTargetCoverageItem> {
  const result = await client.query<SourceTargetCoverageRow>(
    `WITH matched_target AS (
       SELECT t.check_target_id, t.enabled AS target_enabled, p.enabled AS policy_enabled,
              COALESCE(t.next_check_at, p.next_check_at) AS next_check_at,
              COALESCE(t.check_cadence_minutes, p.check_cadence_minutes) AS effective_check_cadence_minutes,
              COALESCE(t.jitter_minutes, p.jitter_minutes) AS effective_jitter_minutes,
              CASE WHEN t.check_target_id = $1 THEN 0 ELSE 1 END AS match_rank
       FROM source_check_targets t
       JOIN source_policies p ON p.source_adapter_id = t.source_adapter_id
       WHERE t.check_target_id = $1
          OR (t.source_adapter_id = $2 AND t.target_kind = $3 AND t.target_config = $4::jsonb)
       ORDER BY match_rank, t.updated_at DESC, t.check_target_id
       LIMIT 1
     )
     SELECT mt.check_target_id, mt.target_enabled, mt.policy_enabled, mt.next_check_at,
            mt.effective_check_cadence_minutes, mt.effective_jitter_minutes, mt.match_rank,
            j.job_id, j.status AS job_status, j.attempts AS job_attempts, j.last_error AS job_last_error,
            j.next_attempt_at AS job_next_attempt_at, j.completed_at AS job_completed_at,
            j.created_at AS job_created_at, j.updated_at AS job_updated_at,
            e.event_id, e.event_type, e.doc_id AS event_doc_id, e.detected_at AS event_detected_at, e.caused_by AS event_caused_by,
            COALESCE(o.observation_count, 0) AS observation_count, o.latest_observation_at
     FROM matched_target mt
     LEFT JOIN LATERAL (
       SELECT job_id, status, attempts, last_error, next_attempt_at, completed_at, created_at, updated_at
       FROM source_check_jobs
       WHERE check_target_id = mt.check_target_id
       ORDER BY created_at DESC, job_id
       LIMIT 1
     ) j ON true
     LEFT JOIN LATERAL (
       SELECT event_id, event_type, doc_id, detected_at, caused_by
       FROM source_change_events
       WHERE check_target_id = mt.check_target_id
       ORDER BY detected_at DESC, event_id
       LIMIT 1
     ) e ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS observation_count, MAX(created_at) AS latest_observation_at
       FROM observations
       WHERE doc_id IN (
         SELECT doc_id
         FROM source_change_events
         WHERE check_target_id = mt.check_target_id AND doc_id IS NOT NULL
       )
     ) o ON true`,
    [expectedTarget.check_target_id, expectedTarget.source_adapter_id, expectedTarget.target_kind, JSON.stringify(expectedTarget.target_config)]
  );
  const row = result.rows[0];
  if (row === undefined) return unsyncedCoverageItem(expectedTarget);
  return {
    expected_target: expectedTarget,
    synced: true,
    match_kind: row.match_rank === 0 ? "check_target_id" : "target_config",
    matched_check_target_id: row.check_target_id,
    state: coverageState(row, now),
    target_enabled: row.target_enabled,
    policy_enabled: row.policy_enabled,
    next_check_at: isoOrNull(row.next_check_at),
    effective_check_cadence_minutes: row.effective_check_cadence_minutes,
    effective_jitter_minutes: row.effective_jitter_minutes,
    latest_job: latestJobFromRow(row),
    latest_event: latestEventFromRow(row),
    observations: numberFromCount(row.observation_count),
    latest_observation_at: isoOrNull(row.latest_observation_at)
  };
}

function unsyncedCoverageItem(expectedTarget: SourceCheckTargetInput): SourceTargetCoverageItem {
  return {
    expected_target: expectedTarget,
    synced: false,
    match_kind: "none",
    matched_check_target_id: null,
    state: "not_synced",
    target_enabled: null,
    policy_enabled: null,
    next_check_at: null,
    effective_check_cadence_minutes: null,
    effective_jitter_minutes: null,
    latest_job: null,
    latest_event: null,
    observations: 0,
    latest_observation_at: null
  };
}

function coverageState(row: SourceTargetCoverageRow, now: string): SourceTargetCoverageState {
  if (!row.target_enabled) return "disabled";
  if (!row.policy_enabled) return "policy_disabled";
  if (row.job_status === "pending" || row.job_status === "in_progress") return "active_job";
  if (row.job_status === "failed") return "retry_wait";
  if (row.job_status === "dead") return "dead";
  if (row.event_type === "SOURCE_DEGRADED") return "degraded";
  if (row.next_check_at === null || row.next_check_at.getTime() <= Date.parse(now)) return "due";
  if (row.job_status === "succeeded") return "succeeded";
  return "scheduled";
}

function latestJobFromRow(row: SourceTargetCoverageRow): SourceTargetCoverageJob | null {
  if (
    row.job_id === null ||
    row.job_status === null ||
    row.job_attempts === null ||
    row.job_next_attempt_at === null ||
    row.job_created_at === null ||
    row.job_updated_at === null
  ) {
    return null;
  }
  return {
    job_id: row.job_id,
    status: row.job_status,
    attempts: row.job_attempts,
    last_error: row.job_last_error,
    next_attempt_at: row.job_next_attempt_at.toISOString(),
    completed_at: isoOrNull(row.job_completed_at),
    created_at: row.job_created_at.toISOString(),
    updated_at: row.job_updated_at.toISOString()
  };
}

function latestEventFromRow(row: SourceTargetCoverageRow): SourceTargetCoverageEvent | null {
  if (row.event_id === null || row.event_type === null || row.event_detected_at === null || row.event_caused_by === null) return null;
  return {
    event_id: row.event_id,
    event_type: row.event_type,
    doc_id: row.event_doc_id,
    detected_at: row.event_detected_at.toISOString(),
    caused_by: row.event_caused_by
  };
}

function isoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function numberFromCount(value: string | number): number {
  return typeof value === "number" ? value : Number.parseInt(value, 10);
}
