import { describe, expect, it } from "vitest";
import type { SourceCheckRunStatusReport } from "@supplystrata/source-monitor";
import { deriveResearchRunLifecycle } from "@supplystrata/source-workflows";

describe("research run lifecycle", () => {
  it("derives succeeded completion time from completed source-check jobs", () => {
    const lifecycle = deriveResearchRunLifecycle({
      stored_status: "queued_source_checks",
      stored_completed_at: null,
      source_check_status: sourceCheckStatus({
        summary: { total: 2, pending: 0, in_progress: 0, failed: 0, succeeded: 2, dead: 0 },
        completedAt: ["2026-05-27T00:01:00.000Z", "2026-05-27T00:03:00.000Z"]
      })
    });

    expect(lifecycle).toEqual({
      status: "succeeded",
      completed_at: "2026-05-27T00:03:00.000Z"
    });
  });

  it("keeps retry-wait failures incomplete until jobs become terminal", () => {
    const lifecycle = deriveResearchRunLifecycle({
      stored_status: "queued_source_checks",
      stored_completed_at: null,
      source_check_status: sourceCheckStatus({
        summary: { total: 1, pending: 0, in_progress: 0, failed: 1, succeeded: 0, dead: 0 },
        completedAt: [null]
      })
    });

    expect(lifecycle).toEqual({
      status: "failed",
      completed_at: null
    });
  });

  it("derives terminal failed completion time from dead source-check jobs", () => {
    const lifecycle = deriveResearchRunLifecycle({
      stored_status: "in_progress",
      stored_completed_at: null,
      source_check_status: sourceCheckStatus({
        summary: { total: 2, pending: 0, in_progress: 0, failed: 0, succeeded: 1, dead: 1 },
        completedAt: ["2026-05-27T00:01:00.000Z", "2026-05-27T00:05:00.000Z"]
      })
    });

    expect(lifecycle).toEqual({
      status: "failed",
      completed_at: "2026-05-27T00:05:00.000Z"
    });
  });
});

function sourceCheckStatus(input: { summary: SourceCheckRunStatusReport["summary"]; completedAt: readonly (string | null)[] }): SourceCheckRunStatusReport {
  return {
    generated_at: "2026-05-27T00:10:00.000Z",
    summary: input.summary,
    jobs: input.completedAt.map((completedAt, index) => ({
      job_id: `SCJ-${index + 1}`,
      status: completedAt === null ? "failed" : index === input.completedAt.length - 1 && input.summary.dead > 0 ? "dead" : "succeeded",
      attempts: 1,
      max_attempts: 3,
      last_error: null,
      next_attempt_at: "2026-05-27T00:00:00.000Z",
      claimed_at: null,
      lease_expires_at: null,
      completed_at: completedAt,
      created_at: "2026-05-27T00:00:00.000Z",
      updated_at: completedAt ?? "2026-05-27T00:00:00.000Z",
      check_target_id: `CHK-${index + 1}`,
      source_adapter_id: "sec-edgar",
      target_kind: "sec-company-filings",
      subject_entity_id: "ENT-TESLA",
      target_enabled: true,
      policy_enabled: true,
      next_check_at: null
    }))
  };
}
