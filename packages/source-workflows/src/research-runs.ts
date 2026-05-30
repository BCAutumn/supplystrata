import { randomUUID } from "node:crypto";
import type { Env } from "@supplystrata/config";
import type { DbClient, DatabaseStore } from "@supplystrata/db/write";
import { selectOrDeriveResearchTargetProfile } from "@supplystrata/research-pack";
import type { LlmHelperOptions } from "@supplystrata/llm-helpers";
import {
  enqueueDueSourceCheckJobs,
  listSourceCheckRunStatus,
  syncSourcePolicyConfig,
  type SourceCheckTargetInput,
  type SourceCheckRunStatusReport,
  type SourcePolicyInput
} from "@supplystrata/source-monitor";
import { routeCountryOfficialDirectoryTargets } from "./country-router.js";
import { bridgeOfficialDirectoryIdentifiers, mergeOfficialDirectoryIdentifiers } from "./official-directory-bridge.js";
import { ensureResearchCompanyEntity, type ResearchCompanyEntityBootstrapResult } from "./research-entity-bootstrap.js";
import { deriveResearchRunLifecycle } from "./research-run-lifecycle.js";
import {
  defaultResearchSessionStore,
  researchSessionProfileSummary,
  type ResearchSessionProfileSummary,
  type ResearchSessionStore
} from "./research-session.js";

export type ResearchRunStatus = "accepted" | "queued_source_checks" | "in_progress" | "succeeded" | "cannot_conclude" | "failed" | "blocked";

export interface CreateResearchRunInput {
  company: string;
  env: Env;
  requested_at: string;
  depth?: number;
  source_target_namespace?: string;
  enqueue_source_checks?: boolean;
  reviewer?: string;
  llm?: LlmHelperOptions;
  session_store?: ResearchSessionStore;
}

export type ResearchRunRefreshMode = "auto" | "force";
export type ResearchRunReuseReason = "active_run" | "fresh_run" | "created_run";

export interface EnsureCompanyResearchRunInput extends CreateResearchRunInput {
  refresh_mode?: ResearchRunRefreshMode;
  max_age_minutes?: number;
}

export interface EnsureCompanyResearchRunResult {
  status_report: ResearchRunStatusReport;
  refresh_triggered: boolean;
  reuse_reason: ResearchRunReuseReason;
}

export interface ResearchRunStatusItem {
  run_id: string;
  session_id: string;
  company_query: string;
  company_entity_id: string | null;
  depth: number;
  status: ResearchRunStatus;
  bootstrap_status: ResearchCompanyEntityBootstrapResult["status"];
  source_target_namespace: string;
  source_check_target_ids: string[];
  source_check_summary: SourceCheckRunStatusReport["summary"];
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  profile: ResearchSessionProfileSummary | null;
  next_actions: string[];
  policy: {
    fact_mutation_allowed: false;
    source_jobs_allowed: true;
    ai_provider_call_allowed: false;
  };
}

export interface ResearchRunStatusReport {
  schema_version: "1.0.0";
  generated_at: string;
  run: ResearchRunStatusItem;
}

export class ResearchRunNotFoundError extends Error {
  readonly run_id: string;

  constructor(runId: string) {
    super(`Research run not found: ${runId}`);
    this.run_id = runId;
  }
}

export function isResearchRunNotFoundError(error: unknown): error is ResearchRunNotFoundError {
  return error instanceof ResearchRunNotFoundError;
}

interface EntityIdentityRow {
  entity_id: string;
  display_name: string;
  primary_country: string | null;
  identifiers: Record<string, unknown>;
}

interface ResearchRunRow {
  run_id: string;
  company_query: string;
  company_entity_id: string | null;
  depth: number;
  status: ResearchRunStatus;
  bootstrap_status: ResearchCompanyEntityBootstrapResult["status"];
  source_target_namespace: string;
  source_check_target_ids: string[];
  error_message: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
}

export async function createResearchRun(store: DatabaseStore, input: CreateResearchRunInput): Promise<ResearchRunStatusReport> {
  const runId = `RR-${randomUUID()}`;
  const sessionStore = input.session_store ?? defaultResearchSessionStore;
  const depth = normalizeDepth(input.depth);
  const bootstrap = await ensureResearchCompanyEntity(store, {
    query: input.company,
    env: input.env,
    now: input.requested_at,
    reviewer: input.reviewer ?? "api.research-runs",
    ...(input.llm === undefined ? {} : { llm: input.llm })
  });
  const namespace = normalizeNamespace(input.source_target_namespace ?? `research-${runId.toLowerCase()}`);
  if (bootstrap.entity_id === undefined) {
    await store.transaction(async (client) => {
      await insertResearchRun(client, {
        runId,
        company: input.company,
        entityId: null,
        depth,
        status: "blocked",
        bootstrapStatus: bootstrap.status,
        namespace,
        targetIds: [],
        errorMessage: bootstrap.reason ?? bootstrap.status,
        completedAt: input.requested_at
      });
    });
    return getResearchRunStatus(store.read, { run_id: runId, generated_at: input.requested_at, session_store: sessionStore });
  }

  const identity = await loadEntityIdentity(store.read, bootstrap.entity_id);
  const bridged = await bridgeOfficialDirectoryIdentifiers({
    identity,
    company_query: input.company,
    env: input.env,
    now: input.requested_at
  });
  if (bridged.status === "enriched") {
    await store.transaction((client) =>
      mergeOfficialDirectoryIdentifiers(client, {
        entity_id: identity.entity_id,
        identifiers: bridged.identifiers,
        reviewer: input.reviewer ?? "api.research-runs",
        source_adapter_id: bridged.source_adapter_id ?? "official-directory-bridge",
        ...(bridged.source_url === undefined ? {} : { source_url: bridged.source_url }),
        company_query: input.company
      })
    );
  }
  const routedIdentity =
    bridged.status === "enriched" ? await loadEntityIdentity(store.read, bootstrap.entity_id) : identity;
  const profileSelection = await selectOrDeriveResearchTargetProfile({
    company_id: routedIdentity.entity_id,
    company_name: routedIdentity.display_name,
    component_ids: [],
    ...(routedIdentity.primary_country === null ? {} : { country_code: routedIdentity.primary_country }),
    ...sicCodeInput(routedIdentity.identifiers),
    ...naicsCodeInput(routedIdentity.identifiers),
    source_refs: bootstrapSourceRefs(bootstrap),
    ...(input.llm === undefined ? {} : { llm: input.llm })
  });
  const profileSummary = researchSessionProfileSummary(profileSelection);
  if (profileSummary !== null) {
    sessionStore.register({
      session_id: runId,
      run_id: runId,
      company_entity_id: routedIdentity.entity_id,
      profile: profileSummary,
      created_at: input.requested_at
    });
  }
  const routing = routeCountryOfficialDirectoryTargets({
    identity: routedIdentity,
    namespace,
    now: input.requested_at
  });
  const targetIds = routing.check_targets.map((target) => target.check_target_id);
  const hasTargets = targetIds.length > 0;
  await store.transaction(async (client) => {
    if (hasTargets) {
      await syncSourcePolicyConfig(client, {
        config: {
          schema_version: "1.0.0",
          policies: sourcePoliciesForTargets(routing.check_targets, input.requested_at),
          check_targets: routing.check_targets
        },
        configSource: `research-run:${runId}`
      });
      if (input.enqueue_source_checks !== false) {
        await enqueueDueSourceCheckJobs(client, { now: input.requested_at, limit: targetIds.length, check_target_ids: targetIds });
      }
    }
    await insertResearchRun(client, {
      runId,
      company: input.company,
      entityId: routedIdentity.entity_id,
      depth,
      status: hasTargets ? "queued_source_checks" : "cannot_conclude",
      bootstrapStatus: bootstrap.status,
      namespace,
      targetIds: hasTargets ? targetIds : [],
      errorMessage: hasTargets ? null : routing.routes.map((route) => route.reason).join("; "),
      completedAt: hasTargets ? null : input.requested_at
    });
  });

  return getResearchRunStatus(store.read, { run_id: runId, generated_at: input.requested_at, session_store: sessionStore });
}

export async function ensureCompanyResearchRun(store: DatabaseStore, input: EnsureCompanyResearchRunInput): Promise<EnsureCompanyResearchRunResult> {
  const depth = normalizeDepth(input.depth);
  const refreshMode = input.refresh_mode ?? "auto";
  const maxAgeMinutes = normalizeMaxAgeMinutes(input.max_age_minutes);
  const reusableRun =
    refreshMode === "force"
      ? undefined
      : await loadReusableResearchRun(store.read, {
          company: input.company,
          depth,
          now: input.requested_at,
          maxAgeMinutes
        });
  if (reusableRun !== undefined) {
    const statusReport = await getResearchRunStatus(store.read, {
      run_id: reusableRun.run_id,
      generated_at: input.requested_at,
      ...(input.session_store === undefined ? {} : { session_store: input.session_store })
    });
    return {
      status_report: statusReport,
      refresh_triggered: false,
      reuse_reason: isActiveResearchRunStatus(statusReport.run.status) ? "active_run" : "fresh_run"
    };
  }

  return {
    status_report: await createResearchRun(store, { ...input, depth }),
    refresh_triggered: true,
    reuse_reason: "created_run"
  };
}

export async function getResearchRunStatus(
  client: DbClient,
  input: { run_id: string; generated_at: string; session_store?: ResearchSessionStore }
): Promise<ResearchRunStatusReport> {
  const sessionStore = input.session_store ?? defaultResearchSessionStore;
  const row = await loadResearchRun(client, input.run_id);
  const sourceCheckStatus =
    row.source_check_target_ids.length === 0
      ? emptySourceCheckStatus(input.generated_at)
      : await listSourceCheckRunStatus(client, {
          generated_at: input.generated_at,
          limit: Math.max(100, row.source_check_target_ids.length * 5),
          check_target_ids: row.source_check_target_ids
        });
  const storedCompletedAt = toNullableIso(row.completed_at);
  const lifecycle = deriveResearchRunLifecycle({
    stored_status: row.status,
    stored_completed_at: storedCompletedAt,
    source_check_status: sourceCheckStatus
  });
  if (isTerminalResearchRunStatus(lifecycle.status)) sessionStore.complete(row.run_id);
  const session = isTerminalResearchRunStatus(lifecycle.status) ? null : sessionStore.get(row.run_id);
  return {
    schema_version: "1.0.0",
    generated_at: input.generated_at,
    run: {
      run_id: row.run_id,
      session_id: row.run_id,
      company_query: row.company_query,
      company_entity_id: row.company_entity_id,
      depth: row.depth,
      status: lifecycle.status,
      bootstrap_status: row.bootstrap_status,
      source_target_namespace: row.source_target_namespace,
      source_check_target_ids: [...row.source_check_target_ids],
      source_check_summary: sourceCheckStatus.summary,
      error_message: row.error_message,
      created_at: toIso(row.created_at),
      updated_at: toIso(row.updated_at),
      completed_at: lifecycle.completed_at,
      profile: session?.profile ?? null,
      next_actions: nextActions(row, sourceCheckStatus),
      policy: {
        fact_mutation_allowed: false,
        source_jobs_allowed: true,
        ai_provider_call_allowed: false
      }
    }
  };
}

async function loadReusableResearchRun(
  client: DbClient,
  input: { company: string; depth: number; now: string; maxAgeMinutes: number }
): Promise<ResearchRunRow | undefined> {
  const cutoff = new Date(Date.parse(input.now) - input.maxAgeMinutes * 60 * 1000).toISOString();
  const result = await client.query<ResearchRunRow>(
    `SELECT run_id, company_query, company_entity_id, depth, status, bootstrap_status,
            source_target_namespace, source_check_target_ids, error_message,
            created_at, updated_at, completed_at
     FROM research_runs
     WHERE lower(company_query) = lower($1)
       AND depth = $2
       AND created_at >= $3::timestamptz
     ORDER BY
       CASE WHEN status IN ('accepted','queued_source_checks','in_progress') THEN 0 ELSE 1 END,
       created_at DESC
     LIMIT 1`,
    [input.company, input.depth, cutoff]
  );
  return result.rows[0];
}

async function insertResearchRun(
  client: DbClient,
  input: {
    runId: string;
    company: string;
    entityId: string | null;
    depth: number;
    status: ResearchRunStatus;
    bootstrapStatus: ResearchCompanyEntityBootstrapResult["status"];
    namespace: string;
    targetIds: readonly string[];
    errorMessage: string | null;
    completedAt: string | null;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO research_runs (
       run_id, company_query, company_entity_id, depth, status, bootstrap_status,
       source_target_namespace, source_check_target_ids, error_message,
       completed_at, attrs
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,$11::jsonb)`,
    [
      input.runId,
      input.company,
      input.entityId,
      input.depth,
      input.status,
      input.bootstrapStatus,
      input.namespace,
      [...input.targetIds],
      input.errorMessage,
      input.completedAt,
      JSON.stringify({ created_by: "research-run.v0" })
    ]
  );
}

async function loadResearchRun(client: DbClient, runId: string): Promise<ResearchRunRow> {
  const result = await client.query<ResearchRunRow>(
    `SELECT run_id, company_query, company_entity_id, depth, status, bootstrap_status,
            source_target_namespace, source_check_target_ids, error_message,
            created_at, updated_at, completed_at
     FROM research_runs
     WHERE run_id = $1`,
    [runId]
  );
  const row = result.rows[0];
  if (row === undefined) throw new ResearchRunNotFoundError(runId);
  return row;
}

async function loadEntityIdentity(client: DbClient, entityId: string): Promise<EntityIdentityRow> {
  const result = await client.query<EntityIdentityRow>(
    `SELECT entity_id, display_name, primary_country, identifiers
     FROM entity_master
     WHERE entity_id = $1 AND status = 'active'`,
    [entityId]
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Research run resolved inactive or missing entity: ${entityId}`);
  return row;
}

function sourcePoliciesForTargets(targets: readonly SourceCheckTargetInput[], now: string): SourcePolicyInput[] {
  const seen = new Set<string>();
  const policies: SourcePolicyInput[] = [];
  for (const target of targets) {
    if (seen.has(target.source_adapter_id)) continue;
    seen.add(target.source_adapter_id);
    policies.push({
      source_adapter_id: target.source_adapter_id,
      enabled: true,
      check_cadence_minutes: 24 * 60,
      priority: 10,
      next_check_at: now,
      notes: "Enabled by API research run for official disclosure discovery."
    });
  }
  return policies;
}

function isActiveResearchRunStatus(status: ResearchRunStatus): boolean {
  return status === "accepted" || status === "queued_source_checks" || status === "in_progress";
}

function isTerminalResearchRunStatus(status: ResearchRunStatus): boolean {
  return status === "succeeded" || status === "cannot_conclude" || status === "failed" || status === "blocked";
}

function nextActions(row: ResearchRunRow, sourceCheckStatus: SourceCheckRunStatusReport): string[] {
  if (row.status === "blocked") return ["Fix the bootstrap blocker, then create a new research run."];
  if (row.status === "cannot_conclude") return ["Add a market-specific official directory bootstrap or configure an explicit official source target."];
  if (sourceCheckStatus.summary.total === 0) return ["Wait for source-check jobs to be enqueued or inspect source target policy."];
  if (sourceCheckStatus.summary.pending > 0) return ["Run the source-check worker or wait for the worker to claim pending jobs."];
  if (sourceCheckStatus.summary.in_progress > 0) return ["Poll this run status until the worker completes current source checks."];
  if (sourceCheckStatus.summary.failed > 0 || sourceCheckStatus.summary.dead > 0)
    return ["Inspect GET /runs/source-checks for source errors, credentials, or target config issues."];
  return ["Read company consumer model, reasoning walkthrough, unknowns, and latest AI analysis after artifacts are generated."];
}

function bootstrapSourceRefs(bootstrap: ResearchCompanyEntityBootstrapResult): string[] {
  if (bootstrap.source_url === undefined) return [];
  return [`identity:${bootstrap.source_adapter_id ?? "unknown"}:${bootstrap.source_url}`];
}

function sicCodeInput(identifiers: Record<string, unknown>): { sic_code?: string } {
  const value = identifiers["sic"];
  return typeof value === "string" && value.trim().length > 0 ? { sic_code: value.trim() } : {};
}

function naicsCodeInput(identifiers: Record<string, unknown>): { naics_code?: string } {
  const value = identifiers["naics"];
  return typeof value === "string" && value.trim().length > 0 ? { naics_code: value.trim() } : {};
}

function normalizeDepth(value: number | undefined): number {
  if (value === undefined) return 3;
  if (!Number.isInteger(value) || value < 1) throw new Error("research run depth must be a positive integer");
  return value;
}

function normalizeMaxAgeMinutes(value: number | undefined): number {
  if (value === undefined) return 24 * 60;
  if (!Number.isInteger(value) || value < 0) throw new Error("research run max age must be a non-negative integer");
  return value;
}

function normalizeNamespace(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (normalized.length === 0) throw new Error("research run source target namespace must include at least one alphanumeric character");
  return normalized;
}

function emptySourceCheckStatus(generatedAt: string): SourceCheckRunStatusReport {
  return {
    generated_at: generatedAt,
    summary: { total: 0, pending: 0, in_progress: 0, failed: 0, succeeded: 0, dead: 0 },
    jobs: []
  };
}

function toNullableIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return toIso(value);
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
