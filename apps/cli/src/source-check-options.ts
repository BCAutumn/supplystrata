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
    options.sourcePlan === undefined ? [] : await buildSourceCheckTargetIdsFromSourcePlanFile({ sourcePlan: options.sourcePlan, ...namespaceOption(options) });
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
  namespace?: string;
  sourceAdapterIds?: readonly string[];
  checkTargetIds?: readonly string[];
}): Promise<string[]> {
  const document = await readSourcePlanDocument(input.sourcePlan);
  if (document.check_target_ids !== undefined) {
    return filterEmbeddedCheckTargetIds(document.check_target_ids, input.sourceAdapterIds, input.checkTargetIds);
  }
  if (input.namespace === undefined) throw new Error("--source-plan requires --namespace unless the source-plan document includes check_target_ids");
  return buildSourceCheckTargetIdsFromPlan({
    source_plan: document.source_plan,
    namespace: input.namespace,
    ...(input.sourceAdapterIds === undefined ? {} : { source_adapter_ids: input.sourceAdapterIds }),
    ...(input.checkTargetIds === undefined ? {} : { check_target_ids: input.checkTargetIds })
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

function namespaceOption(options: { namespace?: string }): { namespace?: string } {
  return options.namespace === undefined ? {} : { namespace: options.namespace };
}

function filterEmbeddedCheckTargetIds(
  ids: readonly string[],
  sourceAdapterIds: readonly string[] | undefined,
  checkTargetIds: readonly string[] | undefined
): string[] {
  const allowedIds = checkTargetIds === undefined ? null : new Set(checkTargetIds);
  const allowedSources = new Set(sourceAdapterIds);
  return ids
    .filter((id) => allowedIds === null || allowedIds.has(id))
    .filter((id) => sourceAdapterIds === undefined || sourceCheckTargetIdMatchesSource(id, allowedSources))
    .sort();
}

function sourceCheckTargetIdMatchesSource(id: string, allowedSources: ReadonlySet<string>): boolean {
  const [, , sourceAdapterId] = id.split(":");
  return sourceAdapterId !== undefined && allowedSources.has(sourceAdapterId);
}
