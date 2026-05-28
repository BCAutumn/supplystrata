import type { SourceCheckRunStatusReport } from "@supplystrata/source-monitor";
import type { ResearchRunStatus } from "./research-runs.js";

export interface ResearchRunLifecycleInput {
  stored_status: ResearchRunStatus;
  stored_completed_at: string | null;
  source_check_status: SourceCheckRunStatusReport;
}

export interface ResearchRunLifecycleSnapshot {
  status: ResearchRunStatus;
  completed_at: string | null;
}

export function deriveResearchRunLifecycle(input: ResearchRunLifecycleInput): ResearchRunLifecycleSnapshot {
  const status = deriveResearchRunStatus(input.stored_status, input.source_check_status);
  return {
    status,
    completed_at: deriveCompletedAt(input.stored_completed_at, status, input.source_check_status)
  };
}

function deriveResearchRunStatus(storedStatus: ResearchRunStatus, sourceCheckStatus: SourceCheckRunStatusReport): ResearchRunStatus {
  if (storedStatus === "blocked" || storedStatus === "cannot_conclude") return storedStatus;
  if (sourceCheckStatus.summary.in_progress > 0) return "in_progress";
  if (sourceCheckStatus.summary.failed > 0 || sourceCheckStatus.summary.dead > 0) return "failed";
  if (sourceCheckStatus.summary.total > 0 && sourceCheckStatus.summary.succeeded === sourceCheckStatus.summary.total) return "succeeded";
  if (sourceCheckStatus.summary.pending > 0) return "queued_source_checks";
  return storedStatus;
}

function deriveCompletedAt(storedCompletedAt: string | null, status: ResearchRunStatus, sourceCheckStatus: SourceCheckRunStatusReport): string | null {
  if (storedCompletedAt !== null) return storedCompletedAt;
  if (status === "succeeded") return latestSourceCheckCompletedAt(sourceCheckStatus);
  if (status === "failed" && hasTerminalDeadFailure(sourceCheckStatus)) return latestSourceCheckCompletedAt(sourceCheckStatus);
  return null;
}

function hasTerminalDeadFailure(sourceCheckStatus: SourceCheckRunStatusReport): boolean {
  return (
    sourceCheckStatus.summary.total > 0 &&
    sourceCheckStatus.summary.dead > 0 &&
    sourceCheckStatus.summary.pending === 0 &&
    sourceCheckStatus.summary.in_progress === 0 &&
    sourceCheckStatus.summary.failed === 0
  );
}

function latestSourceCheckCompletedAt(sourceCheckStatus: SourceCheckRunStatusReport): string | null {
  let latest: string | null = null;
  for (const job of sourceCheckStatus.jobs) {
    if (job.completed_at === null) continue;
    if (latest === null || Date.parse(job.completed_at) > Date.parse(latest)) latest = job.completed_at;
  }
  return latest;
}
