import { readFile } from "node:fs/promises";
import { buildSourceCheckTargetIdsFromPlan, parseManagedSourcePlanDocument, type ManagedSourcePlanDocument } from "@supplystrata/source-management";
import { parseCommaSeparated, parseIsoDateTime, parseJsonObject, parseLimit, parseNonNegativeInteger, parsePositiveInteger } from "./cli-utils.js";

export interface SourceCheckSelectionCliOptions {
  checkTargetId?: string;
  source?: string;
  sourcePlan?: string;
  namespace?: string;
}

export interface SourceCheckScheduleCliOptions {
  nextCheckAt?: string;
  checkCadenceMinutes?: string;
  jitterMinutes?: string;
  maxAttempts?: string;
  backoffBaseMinutes?: string;
  backoffMaxMinutes?: string;
}

export interface ManualSourceCheckConfigCliOptions {
  config?: string;
  configFile?: string;
  cik?: string;
  entity?: string;
  forms?: string;
  year?: string;
  query?: string;
  limit?: string;
}

export async function buildSourceCheckSelectionOptions(
  options: SourceCheckSelectionCliOptions
): Promise<{ check_target_ids?: string[]; source_adapter_ids?: string[] }> {
  const directCheckTargetIds = options.checkTargetId === undefined ? [] : parseCommaSeparated(options.checkTargetId);
  const planCheckTargetIds =
    options.sourcePlan === undefined
      ? []
      : buildSourceCheckTargetIdsFromPlan({
          source_plan: (await readSourcePlanDocument(options.sourcePlan)).source_plan,
          namespace: requireNamespace(options)
        });
  const checkTargetIds = [...new Set([...directCheckTargetIds, ...planCheckTargetIds])].sort();
  const sourceAdapterIds = options.source === undefined ? [] : parseCommaSeparated(options.source).sort();
  if (options.sourcePlan === undefined && options.namespace !== undefined) throw new Error("--namespace requires --source-plan");
  return {
    ...(checkTargetIds.length === 0 ? {} : { check_target_ids: checkTargetIds }),
    ...(sourceAdapterIds.length === 0 ? {} : { source_adapter_ids: sourceAdapterIds })
  };
}

export async function buildSourceCheckTargetIdsFromSourcePlanFile(input: {
  sourcePlan: string;
  namespace: string;
  sourceAdapterIds?: readonly string[];
}): Promise<string[]> {
  const document = await readSourcePlanDocument(input.sourcePlan);
  return buildSourceCheckTargetIdsFromPlan({
    source_plan: document.source_plan,
    namespace: input.namespace,
    ...(input.sourceAdapterIds === undefined ? {} : { source_adapter_ids: input.sourceAdapterIds })
  });
}

export function parseSourceCheckScheduleOptions(options: SourceCheckScheduleCliOptions): {
  next_check_at?: string;
  check_cadence_minutes?: number;
  jitter_minutes?: number;
  max_attempts?: number;
  backoff_base_minutes?: number;
  backoff_max_minutes?: number;
} {
  return {
    ...(options.nextCheckAt === undefined ? {} : { next_check_at: parseIsoDateTime(options.nextCheckAt, "--next-check-at") }),
    ...(options.checkCadenceMinutes === undefined
      ? {}
      : { check_cadence_minutes: parsePositiveInteger(options.checkCadenceMinutes, "--check-cadence-minutes") }),
    ...(options.jitterMinutes === undefined ? {} : { jitter_minutes: parseNonNegativeInteger(options.jitterMinutes, "--jitter-minutes") }),
    ...(options.maxAttempts === undefined ? {} : { max_attempts: parsePositiveInteger(options.maxAttempts, "--max-attempts") }),
    ...(options.backoffBaseMinutes === undefined ? {} : { backoff_base_minutes: parsePositiveInteger(options.backoffBaseMinutes, "--backoff-base-minutes") }),
    ...(options.backoffMaxMinutes === undefined ? {} : { backoff_max_minutes: parsePositiveInteger(options.backoffMaxMinutes, "--backoff-max-minutes") })
  };
}

export async function buildManualSourceCheckConfig(options: ManualSourceCheckConfigCliOptions): Promise<Record<string, unknown>> {
  const config = {
    ...(options.configFile === undefined ? {} : parseJsonObject(await readFile(options.configFile, "utf8"), "--config-file")),
    ...(options.config === undefined ? {} : parseJsonObject(options.config, "--config"))
  };
  if (options.cik !== undefined) config["cik"] = options.cik;
  if (options.entity !== undefined) config["entity_id"] = options.entity;
  if (options.forms !== undefined) config["form_types"] = parseCommaSeparated(options.forms);
  if (options.year !== undefined) config["year"] = parseLimit(options.year);
  if (options.query !== undefined) config["query"] = options.query;
  if (options.limit !== undefined) config["limit"] = parseLimit(options.limit);
  return config;
}

export async function readSourcePlanDocument(sourcePlanPath: string): Promise<ManagedSourcePlanDocument> {
  return parseManagedSourcePlanDocument(await readFile(sourcePlanPath, "utf8"));
}

function requireNamespace(options: { namespace?: string }): string {
  if (options.namespace === undefined) throw new Error("--source-plan requires --namespace");
  return options.namespace;
}
