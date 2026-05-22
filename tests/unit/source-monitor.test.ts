import { describe, expect, it } from "vitest";
import type pg from "pg";
import { dbTxClientBrand, type DbClient, type DbTxClient } from "@supplystrata/db/write";
import {
  calculateNextCheckAt,
  claimDueSourceCheckJobs,
  enqueueAndClaimDueSourceCheckJobs,
  enableSourceCheckTargets,
  classifyDocumentChange,
  enqueueDueSourceCheckJobs,
  ensureSourceCheckTarget,
  listDueSourceChecks,
  listSourceHealthRows,
  listSourceTargetCoverage,
  markSourceCheckJobFailed,
  markSourceCheckJobSucceeded,
  parseSourcePolicyConfig,
  recordDocumentObservation,
  recordSourceDegraded,
  recordSourceFailure,
  syncSourcePolicyConfig
} from "@supplystrata/source-monitor";

describe("source monitor", () => {
  it("classifies first seen, unchanged, and changed documents", () => {
    expect(classifyDocumentChange(null, "sha-a")).toBe("DOCUMENT_NEW");
    expect(classifyDocumentChange("sha-a", "sha-a")).toBe("DOCUMENT_UNCHANGED");
    expect(classifyDocumentChange("sha-a", "sha-b")).toBe("DOCUMENT_CHANGED");
  });

  it("parses external source monitoring policies", () => {
    const config = parseSourcePolicyConfig(
      JSON.stringify({
        schema_version: "1.0.0",
        policies: [
          {
            source_adapter_id: "sec-edgar",
            enabled: true,
            check_cadence_minutes: 720,
            jitter_minutes: 60,
            priority: 10,
            next_check_at: "2026-05-19T00:00:00.000Z",
            max_attempts: 4,
            backoff_base_minutes: 2,
            backoff_max_minutes: 90,
            notes: "twice daily"
          }
        ],
        check_targets: [
          {
            check_target_id: "sec-edgar:nvidia",
            source_adapter_id: "sec-edgar",
            target_kind: "sec-company-filings",
            enabled: true,
            priority: 10,
            next_check_at: "2026-05-19T00:30:00.000Z",
            check_cadence_minutes: 180,
            jitter_minutes: 15,
            max_attempts: 5,
            backoff_base_minutes: 3,
            backoff_max_minutes: 120,
            subject_entity_id: "ENT-NVIDIA",
            target_config: {
              cik: "0001045810",
              entity_id: "ENT-NVIDIA",
              form_types: ["10-K", "10-Q", "8-K"],
              limit: 3
            },
            notes: "NVIDIA official filing monitor"
          }
        ]
      })
    );

    expect(config.policies[0]).toEqual({
      source_adapter_id: "sec-edgar",
      enabled: true,
      check_cadence_minutes: 720,
      jitter_minutes: 60,
      priority: 10,
      next_check_at: "2026-05-19T00:00:00.000Z",
      max_attempts: 4,
      backoff_base_minutes: 2,
      backoff_max_minutes: 90,
      notes: "twice daily"
    });
    expect(config.check_targets[0]).toEqual({
      check_target_id: "sec-edgar:nvidia",
      source_adapter_id: "sec-edgar",
      target_kind: "sec-company-filings",
      enabled: true,
      priority: 10,
      next_check_at: "2026-05-19T00:30:00.000Z",
      check_cadence_minutes: 180,
      jitter_minutes: 15,
      max_attempts: 5,
      backoff_base_minutes: 3,
      backoff_max_minutes: 120,
      subject_entity_id: "ENT-NVIDIA",
      target_config: {
        cik: "0001045810",
        entity_id: "ENT-NVIDIA",
        form_types: ["10-K", "10-Q", "8-K"],
        limit: 3
      },
      notes: "NVIDIA official filing monitor"
    });
  });

  it("uses deterministic jitter when computing next source checks", () => {
    const first = calculateNextCheckAt({
      baseTime: "2026-05-17T00:00:00.000Z",
      cadenceMinutes: 60,
      jitterMinutes: 15,
      jitterSeed: "sec-edgar:nvidia"
    });
    const second = calculateNextCheckAt({
      baseTime: "2026-05-17T00:00:00.000Z",
      cadenceMinutes: 60,
      jitterMinutes: 15,
      jitterSeed: "sec-edgar:nvidia"
    });
    const noJitter = calculateNextCheckAt({
      baseTime: "2026-05-17T00:00:00.000Z",
      cadenceMinutes: 60,
      jitterMinutes: 0,
      jitterSeed: "sec-edgar:nvidia"
    });

    expect(first).toBe(second);
    expect(Date.parse(first)).toBeGreaterThanOrEqual(Date.parse("2026-05-17T01:00:00.000Z"));
    expect(Date.parse(first)).toBeLessThanOrEqual(Date.parse("2026-05-17T01:15:00.000Z"));
    expect(noJitter).toBe("2026-05-17T01:00:00.000Z");
  });

  it("keeps health and due-list queries read-only", async () => {
    const recorder = recordingClient();

    await listSourceHealthRows(recorder.client);
    await listDueSourceChecks(recorder.client, { now: "2026-05-17T00:00:00.000Z", limit: 5 });

    expect(recorder.sql).toHaveLength(2);
    expect(recorder.sql.every((sql) => sql.trimStart().startsWith("SELECT"))).toBe(true);
  });

  it("records source failures as source change events and increments health", async () => {
    const client = new SourceMonitorDbClient({ failureCount: 1 });

    const result = await recordSourceFailure(client, {
      source_adapter_id: "sec-edgar",
      error_message: "HTTP 503",
      failed_at: "2026-05-17T00:00:00.000Z",
      task_id: "TASK-1",
      url: "https://www.sec.gov/Archives/example"
    });

    expect(result.event_id).toMatch(/^SEV-/);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO source_change_events") && call.sql.includes("SOURCE_FAILED"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("failure_count = failure_count + 1"))).toBe(true);
  });

  it("links source change events back to source check targets when available", async () => {
    const client = new SourceMonitorDbClient({ failureCount: 0 });

    await recordDocumentObservation(client, {
      source_adapter_id: "samsung-ir",
      source_url: "https://www.samsung.com/global/ir/example",
      doc_id: "DOC-SAMSUNG",
      bytes_sha256: "sha-samsung",
      storage_key: "samsung/example.html",
      observed_at: "2026-05-17T01:00:00.000Z",
      check_target_id: "plan:nvidia:samsung-ir:official-html-disclosure:abc"
    });

    const eventInsert = client.calls.find((call) => call.sql.includes("INSERT INTO source_change_events") && call.params.includes("DOCUMENT_NEW"));
    expect(eventInsert?.sql).toContain("check_target_id");
    expect(eventInsert?.params).toContain("plan:nvidia:samsung-ir:official-html-disclosure:abc");
  });

  it("records recovery when a successful document observation follows failures", async () => {
    const client = new SourceMonitorDbClient({ failureCount: 2, lastErrorMessage: "HTTP 503" });

    const result = await recordDocumentObservation(client, {
      source_adapter_id: "sec-edgar",
      source_url: "https://www.sec.gov/Archives/example",
      doc_id: "DOC-TEST",
      bytes_sha256: "sha-new",
      storage_key: "sec/example.html",
      observed_at: "2026-05-17T01:00:00.000Z"
    });

    expect(result.change_type).toBe("DOCUMENT_NEW");
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO source_change_events") && call.params.includes("DOCUMENT_NEW"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO source_change_events") && call.sql.includes("SOURCE_RECOVERED"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("failure_count = 0"))).toBe(true);
  });

  it("records cached fallback as degraded instead of success", async () => {
    const client = new SourceMonitorDbClient({ failureCount: 0 });

    const result = await recordSourceDegraded(client, {
      source_adapter_id: "tsmc-ir",
      error_message: "TSMC IR fetch timed out after 12000ms",
      degraded_at: "2026-05-17T02:00:00.000Z",
      task_id: "TASK-CACHED",
      url: "https://investor.tsmc.com/example"
    });

    expect(result.event_id).toMatch(/^SEV-/);
    expect(client.calls.some((call) => call.sql.includes("SOURCE_DEGRADED"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("last_failure_at = $2"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("last_success_at = $2"))).toBe(false);
  });

  it("ensures source check targets with source health and default policy", async () => {
    const client = new SourceMonitorDbClient({ failureCount: 0 });

    const result = await ensureSourceCheckTarget(client, {
      configSource: "lead:apple-suppliers",
      target: {
        check_target_id: "osh:apple-supplier:LEAD-1",
        source_adapter_id: "osh",
        target_kind: "facility-search",
        enabled: true,
        priority: 30,
        subject_entity_id: "ENT-APPLE",
        target_config: { query: "3M", scope_id: "ENT-APPLE", lead_id: "LEAD-1" },
        notes: "fixture"
      }
    });

    expect(result).toEqual({ check_target_id: "osh:apple-supplier:LEAD-1" });
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO source_health"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO source_policies"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO source_check_targets"))).toBe(true);
    expect(client.calls.some((call) => call.params.includes("lead:apple-suppliers"))).toBe(true);
  });

  it("enqueues and claims due source check jobs with row locks", async () => {
    const client = new SourceCheckJobDbClient();

    const enqueued = await enqueueDueSourceCheckJobs(client, {
      now: "2026-05-19T00:00:00.000Z",
      limit: 10,
      check_target_ids: ["sec-edgar:nvidia"],
      source_adapter_ids: ["sec-edgar"]
    });
    const jobs = await claimDueSourceCheckJobs(client, { limit: 5, check_target_ids: ["sec-edgar:nvidia"], source_adapter_ids: ["sec-edgar"] });

    expect(enqueued).toEqual({ due_targets: 1, enqueued_jobs: 1, skipped_active_jobs: 0 });
    expect(jobs[0]?.job_id).toBe("SCJ-TEST");
    expect(jobs[0]?.check_target_id).toBe("sec-edgar:nvidia");
    expect(client.calls.some((call) => call.sql.includes("FOR UPDATE SKIP LOCKED"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("t.check_target_id = ANY") && call.params.some(isSecEdgarNvidiaFilter))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO source_check_jobs"))).toBe(true);
    expect(client.calls.some((call) => call.params.includes(5) && call.params.includes(3) && call.params.includes(120))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("j.status = 'in_progress'") && call.sql.includes("j.lease_expires_at <= now()"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("lease_expires_at = now() + ($4::int * interval '1 minute')"))).toBe(true);
    expect(client.calls.some((call) => call.params.includes(15))).toBe(true);
  });

  it("enqueues and claims due source check jobs through one transactional repository call", async () => {
    const client = new SourceCheckJobDbClient();

    const batch = await enqueueAndClaimDueSourceCheckJobs(client, {
      now: "2026-05-19T00:00:00.000Z",
      limit: 10,
      check_target_ids: ["sec-edgar:nvidia"],
      source_adapter_ids: ["sec-edgar"]
    });

    expect(batch.due_targets).toBe(1);
    expect(batch.enqueued_jobs).toBe(1);
    expect(batch.skipped_active_jobs).toBe(0);
    expect(batch.claimed_jobs[0]?.job_id).toBe("SCJ-TEST");
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO source_check_jobs"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("UPDATE source_check_jobs jobs"))).toBe(true);
  });

  it("marks source check jobs succeeded or failed without touching source facts", async () => {
    const client = new SourceCheckJobDbClient();

    await markSourceCheckJobSucceeded(client, { job_id: "SCJ-TEST" });
    const failed = await markSourceCheckJobFailed(client, { job_id: "SCJ-TEST", error_message: "HTTP 503" });

    expect(failed.status).toBe("failed");
    expect(failed.attempts).toBe(1);
    expect(client.calls.some((call) => call.sql.includes("SET status = 'succeeded'"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("lease_expires_at = NULL"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("status = CASE WHEN attempts + 1 >= max_attempts"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("backoff_base_minutes * (attempts + 1) * (attempts + 1)"))).toBe(true);
    expect(client.calls.some((call) => call.sql.includes("INSERT INTO edges"))).toBe(false);
  });

  it("preserves runtime next_check_at unless source policy config explicitly sets it", async () => {
    const client = new SourceMonitorDbClient({ failureCount: 0 });
    const config = parseSourcePolicyConfig(
      JSON.stringify({
        schema_version: "1.0.0",
        policies: [
          {
            source_adapter_id: "sec-edgar",
            enabled: true,
            check_cadence_minutes: 720
          },
          {
            source_adapter_id: "tsmc-ir",
            enabled: true,
            check_cadence_minutes: 1440,
            next_check_at: null
          }
        ],
        check_targets: [
          {
            check_target_id: "target-omitted-next-check",
            source_adapter_id: "sec-edgar",
            target_kind: "sec-company-filings",
            enabled: true,
            target_config: { cik: "0001045810" }
          },
          {
            check_target_id: "target-cleared-next-check",
            source_adapter_id: "tsmc-ir",
            target_kind: "official-html-disclosure",
            enabled: true,
            next_check_at: null,
            target_config: { entity_id: "ENT-TSMC", year: 2025 }
          }
        ]
      })
    );

    await syncSourcePolicyConfig(client, { config, configSource: "unit-test-policy" });

    const omittedPolicy = findCallByParams(client.calls, ["sec-edgar", "unit-test-policy"], "INSERT INTO source_policies");
    const clearedPolicy = findCallByParams(client.calls, ["tsmc-ir", "unit-test-policy"], "INSERT INTO source_policies");
    const omittedTarget = findCallByParam(client.calls, "target-omitted-next-check", "INSERT INTO source_check_targets");
    const clearedTarget = findCallByParam(client.calls, "target-cleared-next-check", "INSERT INTO source_check_targets");

    expect(omittedPolicy.sql).toContain("next_check_at = CASE WHEN $12::boolean THEN EXCLUDED.next_check_at ELSE source_policies.next_check_at END");
    expect(clearedPolicy.sql).toContain("next_check_at = CASE WHEN $12::boolean THEN EXCLUDED.next_check_at ELSE source_policies.next_check_at END");
    expect(omittedPolicy.params[11]).toBe(false);
    expect(clearedPolicy.params[11]).toBe(true);
    expect(omittedTarget.sql).toContain("next_check_at = CASE WHEN $16::boolean THEN EXCLUDED.next_check_at ELSE source_check_targets.next_check_at END");
    expect(clearedTarget.sql).toContain("next_check_at = CASE WHEN $16::boolean THEN EXCLUDED.next_check_at ELSE source_check_targets.next_check_at END");
    expect(omittedTarget.params[15]).toBe(false);
    expect(clearedTarget.params[15]).toBe(true);
  });

  it("enables already synced source-plan targets with explicit target-level cadence", async () => {
    const client = new SourceCheckTargetEnableDbClient();

    const result = await enableSourceCheckTargets(client, {
      check_target_ids: ["plan:nvidia:samsung-ir:official-html-disclosure:abc", "plan:nvidia:samsung-ir:official-html-disclosure:abc", "missing-target"],
      config_source: "reports/nvidia-coverage-pack/source-plan.json",
      next_check_at: "2026-05-19T00:00:00.000Z",
      check_cadence_minutes: 10080,
      jitter_minutes: 120,
      max_attempts: 3,
      backoff_base_minutes: 5,
      backoff_max_minutes: 180,
      notes: "controlled official IR monitoring rollout"
    });

    expect(result).toEqual({
      requested_targets: 2,
      updated_targets: 1,
      missing_targets: 1,
      blocked_targets: 0,
      credential_required_targets: 0,
      enabled_check_target_ids: ["plan:nvidia:samsung-ir:official-html-disclosure:abc"],
      missing_check_target_ids: ["missing-target"],
      blocked_check_target_ids: [],
      credential_required_check_target_ids: []
    });
    const enableCall = client.calls.find((call) => call.sql.includes("UPDATE source_check_targets t") && call.sql.includes("SET enabled = true"));
    expect(enableCall?.params).toContain("2026-05-19T00:00:00.000Z");
    expect(enableCall?.params).toContain(10080);
    expect(enableCall?.params).toContain("reports/nvidia-coverage-pack/source-plan.json");
    expect(enableCall?.params).toContain("controlled official IR monitoring rollout");
  });

  it("reports target-level coverage from synced targets, jobs, events, and observations", async () => {
    const client = new SourceTargetCoverageDbClient();

    const coverage = await listSourceTargetCoverage(client, {
      now: "2026-05-19T00:00:00.000Z",
      expected_targets: [
        {
          check_target_id: "plan:nvidia:samsung-ir:official-html-disclosure:abc",
          source_adapter_id: "samsung-ir",
          target_kind: "official-html-disclosure",
          enabled: false,
          target_config: { entity_id: "ENT-SAMSUNG-ELECTRONICS", year: 2025 }
        },
        {
          check_target_id: "plan:nvidia:skhynix-ir:official-html-disclosure:def",
          source_adapter_id: "skhynix-ir",
          target_kind: "official-html-disclosure",
          enabled: false,
          target_config: { entity_id: "ENT-SKHYNIX", year: 2025 }
        },
        {
          check_target_id: "plan:nvidia:tsmc-ir:official-html-disclosure:ghi",
          source_adapter_id: "tsmc-ir",
          target_kind: "official-html-disclosure",
          enabled: false,
          target_config: { entity_id: "ENT-TSMC", year: 2025 }
        }
      ]
    });

    expect(coverage[0]).toMatchObject({
      synced: true,
      match_kind: "check_target_id",
      state: "succeeded",
      observations: 3
    });
    expect(coverage[0]?.latest_event?.event_type).toBe("DOCUMENT_CHANGED");
    expect(coverage[0]?.latest_job?.status).toBe("succeeded");
    expect(coverage[1]).toMatchObject({
      synced: false,
      match_kind: "none",
      state: "not_synced",
      observations: 0
    });
    expect(coverage[2]).toMatchObject({
      synced: true,
      match_kind: "check_target_id",
      state: "degraded",
      observations: 0
    });
    expect(coverage[2]?.latest_event?.event_type).toBe("SOURCE_DEGRADED");
    expect(coverage[2]?.latest_job?.status).toBe("succeeded");
    expect(client.calls.every((call) => call.sql.trimStart().startsWith("WITH matched_target"))).toBe(true);
  });
});

interface QueryCall {
  sql: string;
  params: readonly unknown[];
}

function isSecEdgarNvidiaFilter(value: unknown): boolean {
  return Array.isArray(value) && value.length === 1 && value[0] === "sec-edgar:nvidia";
}

function findCallByParam(calls: readonly QueryCall[], param: string, sqlSnippet: string): QueryCall {
  return findCallByParams(calls, [param], sqlSnippet);
}

function findCallByParams(calls: readonly QueryCall[], params: readonly string[], sqlSnippet: string): QueryCall {
  const call = calls.find((item) => item.sql.includes(sqlSnippet) && params.every((param) => item.params.includes(param)));
  if (call === undefined) throw new Error(`Expected SQL call containing ${sqlSnippet} with params ${params.join(", ")}`);
  return call;
}

class SourceMonitorDbClient implements DbTxClient {
  readonly [dbTxClientBrand] = true;
  readonly calls: QueryCall[] = [];
  readonly #failureCount: number;
  readonly #lastErrorMessage: string | null;

  constructor(input: { failureCount: number; lastErrorMessage?: string }) {
    this.#failureCount = input.failureCount;
    this.#lastErrorMessage = input.lastErrorMessage ?? null;
  }

  async query<T extends pg.QueryResultRow>(statement: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql: statement, params });
    return {
      command: statement.trimStart().startsWith("SELECT") ? "SELECT" : "MOCK",
      rowCount: 0,
      oid: 0,
      fields: [],
      rows: rowsForStatement<T>(statement, this.#failureCount, this.#lastErrorMessage)
    };
  }
}

class SourceCheckJobDbClient implements DbTxClient {
  readonly [dbTxClientBrand]: true = true;
  readonly calls: QueryCall[] = [];

  async query<T extends pg.QueryResultRow>(statement: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql: statement, params });
    const rows = rowsForSourceCheckJobStatement<T>(statement);
    return {
      command: statement.trimStart().startsWith("SELECT") ? "SELECT" : "MOCK",
      rowCount: statement.includes("INSERT INTO source_check_jobs") ? 1 : rows.length,
      oid: 0,
      fields: [],
      rows
    };
  }
}

class SourceCheckTargetEnableDbClient implements DbClient {
  readonly calls: QueryCall[] = [];

  async query<T extends pg.QueryResultRow>(statement: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql: statement, params });
    const rows =
      statement.includes("WITH requested AS") && statement.includes("UPDATE source_check_targets t")
        ? [
            {
              check_target_id: "plan:nvidia:samsung-ir:official-html-disclosure:abc",
              status: "enabled",
              requires_key: false
            },
            {
              check_target_id: "missing-target",
              status: "missing",
              requires_key: null
            }
          ]
        : [];
    return {
      command: statement.trimStart().startsWith("SELECT") ? "SELECT" : "MOCK",
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows: rows as unknown as T[]
    };
  }
}

class SourceTargetCoverageDbClient implements DbClient {
  readonly calls: QueryCall[] = [];

  async query<T extends pg.QueryResultRow>(statement: string, params: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    this.calls.push({ sql: statement, params });
    const rows = sourceTargetCoverageRows(params[0]);
    return {
      command: "SELECT",
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows: rows as unknown as T[]
    };
  }
}

function sourceTargetCoverageRows(value: unknown): pg.QueryResultRow[] {
  if (value === "plan:nvidia:samsung-ir:official-html-disclosure:abc") {
    return [
      {
        check_target_id: "plan:nvidia:samsung-ir:official-html-disclosure:abc",
        target_enabled: true,
        policy_enabled: true,
        next_check_at: new Date("2026-05-26T00:00:00.000Z"),
        effective_check_cadence_minutes: 10080,
        effective_jitter_minutes: 120,
        job_id: "SCJ-COVERAGE",
        job_status: "succeeded",
        job_attempts: 0,
        job_last_error: null,
        job_next_attempt_at: new Date("2026-05-19T00:00:00.000Z"),
        job_completed_at: new Date("2026-05-19T00:01:00.000Z"),
        job_created_at: new Date("2026-05-19T00:00:00.000Z"),
        job_updated_at: new Date("2026-05-19T00:01:00.000Z"),
        event_id: "SEV-COVERAGE",
        event_type: "DOCUMENT_CHANGED",
        event_doc_id: "DOC-SAMSUNG",
        event_detected_at: new Date("2026-05-19T00:00:30.000Z"),
        event_caused_by: "pipeline",
        observation_count: "3",
        latest_observation_at: new Date("2026-05-19T00:00:40.000Z"),
        match_rank: 0
      }
    ];
  }
  if (value === "plan:nvidia:tsmc-ir:official-html-disclosure:ghi") {
    return [
      {
        check_target_id: "plan:nvidia:tsmc-ir:official-html-disclosure:ghi",
        target_enabled: true,
        policy_enabled: true,
        next_check_at: new Date("2026-05-26T00:00:00.000Z"),
        effective_check_cadence_minutes: 10080,
        effective_jitter_minutes: 120,
        job_id: "SCJ-DEGRADED",
        job_status: "succeeded",
        job_attempts: 0,
        job_last_error: null,
        job_next_attempt_at: new Date("2026-05-19T00:00:00.000Z"),
        job_completed_at: new Date("2026-05-19T00:01:00.000Z"),
        job_created_at: new Date("2026-05-19T00:00:00.000Z"),
        job_updated_at: new Date("2026-05-19T00:01:00.000Z"),
        event_id: "SEV-DEGRADED",
        event_type: "SOURCE_DEGRADED",
        event_doc_id: null,
        event_detected_at: new Date("2026-05-19T00:00:30.000Z"),
        event_caused_by: "source-check.tsmc-ir",
        observation_count: "0",
        latest_observation_at: null,
        match_rank: 0
      }
    ];
  }
  return [];
}

function rowsForStatement<T extends pg.QueryResultRow>(statement: string, failureCount: number, lastErrorMessage: string | null): T[] {
  if (statement.includes("FROM source_check_targets t") && statement.includes("COALESCE(t.check_cadence_minutes")) {
    return [{ check_cadence_minutes: 720, jitter_minutes: 60 }] as unknown as T[];
  }
  if (statement.includes("FROM source_policies")) {
    return [{ check_cadence_minutes: 720, jitter_minutes: 60 }] as unknown as T[];
  }
  if (statement.includes("FROM source_health")) {
    return [
      {
        failure_count: failureCount,
        last_failure_at: failureCount > 0 ? new Date("2026-05-17T00:00:00.000Z") : null,
        last_error_message: lastErrorMessage
      }
    ] as unknown as T[];
  }
  if (statement.includes("FROM source_items")) return [];
  return [];
}

function rowsForSourceCheckJobStatement<T extends pg.QueryResultRow>(statement: string): T[] {
  if (statement.includes("FROM source_check_targets") && statement.includes("FOR UPDATE SKIP LOCKED")) {
    return [dueSourceCheckRow()] as unknown as T[];
  }
  if (statement.includes("UPDATE source_check_jobs jobs")) {
    return [sourceCheckJobRow()] as unknown as T[];
  }
  if (statement.includes("UPDATE source_check_jobs") && statement.includes("RETURNING job_id, status")) {
    return [
      {
        job_id: "SCJ-TEST",
        status: "failed",
        attempts: 1,
        max_attempts: 3,
        backoff_base_minutes: 3,
        backoff_max_minutes: 120,
        last_error: "HTTP 503",
        next_attempt_at: new Date("2026-05-19T00:01:00.000Z"),
        completed_at: null
      }
    ] as unknown as T[];
  }
  return [];
}

function dueSourceCheckRow(): pg.QueryResultRow {
  return {
    check_target_id: "sec-edgar:nvidia",
    source_adapter_id: "sec-edgar",
    target_kind: "sec-company-filings",
    subject_entity_id: "ENT-NVIDIA",
    target_config: { cik: "0001045810", entity_id: "ENT-NVIDIA", form_types: ["10-K"], limit: 1 },
    target_enabled: true,
    target_priority: 10,
    target_config_source: "unit-test",
    target_notes: "fixture",
    policy_enabled: true,
    check_cadence_minutes: 720,
    jitter_minutes: 60,
    effective_check_cadence_minutes: 180,
    effective_jitter_minutes: 15,
    effective_max_attempts: 5,
    effective_backoff_base_minutes: 3,
    effective_backoff_max_minutes: 120,
    policy_priority: 10,
    policy_config_source: "unit-test",
    next_check_at: new Date("2026-05-19T00:00:00.000Z"),
    policy_notes: "fixture"
  };
}

function sourceCheckJobRow(): pg.QueryResultRow {
  return {
    ...dueSourceCheckRow(),
    job_id: "SCJ-TEST",
    job_status: "in_progress",
    attempts: 0,
    max_attempts: 5,
    backoff_base_minutes: 3,
    backoff_max_minutes: 120,
    last_error: null,
    claimed_at: new Date("2026-05-19T00:00:00.000Z"),
    completed_at: null,
    created_at: new Date("2026-05-19T00:00:00.000Z"),
    updated_at: new Date("2026-05-19T00:00:00.000Z")
  };
}

function recordingClient(): { client: DbClient; sql: string[] } {
  const sql: string[] = [];
  return {
    sql,
    client: {
      async query<T extends pg.QueryResultRow>(statement: string): Promise<pg.QueryResult<T>> {
        sql.push(statement);
        return {
          command: "SELECT",
          rowCount: 0,
          oid: 0,
          fields: [],
          rows: []
        };
      }
    }
  };
}
