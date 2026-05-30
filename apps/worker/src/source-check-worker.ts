import type { DatabaseStore } from "@supplystrata/db/write";
import type { Env } from "@supplystrata/config";
import type { SupplyStrataLogger } from "@supplystrata/observability";
import { createDocumentFactPromoter, persistDocumentObservations } from "@supplystrata/pipeline";
import { runDueSourceChecks, type DueSourceCheckRunResult } from "@supplystrata/source-workflows";
import type { SourceCheckWorkerOptions } from "./options.js";

export interface SourceCheckWorkerLoopInput {
  store: DatabaseStore;
  env: Env;
  options: SourceCheckWorkerOptions;
  logger: SupplyStrataLogger;
  signal?: AbortSignal;
}

export async function runSourceCheckWorkerCycle(input: {
  store: DatabaseStore;
  env: Env;
  limit: number;
  logger: SupplyStrataLogger;
}): Promise<DueSourceCheckRunResult> {
  const startedAt = currentIsoTimestamp();
  // 提升器持有 graph-builder（local-first 默认 defer，无 Neo4j 连接），用完即关，保证 worker 周期无资源泄漏。
  const factPromoter = createDocumentFactPromoter(input.store, { logger: input.logger });
  let result: DueSourceCheckRunResult;
  try {
    result = await runDueSourceChecks(input.store, {
      env: input.env,
      limit: input.limit,
      now: startedAt,
      documentObservationStore: { persistDocumentObservations },
      factPromoter
    });
  } finally {
    await factPromoter.close();
  }
  input.logger.info(
    {
      stage: "source-check-worker",
      started_at: startedAt,
      due_targets: result.due_targets,
      enqueued_jobs: result.enqueued_jobs,
      skipped_active_jobs: result.skipped_active_jobs,
      claimed_jobs: result.claimed_jobs,
      checked_targets: result.checked_targets,
      failed_targets: result.failed_targets,
      dead_jobs: result.dead_jobs
    },
    "source check worker cycle completed"
  );
  return result;
}

function currentIsoTimestamp(): string {
  return new Date().toISOString();
}

export async function runSourceCheckWorkerLoop(input: SourceCheckWorkerLoopInput): Promise<void> {
  while (!input.signal?.aborted) {
    await runSourceCheckWorkerCycle({ store: input.store, env: input.env, limit: input.options.limit, logger: input.logger });
    if (input.options.once) return;
    await sleep(input.options.interval_ms, input.signal);
  }
}

async function sleep(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    if (signal === undefined) return;
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
