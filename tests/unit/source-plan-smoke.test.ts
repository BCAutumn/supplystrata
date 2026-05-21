import { describe, expect, it } from "vitest";
import { runSourcePlanConnectivitySmoke, selectSourcePlanSmokeTargets, type SourcePlanSmokeTarget } from "@supplystrata/source-workflows";

const TARGETS: SourcePlanSmokeTarget[] = [
  {
    check_target_id: "plan:test:sec",
    source_adapter_id: "sec-edgar",
    target_kind: "sec-company-filings",
    target_config: {
      cik: "0001045810",
      entity_id: "ENT-NVIDIA",
      form_types: ["10-K"],
      limit: 1
    }
  },
  {
    check_target_id: "plan:test:dart",
    source_adapter_id: "dart-kr",
    target_kind: "company-filings",
    target_config: {
      corp_code: "00164779",
      entity_id: "ENT-SKHYNIX",
      disclosure_types: ["A"],
      year: 2025
    }
  },
  {
    check_target_id: "plan:test:unknown",
    source_adapter_id: "unknown-official-source",
    target_kind: "company-filings",
    target_config: {}
  }
];

describe("source-plan connectivity smoke", () => {
  it("selects source-plan smoke targets with source filters and limit before network work", () => {
    const selected = selectSourcePlanSmokeTargets({
      targets: TARGETS,
      source_adapter_ids: ["dart-kr", "unknown-official-source"],
      limit: 1
    });

    expect(selected.map((target) => target.check_target_id)).toEqual(["plan:test:dart"]);
  });

  it("reports unsupported generated targets as skipped without crashing the smoke report", async () => {
    const report = await runSourcePlanConnectivitySmoke({
      targets: TARGETS,
      source_adapter_ids: ["unknown-official-source"]
    });

    expect(report.summary).toMatchObject({
      requested_targets: 3,
      selected_targets: 1,
      checked_targets: 0,
      failed_targets: 0,
      skipped_targets: 1,
      planned_tasks: 0,
      fetched_documents: 0,
      normalized_documents: 0
    });
    expect(report.summary.by_source_status["unknown-official-source"]).toEqual({
      selected_targets: 1,
      checked_targets: 0,
      failed_targets: 0,
      skipped_targets: 1,
      planned_tasks: 0,
      fetched_documents: 0,
      normalized_documents: 0,
      degraded_documents: 0,
      target_kinds: { "company-filings": 1 },
      issue_kinds: { connector_unsupported: 1 }
    });
    const [item] = report.items;
    expect(item?.check_target_id).toBe("plan:test:unknown");
    expect(item?.status).toBe("skipped");
    expect(item?.issue_kind).toBe("connector_unsupported");
    expect(item?.error_message).toContain("Unsupported source-plan smoke target");
  });

  it("keeps target config failures inside the per-target smoke report", async () => {
    const report = await runSourcePlanConnectivitySmoke({
      targets: [
        {
          check_target_id: "plan:test:bad-sec",
          source_adapter_id: "sec-edgar",
          target_kind: "sec-company-filings",
          target_config: {
            cik: "0001045810",
            entity_id: "ENT-NVIDIA",
            form_types: ["10-X"]
          }
        }
      ]
    });

    expect(report.summary.failed_targets).toBe(1);
    expect(report.summary.by_source_status["sec-edgar"]?.issue_kinds).toEqual({ target_config_invalid: 1 });
    const [item] = report.items;
    expect(item?.status).toBe("failed");
    expect(item?.issue_kind).toBe("target_config_invalid");
    expect(item?.error_message).toContain("Unsupported SEC source check form type");
  });
});
